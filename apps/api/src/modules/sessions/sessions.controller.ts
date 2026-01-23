import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { redis } from '../../config/redis';
import { config } from '../../config';
import { requireAuth } from '../../middlewares/auth';
import { CreateSessionRequestSchema, SessionDataSchema, SessionResponseSchema, GetSessionResponseSchema } from '@photobot/shared';
import { logger } from '../../index';

const router = Router();

// Generate 6-character uppercase alphanumeric code
function generateCode(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

// Rate limiting for public endpoint
const RATE_LIMIT_KEY_PREFIX = 'ratelimit:session:';
const RATE_LIMIT_WINDOW_SECONDS = 60;

async function checkRateLimit(ip: string): Promise<boolean> {
    const key = `${RATE_LIMIT_KEY_PREFIX}${ip}`;
    const current = await redis.incr(key);
    if (current === 1) {
        await redis.expire(key, RATE_LIMIT_WINDOW_SECONDS);
    }
    return current <= config.rateLimit.sessionCreateLimit;
}

// POST /sessions (public)
router.post('/', async (req: Request, res: Response) => {
    try {
        const clientIp = req.ip || req.socket.remoteAddress || 'unknown';

        // Rate limiting
        const allowed = await checkRateLimit(clientIp);
        if (!allowed) {
            logger.warn({ ip: clientIp }, 'Session creation rate limit exceeded');
            return res.status(429).json({
                error: {
                    code: 'RATE_LIMITED',
                    message: 'Too many requests. Please try again later.',
                },
            });
        }

        // Validate request body
        const parseResult = CreateSessionRequestSchema.safeParse(req.body);
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

        const { eventId, name, whatsapp } = parseResult.data;
        const sessionId = uuidv4();
        const createdAt = new Date().toISOString();
        const expiresAt = new Date(Date.now() + (config.sessionTtlSeconds * 1000)).toISOString();

        let code = '';
        let stored = false;
        let validated: unknown;

        // Avoid code collision by trying a few times with SET NX
        for (let attempt = 0; attempt < 5; attempt++) {
            code = generateCode();
            const sessionData = {
                sessionId,
                eventId,
                name: name.trim(),
                whatsapp: whatsapp.trim(),
                code,
                createdAt,
            };

            validated = SessionDataSchema.parse(sessionData);
            const sessionKey = `session:${code}`;
            const result = await redis.set(sessionKey, JSON.stringify(validated), 'EX', config.sessionTtlSeconds, 'NX');
            if (result === 'OK') {
                stored = true;
                break;
            }
        }

        if (!stored) {
            logger.error({ sessionId, eventId }, 'Failed to allocate unique session code');
            return res.status(500).json({
                error: {
                    code: 'SESSION_CODE_CONFLICT',
                    message: 'Failed to create session. Please try again.',
                },
            });
        }

        // Optional: store reverse lookup
        const reverseKey = `sessionById:${sessionId}`;
        await redis.set(reverseKey, JSON.stringify({ code }), 'EX', config.sessionTtlSeconds);

        logger.info({ sessionId, code, eventId }, 'Session created');

        const response = SessionResponseSchema.parse({
            sessionId,
            code,
            expiresAt,
        });

        res.status(201).json({
            data: response,
        });

    } catch (error: any) {
        logger.error({ error }, 'Failed to create session');
        res.status(500).json({
            error: {
                code: 'INTERNAL_ERROR',
                message: error.message || 'Failed to create session',
            },
        });
    }
});

// GET /sessions/:code (operator-only - requires auth)
router.get('/:code', requireAuth, async (req: Request, res: Response) => {
    try {
        const { code } = req.params;

        // Validate code format
        if (!/^[A-Z0-9]{6}$/.test(code)) {
            return res.status(400).json({
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'Invalid code format',
                },
            });
        }

        const sessionKey = `session:${code}`;
        const sessionDataStr = await redis.get(sessionKey);

        if (!sessionDataStr) {
            return res.status(404).json({
                error: {
                    code: 'SESSION_NOT_FOUND',
                    message: 'Session not found or expired',
                },
            });
        }

        const sessionData = JSON.parse(sessionDataStr);
        const response = GetSessionResponseSchema.parse({
            sessionId: sessionData.sessionId,
            eventId: sessionData.eventId,
            name: sessionData.name,
            whatsapp: sessionData.whatsapp,
        });

        logger.info({ sessionId: response.sessionId, code }, 'Session retrieved');

        res.json({
            data: response,
        });

    } catch (error: any) {
        logger.error({ error }, 'Failed to get session');
        res.status(500).json({
            error: {
                code: 'INTERNAL_ERROR',
                message: error.message || 'Failed to get session',
            },
        });
    }
});

export default router;
