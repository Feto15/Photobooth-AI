import 'dotenv/config';
import chokidar from 'chokidar';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import pino from 'pino';
import { StorageClient } from '@photobot/shared';
import { prisma } from '@photobot/db';

const logger = pino({
    transport: {
        target: 'pino-pretty',
        options: { colorize: true },
    },
});

// Configuration
const config = {
    hotfolderPath: process.env.HOTFOLDER_PATH || './hotfolder',
    orphanPath: process.env.ORPHAN_PATH || './hotfolder/orphan',
    invalidPath: process.env.INVALID_PATH || './hotfolder/invalid',
    processedPath: process.env.PROCESSED_PATH || './hotfolder/processed',
    boothId: process.env.BOOTH_ID || 'booth-1',
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
    fileStabilityDelayMs: parseInt(process.env.FILE_STABILITY_DELAY_MS || '2000', 10),
    allowedExtensions: ['.jpg', '.jpeg', '.png', '.webp'],
};

// Redis keys
const ACTIVE_SESSION_KEY_PREFIX = 'activeSession:';
const IDEMPOTENCY_KEY_PREFIX = 'idemp:hotfolder:';
const ACTIVE_SESSION_TTL_SECONDS = parseInt(process.env.ACTIVE_SESSION_TTL_SECONDS || '1800', 10);

// Connections
const redis = new Redis(config.redisUrl);
const jobQueue = new Queue('job-queue', { connection: { url: config.redisUrl } });
const storageClient = new StorageClient(config.s3);

interface ActiveSessionData {
    sessionId: string;
    eventId: string;
    code: string;
    name: string;
    whatsapp: string;
    operatorId: string;
    startedAt: string;
    mode?: string;
    styleId?: string;
}

/**
 * Ensure directories exist
 */
async function ensureDirectories(): Promise<void> {
    const dirs = [config.hotfolderPath, config.orphanPath, config.invalidPath, config.processedPath];
    for (const dir of dirs) {
        await fs.mkdir(dir, { recursive: true });
    }
    logger.info({ dirs }, 'Directories ensured');
}

/**
 * Calculate SHA256 hash of a file
 */
async function getFileHash(filePath: string): Promise<string> {
    const fileBuffer = await fs.readFile(filePath);
    return crypto.createHash('sha256').update(fileBuffer).digest('hex');
}

/**
 * Check if file is stable (not being written to)
 * Wait for file size to remain the same for a specified duration
 */
async function waitForFileStability(
    filePath: string,
    delayMs: number = config.fileStabilityDelayMs,
    attempts: number = 3
): Promise<boolean> {
    try {
        let lastSize = -1;
        for (let i = 0; i < attempts; i++) {
            const stats = await fs.stat(filePath);
            if (stats.size > 0 && stats.size === lastSize) {
                return true;
            }
            lastSize = stats.size;
            await new Promise(resolve => setTimeout(resolve, delayMs));
        }
        return false;
    } catch {
        return false;
    }
}

/**
 * Check if file extension is allowed
 */
function isAllowedFileType(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    return config.allowedExtensions.includes(ext);
}

/**
 * Get content type from extension
 */
function getContentType(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes: Record<string, string> = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.webp': 'image/webp',
    };
    return mimeTypes[ext] || 'application/octet-stream';
}

/**
 * Move file to a target directory
 */
async function moveFile(sourcePath: string, targetDir: string): Promise<string> {
    const filename = path.basename(sourcePath);
    const timestamp = Date.now();
    const targetPath = path.join(targetDir, `${timestamp}_${filename}`);
    await fs.rename(sourcePath, targetPath);
    return targetPath;
}

/**
 * Get active session for booth
 */
async function getActiveSession(boothId: string): Promise<ActiveSessionData | null> {
    const key = `${ACTIVE_SESSION_KEY_PREFIX}${boothId}`;
    const dataStr = await redis.get(key);
    if (!dataStr) return null;
    return JSON.parse(dataStr);
}

