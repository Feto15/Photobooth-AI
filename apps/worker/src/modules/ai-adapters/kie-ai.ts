import axios, { AxiosError } from 'axios';
import Redis from 'ioredis';
import pino from 'pino';
import {
    AiProvider,
    AiProcessOptions,
    AiProcessResult,
    KieCreateTaskRequest,
    KieCreateTaskResponse,
    classifyKieError,
} from './types';

const logger = pino();

const DEFAULT_BASE_URL = 'https://api.kie.ai/api/v1';
const CREATE_TASK_TIMEOUT = 30000;
const CALLBACK_TIMEOUT = 300000; // 5 minutes max wait for callback

const KIE_CALLBACK_CHANNEL = 'kie:callback';
const KIE_TASK_MAPPING_PREFIX = 'kie:task:';
const KIE_TASK_MAPPING_TTL = 600; // 10 minutes

export interface KieCallbackData {
    taskId: string;
    jobId: string;
    status: 'completed' | 'failed';
    imageUrls: string[];
    error?: string;
}

export class KieAiError extends Error {
    constructor(
        message: string,
        public code: number,
        public errorType: 'transient' | 'fatal'
    ) {
        super(message);
        this.name = 'KieAiError';
    }
}

export class KieAiProvider implements AiProvider {
    private apiKey: string;
    private baseUrl: string;
    private callbackBaseUrl: string;
    private redisUrl: string;

    constructor(apiKey: string, options?: { baseUrl?: string; callbackBaseUrl?: string; redisUrl?: string }) {
        this.apiKey = apiKey;
        this.baseUrl = options?.baseUrl || DEFAULT_BASE_URL;
        this.callbackBaseUrl = options?.callbackBaseUrl || '';
        this.redisUrl = options?.redisUrl || 'redis://localhost:6379';
    }

    async process(options: AiProcessOptions & { jobId?: string }): Promise<AiProcessResult> {
        const { inputImageUrl, mode, styleId, prompt, aspectRatio, resolution, outputFormat, jobId } = options;

        if (!inputImageUrl) {
            throw new KieAiError('inputImageUrl is required for Kie AI', 400, 'fatal');
        }

        if (!jobId) {
            throw new KieAiError('jobId is required for callback mode', 400, 'fatal');
        }

        logger.info({ mode, styleId, jobId }, 'Starting Kie AI processing with callback');

        const model = this.getModelForMode(mode);
        const finalPrompt = prompt || this.buildPromptFromStyle(styleId);

        // Create task with callback URL
        const taskId = await this.createTask({
            model,
            inputImageUrl,
            prompt: finalPrompt,
            aspectRatio: aspectRatio || '9:16',
            resolution: resolution || '1K',
            outputFormat: outputFormat || 'png',
            jobId,
        });

        logger.info({ taskId, model, jobId }, 'Task created, waiting for callback');

        // Wait for callback via Redis pub/sub
        const callbackData = await this.waitForCallback(taskId, jobId);

        if (callbackData.status === 'failed') {
            throw new KieAiError(callbackData.error || 'Task processing failed', 501, 'fatal');
        }

        if (!callbackData.imageUrls || callbackData.imageUrls.length === 0) {
            throw new KieAiError('No output images returned', 500, 'fatal');
        }

        // Download output images
        const outputs = await this.downloadOutputImages(callbackData.imageUrls);

        return {
            outputs,
            metadata: {
                providerRequestId: taskId,
                taskId,
                model,
                prompt: finalPrompt,
                aspectRatio,
                resolution,
            },
        };
    }

    private getModelForMode(mode: string): string {
        switch (mode) {
            case 'image-to-image':
            case 'transform':
            case 'style-transfer':
                return 'nano-banana-pro';
            case 'edit':
            case 'inpaint':
                return 'google/nano-banana-edit';
            case 'text-to-image':
            case 'generate':
                return 'google/nano-banana';
            default:
                return 'nano-banana-pro';
        }
    }

    private buildPromptFromStyle(styleId: string): string {
        const stylePrompts: Record<string, string> = {
            'cyberpunk': 'A futuristic cyberpunk humanoid character, standing confidently in the center of a neon-lit cyberpunk city at night, cinematic atmosphere. Wearing a sleek black glossy futuristic bodysuit / exosuit, high-tech materials, subtle reflections, sci-fi armor textures, form-fitting but neutral silhouette. No visible gender traits, no cultural or religious clothing. Hero shot, centered composition, symmetrical framing, medium close-up to full body. Background filled with towering cyberpunk buildings, glowing holographic signs, neon typography, teal and magenta lights, moody urban sci-fi environment. Foreground includes stylized futuristic cityscape illustration, glowing neon waves, digital skyline elements, sci-fi UI inspired visuals. Ultra-detailed, cinematic lighting, volumetric fog, shallow depth of field. Cyberpunk color grading (teal, cyan, magenta, purple), high contrast, dramatic mood. Hyper-realistic rendering, concept art quality, sci-fi movie poster aesthetic, 8K detail.',
            'royal-thai': 'Photorealistic royal Southeast Asian portrait, traditional Thai-inspired palace setting. Preserve the original face identity from the source image with high fidelity. Facial structure, eye shape, nose, lips, jawline, skin texture must remain identical to the source face. Subject standing confidently in a grand palace courtyard with ornate golden temple architecture, cinematic golden hour lighting, warm soft sunlight, shallow depth of field. Traditional royal Southeast Asian outfit: luxury silk fabric, elegant draped clothing, refined embroidery, ceremonial formal attire. Rich gold and royal blue color palette, premium texture, realistic fabric folds. Natural realistic skin tones, sharp facial details, no beautification, no face alteration. DSLR photo quality, 85mm lens look, f1.8, cinematic color grading, ultra-detailed, high realism.',
            'royal-thai-group': 'Photorealistic royal Southeast Asian group portrait of 2 to 5 people, traditional Thai-inspired palace setting. Preserve the original facial identities of all people from the source image with high fidelity. All group members standing confidently in a grand palace courtyard with ornate golden temple architecture, cinematic golden hour lighting, warm soft sunlight, shallow depth of field. Traditional royal Southeast Asian outfits for everyone: luxury silk fabric, elegant draped clothing, refined embroidery, ceremonial formal attire. Rich gold and royal blue color palette, premium texture, realistic fabric folds. Natural realistic skin tones for all subjects, sharp facial details, no face alteration. DSLR photo quality, wide angle lens look to fit everyone, f2.8, cinematic color grading, ultra-detailed, high realism.',

        };

        return stylePrompts[styleId] || `Apply ${styleId} style transformation to this photo`;
    }

