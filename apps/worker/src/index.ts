import dotenv from 'dotenv';
import { Worker, Job } from 'bullmq';
import pino from 'pino';
import axios from 'axios';
import {
    JobData,
    StorageClient,
    JobReturnValue
} from '@photobot/shared';
import { KieAiProvider, KieAiError } from './modules/ai-adapters/kie-ai';
import { prisma } from '@photobot/db';

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
    n8nWebhookUrl: process.env.N8N_WEBHOOK_URL || '',
    n8nWebhookTimeoutMs: parseInt(process.env.N8N_WEBHOOK_TIMEOUT_MS || '10000', 10),
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
            await prisma.job.update({
                where: { id: jobId },
                data: { status: 'running' },
            });

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

            await prisma.job.update({
                where: { id: jobId },
                data: {
                    status: 'succeeded',
                    outputKey: outputKeys[0],
                    outputKeys,
                },
            });

            const webhookPayload = await buildWebhookPayload({
                jobId,
                inputKey,
                outputKeys,
                aiMetadata: aiResult.metadata,
                eventId,
            });
            await sendN8nWebhook(webhookPayload);

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

    if (job?.id) {
        prisma.job.update({
            where: { id: job.id },
            data: {
                status: 'failed',
                errorMessage: err.message,
            },
        }).catch((error) => {
            logger.error({ jobId: job.id, error: error.message }, 'Failed to update job status');
        });
    }
});

worker.on('error', (err) => {
    logger.error({ error: err.message }, 'Worker error');
});

logger.info({ concurrency: config.concurrency }, 'Worker started and waiting for jobs...');

process.on('SIGINT', async () => {
    logger.info('Shutting down worker...');
    await prisma.$disconnect();
    process.exit(0);
});

async function buildWebhookPayload(params: {
    jobId: string;
    inputKey: string;
    outputKeys: string[];
    aiMetadata: Record<string, any>;
    eventId: string;
}) {
    const { jobId, inputKey, outputKeys, aiMetadata, eventId } = params;
    const jobRecord = await prisma.job.findUnique({
        where: { id: jobId },
        include: {
            customer: true,
            session: true,
        },
    });

    const inputSignedUrl = inputKey
        ? await storageClient.createSignedGetUrl(inputKey, config.signedUrlTtl)
        : null;
    const outputSignedUrls = await Promise.all(
        outputKeys.map((key) => storageClient.createSignedGetUrl(key, config.signedUrlTtl))
    );

    return {
        eventId,
        jobId,
        status: 'succeeded',
        mode: jobRecord?.mode ?? null,
        styleId: jobRecord?.styleId ?? null,
        provider: jobRecord?.provider ?? 'kie',
        sessionId: jobRecord?.sessionId ?? null,
        sessionCode: jobRecord?.session?.code ?? null,
        customerId: jobRecord?.customerId ?? null,
        customerName: jobRecord?.customer?.name ?? null,
        customerWhatsapp: jobRecord?.customer?.whatsapp ?? null,
        inputKey,
        inputSignedUrl,
        outputKeys,
        outputSignedUrls,
        bestOutputKey: outputKeys[0] ?? null,
        aiMetadata,
        createdAt: jobRecord?.createdAt?.toISOString?.() ?? null,
        completedAt: new Date().toISOString(),
    };
}

async function sendN8nWebhook(payload: any) {
    if (!config.n8nWebhookUrl) {
        logger.info('N8N webhook skipped (N8N_WEBHOOK_URL not set)');
        return;
    }

    try {
        const response = await axios.post(config.n8nWebhookUrl, payload, {
            timeout: config.n8nWebhookTimeoutMs,
            headers: {
                'Content-Type': 'application/json',
            },
        });
        logger.info({ jobId: payload?.jobId, status: response.status }, 'N8N webhook sent');
    } catch (error: any) {
        logger.warn(
            {
                error: error?.message,
                status: error?.response?.status,
                data: error?.response?.data,
                jobId: payload?.jobId,
            },
            'Failed to send N8N webhook'
        );
    }
}