/**
 * Clear active session from Redis (one photo per person mode)
 */
async function clearActiveSession(boothId: string): Promise<void> {
    const key = `${ACTIVE_SESSION_KEY_PREFIX}${boothId}`;
    await redis.del(key);
    logger.info({ boothId }, 'Active session cleared from Redis');
}

/**
 * Check idempotency - prevent duplicate processing
 */
async function checkIdempotency(sessionId: string, fileHash: string): Promise<string | null> {
    const key = `${IDEMPOTENCY_KEY_PREFIX}${sessionId}:${fileHash}`;
    return await redis.get(key);
}

/**
 * Set idempotency key
 */
async function setIdempotency(sessionId: string, fileHash: string, jobId: string): Promise<boolean> {
    const key = `${IDEMPOTENCY_KEY_PREFIX}${sessionId}:${fileHash}`;
    const result = await redis.set(key, jobId, 'EX', 3600, 'NX'); // 1 hour TTL
    return result === 'OK';
}

/**
 * Process a new file from the hotfolder
 */
async function processFile(filePath: string): Promise<void> {
    const filename = path.basename(filePath);
    logger.info({ filePath, filename }, 'New file detected');

    // Step 1: Check if file type is allowed
    if (!isAllowedFileType(filePath)) {
        logger.warn({ filePath }, 'Invalid file type, moving to invalid folder');
        await moveFile(filePath, config.invalidPath);
        return;
    }

    // Step 2: Wait for file to be fully written
    const isStable = await waitForFileStability(filePath);
    if (!isStable) {
        logger.warn({ filePath }, 'File not stable after retries, moving to orphan folder');
        await moveFile(filePath, config.orphanPath);
        return;
    }

    // Step 3: Get active session for this booth
    const activeSession = await getActiveSession(config.boothId);
    if (!activeSession) {
        logger.warn({ filePath, boothId: config.boothId }, 'No active session, moving to orphan folder');
        await moveFile(filePath, config.orphanPath);
        return;
    }

    const session = await prisma.session.findFirst({
        where: {
            id: activeSession.sessionId,
            eventId: activeSession.eventId,
            expiresAt: { gt: new Date() },
        },
        include: {
            customer: true,
        },
    });

    if (!session || !session.customer) {
        logger.warn({ filePath, sessionId: activeSession.sessionId }, 'Session not found or expired, moving to orphan folder');
        await moveFile(filePath, config.orphanPath);
        return;
    }

    // Step 4: Calculate file hash for idempotency
    const fileHash = await getFileHash(filePath);

    // Step 5: Check idempotency
    const existingJobId = await checkIdempotency(activeSession.sessionId, fileHash);
    if (existingJobId) {
        logger.info({ filePath, existingJobId }, 'File already processed (idempotency), moving to processed');
        await moveFile(filePath, config.processedPath);
        return;
    }

    // Step 6: Generate job ID and upload file
    const jobId = crypto.randomUUID();
    const fileBuffer = await fs.readFile(filePath);
    const contentType = getContentType(filePath);
    const ext = path.extname(filePath).toLowerCase().replace('.', '');

    const inputKey = StorageClient.buildKey(activeSession.eventId, jobId, 'input', ext);

    logger.info({ jobId, inputKey }, 'Uploading file to storage');
    await storageClient.putObject(inputKey, fileBuffer, contentType);

    await prisma.job.create({
        data: {
            id: jobId,
            eventId: activeSession.eventId,
            sessionId: session.id,
            customerId: session.customer.id,
            status: 'queued',
            mode: activeSession.mode || 'portrait',
            styleId: activeSession.styleId || 'cyber',
            provider: 'kie',
            inputKey,
        },
    });

    // Step 7: Set idempotency before enqueue
    const idempSet = await setIdempotency(activeSession.sessionId, fileHash, jobId);
    if (!idempSet) {
        // Race condition - another process got here first
        logger.info({ filePath }, 'Idempotency race, file already being processed');
        await moveFile(filePath, config.processedPath);
        return;
    }

    // Step 8: Enqueue job
    const jobData = {
        jobId,
        eventId: activeSession.eventId,
        sessionId: activeSession.sessionId,
        participantName: activeSession.name,
        participantWhatsapp: activeSession.whatsapp,
        mode: activeSession.mode || 'portrait',
        styleId: activeSession.styleId || 'cyber',
        providerType: 'kie' as const,
        inputKey,
        inputContentType: contentType,
        inputSha256: fileHash,
        inputSizeBytes: fileBuffer.length,
        createdAt: new Date().toISOString(),
        source: 'hotfolder',
    };

    await jobQueue.add('process-image', jobData, {
        jobId: jobId,
        removeOnComplete: false,
        removeOnFail: false,
        attempts: 3,
        backoff: {
            type: 'exponential',
            delay: 5000,
        },
    });

    logger.info({
        jobId,
        sessionId: activeSession.sessionId,
        participantName: activeSession.name,
        inputKey,
    }, 'Job enqueued from hotfolder');

    // Step 9: Clear active session from Redis (one photo per person)
    await clearActiveSession(config.boothId);

    // Step 10: Move file to processed folder
    await moveFile(filePath, config.processedPath);
    logger.info({ filePath, jobId }, 'File processed and moved');
}

