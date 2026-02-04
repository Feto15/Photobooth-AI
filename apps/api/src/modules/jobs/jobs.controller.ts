import { Router, Response } from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import { requireAuth, AuthRequest } from '../../middlewares/auth';
import { storageClient } from '../../config/storage';
import { jobQueue } from '../../config/queue';
import { redis } from '../../config/redis';
import { config } from '../../config';
import { StorageClient, JobDataSchema, CreateJobRequestSchema } from '@photobot/shared';
import { logger } from '../../index';
import { prisma } from '@photobot/db';

const router = Router();

function normalizeKeys(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.filter((key): key is string => typeof key === 'string' && key.length > 0);
}

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: config.upload.maxFileSizeBytes,
    },
    fileFilter: (req, file, cb) => {
        if (config.upload.allowedMimeTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error(`Unsupported file type: ${file.mimetype}`));
        }
    },
});

const RATE_LIMIT_KEY_PREFIX = 'ratelimit:job:';
const RATE_LIMIT_WINDOW_SECONDS = 60;
const IDEMPOTENCY_KEY_PREFIX = 'idemp:';

async function checkRateLimit(operatorId: string): Promise<boolean> {
    const key = `${RATE_LIMIT_KEY_PREFIX}${operatorId}`;
    const current = await redis.incr(key);
    if (current === 1) {
        await redis.expire(key, RATE_LIMIT_WINDOW_SECONDS);
    }
    return current <= config.rateLimit.jobCreateLimit;
}

async function checkIdempotency(idempotencyKey: string): Promise<string | null> {
    const key = `${IDEMPOTENCY_KEY_PREFIX}${idempotencyKey}`;
    const existingJobId = await redis.get(key);
    return existingJobId;
}

async function setIdempotency(idempotencyKey: string, jobId: string): Promise<boolean> {
    const key = `${IDEMPOTENCY_KEY_PREFIX}${idempotencyKey}`;
    const result = await redis.set(key, jobId, 'EX', config.idempotency.ttlSeconds, 'NX');
    return result === 'OK';
}

// GET /jobs - List jobs with optional filters
router.get('/', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
        const { eventId, status, limit = '50', offset = '0' } = req.query;
        const limitNum = Math.min(parseInt(limit as string, 10) || 50, 100);
        const offsetNum = parseInt(offset as string, 10) || 0;
        const where: any = {};
        if (eventId) {
            where.eventId = eventId;
        }
        if (status) {
            where.status = status;
        }

        const [total, rows] = await Promise.all([
            prisma.job.count({ where }),
            prisma.job.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                skip: offsetNum,
                take: limitNum,
                include: {
                    customer: true,
                },
            }),
        ]);

        const jobs = await Promise.all(rows.map(async (row) => {
            const queueJob = await jobQueue.getJob(row.id);
            const outputKeys = Array.isArray(row.outputKeys) ? row.outputKeys : [];
            return {
                jobId: row.id,
                status: row.status,
                progress: queueJob?.progress ?? null,
                data: {
                    eventId: row.eventId,
                    participantName: row.customer?.name || null,
                    participantWhatsapp: row.customer?.whatsapp || null,
                    mode: row.mode,
                    styleId: row.styleId,
                },
                createdAt: row.createdAt.toISOString(),
                hasOutput: !!row.outputKey || outputKeys.length > 0,
            };
        }));

        res.json({
            data: {
                jobs,
                pagination: {
                    total,
                    limit: limitNum,
                    offset: offsetNum,
                },
            },
        });

    } catch (error: any) {
        logger.error({ error }, 'Failed to list jobs');
        res.status(500).json({
            error: {
                code: 'INTERNAL_ERROR',
                message: error.message || 'Failed to list jobs',
            },
        });
    }
});

