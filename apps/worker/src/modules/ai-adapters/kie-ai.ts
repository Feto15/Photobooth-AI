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
            aspectRatio: aspectRatio || '1:1',
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
            'cartoon': 'Transform this photo into a vibrant cartoon style illustration',
            'anime': 'Convert this photo into anime art style with detailed features',
            'oil-painting': 'Transform this photo into a classical oil painting style',
            'watercolor': 'Convert this photo into a soft watercolor painting',
            'sketch': 'Transform this photo into a detailed pencil sketch',
            'pop-art': 'Convert this photo into bold pop art style like Andy Warhol',
            'cyberpunk': 'Transform this photo into futuristic cyberpunk style with neon lights',
            'vintage': 'Apply vintage retro filter with warm tones to this photo',
            'fantasy': 'Transform this photo into magical fantasy art style',
            'portrait': 'Enhance this portrait photo with professional studio lighting',
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