    private async createTask(params: {
        model: string;
        inputImageUrl: string;
        prompt: string;
        aspectRatio: string;
        resolution: string;
        outputFormat: string;
        jobId: string;
    }): Promise<string> {
        const { model, inputImageUrl, prompt, aspectRatio, resolution, outputFormat, jobId } = params;

        const callbackUrl = this.callbackBaseUrl
            ? `${this.callbackBaseUrl}/api/kie/callback`
            : undefined;

        const requestBody: KieCreateTaskRequest = {
            model,
            callBackUrl: callbackUrl,
            input: {
                prompt,
                output_format: outputFormat,
            },
        };

        if (model === 'nano-banana-pro') {
            requestBody.input.image_input = [inputImageUrl];
            requestBody.input.aspect_ratio = aspectRatio;
            requestBody.input.resolution = resolution;
        } else if (model === 'google/nano-banana-edit') {
            requestBody.input.image_urls = [inputImageUrl];
            requestBody.input.image_size = aspectRatio;
        } else if (model === 'google/nano-banana') {
            requestBody.input.image_size = aspectRatio;
        }

        try {
            const response = await axios.post<KieCreateTaskResponse>(
                `${this.baseUrl}/jobs/createTask`,
                requestBody,
                {
                    headers: {
                        'Authorization': `Bearer ${this.apiKey}`,
                        'Content-Type': 'application/json',
                    },
                    timeout: CREATE_TASK_TIMEOUT,
                }
            );

            if (response.data.code !== 200 || !response.data.data?.taskId) {
                const errorType = classifyKieError(response.data.code);
                throw new KieAiError(
                    response.data.msg || 'Failed to create task',
                    response.data.code,
                    errorType
                );
            }

            const taskId = response.data.data.taskId;

            // Store taskId -> jobId mapping in Redis
            const redis = new Redis(this.redisUrl);
            await redis.setex(`${KIE_TASK_MAPPING_PREFIX}${taskId}`, KIE_TASK_MAPPING_TTL, jobId);
            await redis.quit();

            return taskId;

        } catch (error) {
            if (error instanceof KieAiError) {
                throw error;
            }

            if (axios.isAxiosError(error)) {
                const axiosError = error as AxiosError<KieCreateTaskResponse>;
                const statusCode = axiosError.response?.status || 500;
                const errorType = classifyKieError(statusCode);

                throw new KieAiError(
                    axiosError.response?.data?.msg || axiosError.message,
                    statusCode,
                    errorType
                );
            }

            throw new KieAiError('Unknown error creating task', 500, 'transient');
        }
    }

    private async waitForCallback(taskId: string, jobId: string): Promise<KieCallbackData> {
        return new Promise((resolve, reject) => {
            const subscriber = new Redis(this.redisUrl);
            let resolved = false;

            const timeout = setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    subscriber.unsubscribe(KIE_CALLBACK_CHANNEL);
                    subscriber.quit();
                    reject(new KieAiError('Callback timeout', 504, 'transient'));
                }
            }, CALLBACK_TIMEOUT);

            subscriber.subscribe(KIE_CALLBACK_CHANNEL, (err) => {
                if (err) {
                    clearTimeout(timeout);
                    subscriber.quit();
                    reject(new KieAiError('Failed to subscribe to callback channel', 500, 'transient'));
                }
            });

            subscriber.on('message', (channel, message) => {
                if (channel !== KIE_CALLBACK_CHANNEL) return;

                try {
                    const data: KieCallbackData = JSON.parse(message);

                    // Only process callback for our taskId
                    if (data.taskId === taskId && data.jobId === jobId) {
                        resolved = true;
                        clearTimeout(timeout);
                        subscriber.unsubscribe(KIE_CALLBACK_CHANNEL);
                        subscriber.quit();

                        logger.info({ taskId, jobId }, 'Received callback for task');
                        resolve(data);
                    }
                } catch (e) {
                    logger.warn({ message }, 'Failed to parse callback message');
                }
            });

            logger.info({ taskId, jobId }, 'Waiting for callback...');
        });
    }

    private async downloadOutputImages(urls: string[]): Promise<Buffer[]> {
        const outputs: Buffer[] = [];

        for (const url of urls) {
            try {
                const response = await axios.get(url, {
                    responseType: 'arraybuffer',
                    timeout: 30000,
                });
                outputs.push(Buffer.from(response.data));
            } catch (error) {
                logger.error({ url, error }, 'Failed to download output image');
                throw new KieAiError('Failed to download output image', 500, 'transient');
            }
        }

        return outputs;
    }
}