router.post('/', requireAuth, upload.single('image'), async (req: AuthRequest, res: Response) => {
    try {
        // Rate limiting
        const operatorId = req.user?.operatorId || 'unknown';
        const allowed = await checkRateLimit(operatorId);
        if (!allowed) {
            logger.warn({ operatorId }, 'Job creation rate limit exceeded');
            return res.status(429).json({
                error: {
                    code: 'RATE_LIMITED',
                    message: 'Too many requests. Please try again later.',
                },
            });
        }

        // Validate request body
        const parseResult = CreateJobRequestSchema.safeParse(req.body);
        if (!parseResult.success) {
            return res.status(400).json({
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'Invalid request',
                    details: parseResult.error.errors.map(e => ({
                        field: e.path.join('.'),
                        reason: e.message,
                    })),
                },
            });
        }

        const { sessionId, eventId, mode, styleId } = parseResult.data;

        // Fetch and validate session
        const session = await prisma.session.findFirst({
            where: {
                id: sessionId,
                eventId,
                expiresAt: {
                    gt: new Date(),
                },
            },
            include: {
                customer: true,
            },
        });
        if (!session || !session.customer) {
            return res.status(400).json({
                error: {
                    code: 'SESSION_NOT_FOUND',
                    message: 'Session not found or expired',
                },
            });
        }

        const participantName = session.customer.name;
        const participantWhatsapp = session.customer.whatsapp;

        // Validate image
        if (!req.file) {
            return res.status(400).json({
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'Image is required',
                    details: [{ field: 'image', reason: 'missing' }],
                },
            });
        }

        // Check file size (multer should handle this, but double-check)
        if (req.file.size > config.upload.maxFileSizeBytes) {
            return res.status(413).json({
                error: {
                    code: 'PAYLOAD_TOO_LARGE',
                    message: `File size exceeds maximum allowed (${config.upload.maxFileSizeBytes / 1024 / 1024}MB)`,
                },
            });
        }

        // Check MIME type
        if (!config.upload.allowedMimeTypes.includes(req.file.mimetype)) {
            return res.status(415).json({
                error: {
                    code: 'UNSUPPORTED_MEDIA_TYPE',
                    message: `File type ${req.file.mimetype} is not supported. Allowed: ${config.upload.allowedMimeTypes.join(', ')}`,
                },
            });
        }

        const sha256 = crypto.createHash('sha256').update(req.file.buffer).digest('hex');

        // Idempotency check
        const idempotencyKey = req.headers['idempotency-key'] as string
            || `${eventId}:${sessionId}:${sha256.substring(0, 16)}`;

        const existingJobId = await checkIdempotency(idempotencyKey);
        if (existingJobId) {
            logger.info({ jobId: existingJobId, idempotencyKey }, 'Returning existing job (idempotency)');
            const existingJob = await prisma.job.findUnique({ where: { id: existingJobId } });
            const state = existingJob?.status || 'queued';
            return res.status(200).json({
                data: {
                    jobId: existingJobId,
                    status: state,
                    duplicate: true,
                },
            });
        }

        const jobId = uuidv4();

        // Try to set idempotency key
        const idempSet = await setIdempotency(idempotencyKey, jobId);
        if (!idempSet) {
            // Race condition - another request set it first
            const racedJobId = await checkIdempotency(idempotencyKey);
            if (racedJobId) {
                return res.status(200).json({
                    data: {
                        jobId: racedJobId,
                        status: 'queued',
                        duplicate: true,
                    },
                });
            }
        }

        // Build storage key
        const ext = req.file.originalname.split('.').pop() || 'jpg';
        const inputKey = StorageClient.buildKey(eventId, jobId, 'input', ext);

        // Upload to S3
        await storageClient.putObject(inputKey, req.file.buffer, req.file.mimetype);

        await prisma.job.create({
            data: {
                id: jobId,
                eventId,
                sessionId: session.id,
                customerId: session.customer.id,
                status: 'queued',
                mode,
                styleId,
                provider: 'kie',
                inputKey,
            },
        });

        const jobData = {
            jobId,
            sessionId,
            eventId,
            participantName,
            participantWhatsapp,
            mode,
            styleId,
            providerType: 'kie' as const,
            inputKey,
            inputContentType: req.file.mimetype,
            inputSha256: sha256,
            inputSizeBytes: req.file.size,
            createdAt: new Date().toISOString(),
        };

        // Validate full job data
        const validated = JobDataSchema.parse(jobData);

        // Enqueue
        try {
            await jobQueue.add('process-image', validated, {
                jobId: jobId,
                removeOnComplete: false,
                removeOnFail: false,
                attempts: 3,
                backoff: {
                    type: 'exponential',
                    delay: 5000,
                },
            });

            // Update session status to "used" after job created successfully
            await prisma.session.update({
                where: { id: session.id },
                data: { status: 'used' },
            });
        } catch (enqueueError: any) {
            await prisma.job.update({
                where: { id: jobId },
                data: {
                    status: 'failed',
                    errorMessage: enqueueError?.message || 'Failed to enqueue job',
                },
            });
            throw enqueueError;
        }

        logger.info({ jobId, eventId, operatorId }, 'Job created');

        res.status(201).json({
            data: {
                jobId,
                status: 'queued',
                createdAt: jobData.createdAt,
            },
        });

    } catch (error: any) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({
                error: {
                    code: 'PAYLOAD_TOO_LARGE',
                    message: 'File size exceeds maximum allowed',
                },
            });
        }

        logger.error({ error }, 'Failed to create job');
        res.status(500).json({
            error: {
                code: 'INTERNAL_ERROR',
                message: error.message || 'Failed to create job',
            },
        });
    }
});

router.get('/:id', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const job = await prisma.job.findUnique({
            where: { id },
            include: { customer: true },
        });

        if (!job) {
            return res.status(404).json({ error: { message: 'Job not found' } });
        }

        const queueJob = await jobQueue.getJob(id);
        const progress = queueJob?.progress ?? null;
        const outputKeys = normalizeKeys(job.outputKeys);
        const primaryKey = typeof job.outputKey === 'string' ? job.outputKey : null;

        // Generate signed URLs if succeeded
        let output = null;
        if (primaryKey || outputKeys.length > 0) {
            const keys = primaryKey ? [primaryKey, ...outputKeys.filter(k => k !== primaryKey)] : outputKeys;
            output = await Promise.all(keys.map(async (key) => ({
                type: 'image',
                key,
                signedUrl: await storageClient.createSignedGetUrl(key),
            })));
        }

        res.json({
            data: {
                jobId: id,
                status: job.status,
                progress,
                data: {
                    eventId: job.eventId,
                    participantName: job.customer?.name || null,
                    participantWhatsapp: job.customer?.whatsapp || null,
                    mode: job.mode,
                    styleId: job.styleId,
                },
                output,
                failedReason: job.errorMessage,
                createdAt: job.createdAt.toISOString(),
            },
        });
    } catch (error: any) {
        logger.error({ error }, 'Failed to get job');
        res.status(500).json({ error: { message: error.message } });
    }
});

router.get('/:id/download', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const job = await prisma.job.findUnique({ where: { id } });
        const outputKeys = normalizeKeys(job?.outputKeys);
        const primaryKey = typeof job?.outputKey === 'string' ? job?.outputKey : null;
        const bestKey = primaryKey || outputKeys[0];

        if (!job || !bestKey) {
            return res.status(404).json({ error: { message: 'Result not ready' } });
        }

        const signedUrl = await storageClient.createSignedGetUrl(bestKey);
        res.redirect(signedUrl);
    } catch (error: any) {
        res.status(500).json({ error: { message: error.message } });
    }
});

export default router;
