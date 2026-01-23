import dotenv from 'dotenv';
import { Worker, Job } from 'bullmq';
import pino from 'pino';
import {
    JobData,
    StorageClient,
    JobReturnValue
} from '@photobot/shared';
import { KieAiProvider, KieAiError } from './modules/ai-adapters/kie-ai';

dotenv.config();

const logger = pino({
    transport: {
        target: 'pino-pretty',
        options: {
            colorize: true,
        },
    },
});

const config = {
    redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
    s3: {
        endpoint: process.env.S3_ENDPOINT,
        region: process.env.S3_REGION || 'auto',
        bucket: process.env.S3_BUCKET || 'photobooth',
        credentials: {
            accessKeyId: process.env.S3_ACCESS_KEY_ID || '',
            secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
        },
        forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
    },
    kieApiKey: process.env.KIE_API_KEY || '',
    kieApiBaseUrl: process.env.KIE_API_BASE_URL,
    kieCallbackBaseUrl: process.env.KIE_CALLBACK_BASE_URL || '', // e.g. https://your-api.com
    concurrency: parseInt(process.env.WORKER_CONCURRENCY_KIE || '5', 10),
    signedUrlTtl: parseInt(process.env.SIGNED_URL_TTL || '3600', 10),
};

const storageClient = new StorageClient(config.s3);
const aiProvider = new KieAiProvider(config.kieApiKey, {
    baseUrl: config.kieApiBaseUrl,
    callbackBaseUrl: config.kieCallbackBaseUrl,
    redisUrl: config.redisUrl,
});

const worker = new Worker<JobData, JobReturnValue>(
    'job-queue',
    async (job: Job<JobData>) => {
        const {
            jobId,
            eventId,
            inputKey,
            mode,
            styleId
        } = job.data;

        logger.info({ jobId, eventId }, 'Processing job');

        try {
            await job.updateProgress({ percent: 5, stage: 'preprocessing' });

            // Generate signed URL for input (kie.ai needs URL)
            const inputImageUrl = await storageClient.createSignedGetUrl(inputKey, config.signedUrlTtl);
            logger.info({ jobId, inputKey }, 'Generated signed URL for input');

            await job.updateProgress({ percent: 10, stage: 'ai_processing' });
            
            // Process with callback mode - will wait for callback via Redis pub/sub
            const aiResult = await aiProvider.process({
                inputImageBytes: Buffer.alloc(0),
                inputImageUrl,
                mode,
                styleId,
                jobId, // Pass jobId for callback matching
            });

            logger.info({ jobId, taskId: aiResult.metadata.taskId }, 'AI processing completed');

            await job.updateProgress({ percent: 80, stage: 'uploading_output' });

            const outputKeys: string[] = [];
            for (let i = 0; i < aiResult.outputs.length; i++) {
                const key = StorageClient.buildKey(eventId, jobId, 'output', 'png', i + 1);
                await storageClient.putObject(key, aiResult.outputs[i], 'image/png');
                outputKeys.push(key);
                logger.info({ jobId, key }, 'Uploaded output image');
            }

            await job.updateProgress({ percent: 100, stage: 'done' });

            return {
                outputKeys,
                bestOutputKey: outputKeys[0],
                providerRequestId: aiResult.metadata.taskId,
                seed: aiResult.metadata.seed,
                metadata: aiResult.metadata,
            };

        } catch (error: any) {
            logger.error({ jobId, error: error.message }, 'Job failed');

            if (error instanceof KieAiError && error.errorType === 'fatal') {
                throw new Error(`[FATAL] ${error.message}`);
            }

            throw error;
        }
    },
    {
        connection: {
            url: config.redisUrl,
        },
        concurrency: config.concurrency,
    }
);

worker.on('completed', (job) => {
    logger.info({ jobId: job.id }, 'Job completed successfully');
});

worker.on('failed', (job, err) => {
    const isFatal = err.message.startsWith('[FATAL]');
    logger.error({ jobId: job?.id, error: err.message, fatal: isFatal }, 'Job failed');
});

worker.on('error', (err) => {
    logger.error({ error: err.message }, 'Worker error');
});

logger.info({ concurrency: config.concurrency }, 'Worker started and waiting for jobs...');