/**
 * Start the hotfolder watcher
 */
async function startWatcher(): Promise<void> {
    await ensureDirectories();

    const watchPath = path.join(config.hotfolderPath, '*');

    logger.info({
        hotfolderPath: config.hotfolderPath,
        boothId: config.boothId,
        allowedExtensions: config.allowedExtensions,
    }, 'Starting hotfolder watcher');

    const watcher = chokidar.watch(config.hotfolderPath, {
        ignored: [
            /(^|[\/\\])\../, // ignore dotfiles
            config.orphanPath,
            config.invalidPath,
            config.processedPath,
        ],
        persistent: true,
        ignoreInitial: true, // Don't process existing files on startup
        awaitWriteFinish: {
            stabilityThreshold: config.fileStabilityDelayMs,
            pollInterval: 100,
        },
        depth: 0, // Only watch root of hotfolder, not subdirs
    });

    watcher.on('add', async (filePath: string) => {
        // Only process files directly in hotfolder, not in subdirs
        const absoluteFilePath = path.resolve(filePath);
        const absoluteHotfolderPath = path.resolve(config.hotfolderPath);

        // Only process files directly in hotfolder, not in subdirs
        if (path.dirname(absoluteFilePath) !== absoluteHotfolderPath) {
            logger.debug({ filePath, dirname: path.dirname(absoluteFilePath), hotfolderPath: absoluteHotfolderPath }, 'Ignored file (in subdirectory)');
            return;
        }

        try {
            await processFile(filePath);
        } catch (error: any) {
            logger.error({ error: error.message, filePath }, 'Error processing file');
            // Try to move to invalid folder on error
            try {
                await moveFile(filePath, config.invalidPath);
            } catch (moveError) {
                logger.error({ error: (moveError as Error).message, filePath }, 'Failed to move file to invalid folder');
            }
        }
    });

    watcher.on('error', (error: Error) => {
        logger.error({ error: error.message }, 'Watcher error');
    });

    watcher.on('ready', () => {
        logger.info({ path: config.hotfolderPath }, 'Hotfolder watcher ready');
    });

    // Graceful shutdown
    process.on('SIGINT', async () => {
        logger.info('Shutting down hotfolder watcher...');
        await watcher.close();
        await redis.quit();
        await jobQueue.close();
        await prisma.$disconnect();
        process.exit(0);
    });
}

// Start the watcher
startWatcher().catch((error) => {
    logger.error({ error: error.message }, 'Failed to start hotfolder watcher');
    process.exit(1);
});
