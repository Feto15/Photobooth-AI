import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { redis } from '../../config/redis';
import { config } from '../../config';
import { requireAuth } from '../../middlewares/auth';
import { CreateSessionRequestSchema, SessionDataSchema, SessionResponseSchema, GetSessionResponseSchema, SessionListResponseSchema } from '@photobot/shared';
import { logger } from '../../index';
import { prisma } from '@photobot/db';

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
        const expiresAt = new Date(Date.now() + (config.sessionTtlSeconds * 1000));

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

            try {
                await prisma.$transaction(async (tx) => {
                    await tx.event.upsert({
                        where: { id: eventId },
                        update: {},
                        create: { id: eventId, name: eventId },
                    });

                    const customer = await tx.customer.create({
                        data: {
                            eventId,
                            name: name.trim(),
                            whatsapp: whatsapp.trim(),
                            code,
                        },
                    });

                    await tx.session.create({
                        data: {
                            id: sessionId,
                            eventId,
                            customerId: customer.id,
                            code,
                            status: 'active',
                            expiresAt,
                            createdAt: new Date(createdAt),
                        },
                    });
                });

                stored = true;
                break;
            } catch (error: any) {
                if (error?.code === 'P2002') {
                    continue;
                }
                throw error;
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

        logger.info({ sessionId, code, eventId }, 'Session created');

        const response = SessionResponseSchema.parse({
            sessionId,
            code,
            expiresAt: expiresAt.toISOString(),
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

// Zod schema for GET /sessions/list query params
const ListSessionsQuerySchema = z.object({
    eventId: z.string().min(1, 'eventId is required'),
    status: z.enum(['active', 'ready', 'done', 'used']).optional().default('active'),
    limit: z.coerce.number().min(1).max(100).optional().default(50),
    q: z.string().optional(),
});

// GET /sessions/list (operator-only - list pending sessions for stoper)
router.get('/list', requireAuth, async (req: Request, res: Response) => {
    try {
        // Validate query params
        const parseResult = ListSessionsQuerySchema.safeParse(req.query);
        if (!parseResult.success) {
            return res.status(400).json({
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'Invalid query parameters',
                    details: parseResult.error.errors.map(e => ({
                        field: e.path.join('.'),
                        reason: e.message,
                    })),
                },
            });
        }

        const { eventId, status, limit, q } = parseResult.data;

        // Build where clause
        const where: any = {
            eventId,
            status,
            expiresAt: {
                gt: new Date(),
            },
        };

        // Add search filter if q is provided
        if (q && q.trim().length > 0) {
            const searchTerm = q.trim();
            where.customer = {
                OR: [
                    { name: { contains: searchTerm, mode: 'insensitive' } },
                    { whatsapp: { contains: searchTerm } },
                ],
            };
        }

        const sessions = await prisma.session.findMany({
            where,
            include: {
                customer: true,
            },
            orderBy: {
                createdAt: 'desc',
            },
            take: limit,
        });

        const sessionList = sessions
            .filter(s => s.customer)
            .map(s => ({
                sessionId: s.id,
                code: s.code,
                name: s.customer!.name,
                whatsapp: s.customer!.whatsapp,
                createdAt: s.createdAt.toISOString(),
            }));

        const response = SessionListResponseSchema.parse({ sessions: sessionList });

        logger.info({ eventId, status, q, count: sessionList.length }, 'Session list retrieved');

        res.json({
            data: response,
        });

    } catch (error: any) {
        logger.error({ error }, 'Failed to get session list');
        res.status(500).json({
            error: {
                code: 'INTERNAL_ERROR',
                message: error.message || 'Failed to get session list',
            },
        });
    }
});

// GET /sessions/:code (operator-only - requires auth)
router.get('/:code', requireAuth, async (req: Request, res: Response) => {
    try {
        const rawCode = req.params.code || '';
        const code = rawCode.toUpperCase();

        // Validate code format
        if (!/^[A-Z0-9]{6}$/.test(code)) {
            return res.status(400).json({
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'Invalid code format',
                },
            });
        }

        const session = await prisma.session.findFirst({
            where: {
                code,
                expiresAt: {
                    gt: new Date(),
                },
            },
            include: {
                customer: true,
            },
        });

        if (!session || !session.customer) {
            return res.status(404).json({
                error: {
                    code: 'SESSION_NOT_FOUND',
                    message: 'Session not found or expired',
                },
            });
        }

        const response = GetSessionResponseSchema.parse({
            sessionId: session.id,
            eventId: session.eventId,
            name: session.customer.name,
            whatsapp: session.customer.whatsapp,
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
