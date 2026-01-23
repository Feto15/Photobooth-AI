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

// Helper to get session data from Redis
async function getSession(sessionId: string) {
    const reverseKey = `sessionById:${sessionId}`;
    const codeDataStr = await redis.get(reverseKey);
    if (!codeDataStr) return null;

    const { code } = JSON.parse(codeDataStr);
    const sessionKey = `session:${code}`;
    const sessionDataStr = await redis.get(sessionKey);
    if (!sessionDataStr) return null;

    return JSON.parse(sessionDataStr);
}

const router = Router();

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

        // Get jobs from different states
        const [waiting, active, completed, failed] = await Promise.all([
            jobQueue.getJobs(['waiting', 'delayed'], 0, 200),
            jobQueue.getJobs(['active'], 0, 200),
            jobQueue.getJobs(['completed'], 0, 200),
            jobQueue.getJobs(['failed'], 0, 200),
        ]);

        let allJobs = [...waiting, ...active, ...completed, ...failed];

        // Filter by eventId if provided
        if (eventId) {
            allJobs = allJobs.filter(job => job.data?.eventId === eventId);
        }

        // Filter by status if provided
        if (status) {
            const statusFilter = status as string;
            const filteredJobs = [];
            for (const job of allJobs) {
                const jobState = await job.getState();
                const mappedState = mapBullMQState(jobState);
                if (mappedState === statusFilter) {
                    filteredJobs.push(job);
                }
            }
            allJobs = filteredJobs;
        }

        // Sort by timestamp (newest first)
        allJobs.sort((a, b) => {
            const timeA = a.timestamp || 0;
            const timeB = b.timestamp || 0;
            return timeB - timeA;
        });

        // Paginate
        const paginatedJobs = allJobs.slice(offsetNum, offsetNum + limitNum);

        // Build response
        const jobs = await Promise.all(paginatedJobs.map(async (job) => {
            const state = await job.getState();
            return {
                jobId: job.id,
                status: mapBullMQState(state),
                progress: job.progress,
                 data: {
                     eventId: job.data?.eventId,
                     participantName: job.data?.participantName,
                     participantWhatsapp: job.data?.participantWhatsapp,
                     mode: job.data?.mode,
                     styleId: job.data?.styleId,
                 },
                createdAt: job.timestamp ? new Date(job.timestamp).toISOString() : null,
                hasOutput: !!job.returnvalue?.bestOutputKey,
            };
        }));

        res.json({
            data: {
                jobs,
                pagination: {
                    total: allJobs.length,
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

function mapBullMQState(state: string): string {
    switch (state) {
        case 'waiting':
        case 'delayed':
            return 'queued';
        case 'active':
            return 'running';
        case 'completed':
            return 'succeeded';
        case 'failed':
            return 'failed';
        default:
            return state;
    }
}

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
        const session = await getSession(sessionId);
        if (!session) {
            return res.status(400).json({
                error: {
                    code: 'SESSION_NOT_FOUND',
                    message: 'Session not found or expired',
                },
            });
        }

        if (session.eventId !== eventId) {
            return res.status(400).json({
                error: {
                    code: 'SESSION_EVENT_MISMATCH',
                    message: 'Session event does not match request event',
                },
            });
        }

        const participantName = session.name;
        const participantWhatsapp = session.whatsapp;

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
            const existingJob = await jobQueue.getJob(existingJobId);
            const state = existingJob ? await existingJob.getState() : 'unknown';
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
        const job = await jobQueue.getJob(id);

        if (!job) {
            return res.status(404).json({ error: { message: 'Job not found' } });
        }

        const state = await job.getState();
        const progress = job.progress;
        const result = job.returnvalue;
        const data = job.data;

        // Generate signed URLs if succeeded
        let output = null;
        if (result?.bestOutputKey) {
            output = [{
                type: 'image',
                key: result.bestOutputKey,
                signedUrl: await storageClient.createSignedGetUrl(result.bestOutputKey),
            }];
        }

        res.json({
            data: {
                jobId: id,
                status: state,
                progress,
                data,
                output,
                failedReason: job.failedReason,
                createdAt: job.timestamp ? new Date(job.timestamp).toISOString() : null,
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
        const job = await jobQueue.getJob(id);

        if (!job || !job.returnvalue?.bestOutputKey) {
            return res.status(404).json({ error: { message: 'Result not ready' } });
        }

        const signedUrl = await storageClient.createSignedGetUrl(job.returnvalue.bestOutputKey);
        res.redirect(signedUrl);
    } catch (error: any) {
        res.status(500).json({ error: { message: error.message } });
    }
});

export default router;
