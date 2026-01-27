import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { redis } from '../../config/redis';
import { config } from '../../config';
import { requireAuth, AuthRequest } from '../../middlewares/auth';
import { logger } from '../../index';

const router = Router();

// Redis key patterns
const ACTIVE_SESSION_KEY_PREFIX = 'activeSession:';
const SESSION_KEY_PREFIX = 'session:';
const SESSION_BY_ID_PREFIX = 'sessionById:';

// TTL for active session (30 minutes default, can be configured)
const ACTIVE_SESSION_TTL_SECONDS = parseInt(process.env.ACTIVE_SESSION_TTL_SECONDS || '1800', 10);

// Zod schemas
const SetActiveSessionSchema = z.object({
    sessionId: z.string().uuid(),
    eventId: z.string().min(1),
    code: z.string().regex(/^[A-Z0-9]{6}$/).optional(),
    mode: z.string().min(1),
    styleId: z.string().min(1),
});

export interface ActiveSessionData {
    sessionId: string;
    eventId: string;
    code: string;
    name: string;
    whatsapp: string;
    operatorId: string;
    startedAt: string;
    mode: string;
    styleId: string;
}

/**
 * POST /booth/:boothId/active-session
 * Set active session for a booth (operator only)
 */
router.post('/:boothId/active-session', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
        const { boothId } = req.params;
        const operatorId = req.user?.operatorId || 'unknown';

        // Validate request body
        const parseResult = SetActiveSessionSchema.safeParse(req.body);
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

        const { sessionId, eventId, code, mode, styleId } = parseResult.data;

        // Validate session exists and matches eventId
        let sessionData: any = null;

        let resolvedCode = code;

        if (!resolvedCode) {
            const reverseKey = `${SESSION_BY_ID_PREFIX}${sessionId}`;
            const reverseStr = await redis.get(reverseKey);
            if (reverseStr) {
                const reverse = JSON.parse(reverseStr);
                resolvedCode = reverse.code;
            }
        }

        if (resolvedCode) {
            const sessionKey = `${SESSION_KEY_PREFIX}${resolvedCode}`;
            const sessionDataStr = await redis.get(sessionKey);
            if (!sessionDataStr) {
                return res.status(404).json({
                    error: {
                        code: 'SESSION_NOT_FOUND',
                        message: 'Session not found or expired',
                    },
                });
            }
            sessionData = JSON.parse(sessionDataStr);
        }

        if (!sessionData) {
            return res.status(404).json({
                error: {
                    code: 'SESSION_NOT_FOUND',
                    message: 'Session not found or expired',
                },
            });
        }

        // Validate sessionId matches (if provided)
        if (sessionData.sessionId !== sessionId) {
            return res.status(400).json({
                error: {
                    code: 'SESSION_ID_MISMATCH',
                    message: 'SessionId does not match session code',
                },
            });
        }

        // Validate eventId matches
        if (sessionData.eventId !== eventId) {
            return res.status(400).json({
                error: {
                    code: 'EVENT_MISMATCH',
                    message: 'Session eventId does not match provided eventId',
                },
            });
        }

        // Build active session data
        const activeSessionData: ActiveSessionData = {
            sessionId: sessionData.sessionId,
            eventId: sessionData.eventId,
            code: sessionData.code,
            name: sessionData.name,
            whatsapp: sessionData.whatsapp,
            operatorId,
            startedAt: new Date().toISOString(),
            mode,
            styleId,
        };

        // Store in Redis with TTL
        const activeSessionKey = `${ACTIVE_SESSION_KEY_PREFIX}${boothId}`;
        await redis.set(
            activeSessionKey,
            JSON.stringify(activeSessionData),
            'EX',
            ACTIVE_SESSION_TTL_SECONDS
        );

        logger.info({ boothId, sessionId: activeSessionData.sessionId, operatorId }, 'Active session set for booth');

        res.status(200).json({
            data: {
                boothId,
                ...activeSessionData,
                ttlSeconds: ACTIVE_SESSION_TTL_SECONDS,
            },
        });

    } catch (error: any) {
        logger.error({ error }, 'Failed to set active session');
        res.status(500).json({
            error: {
                code: 'INTERNAL_ERROR',
                message: error.message || 'Failed to set active session',
            },
        });
    }
});

/**
 * DELETE /booth/:boothId/active-session
 * Clear active session for a booth (operator only)
 */
router.delete('/:boothId/active-session', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
        const { boothId } = req.params;
        const operatorId = req.user?.operatorId || 'unknown';

        const activeSessionKey = `${ACTIVE_SESSION_KEY_PREFIX}${boothId}`;
        const deleted = await redis.del(activeSessionKey);

        if (deleted === 0) {
            return res.status(404).json({
                error: {
                    code: 'NO_ACTIVE_SESSION',
                    message: 'No active session found for this booth',
                },
            });
        }

        logger.info({ boothId, operatorId }, 'Active session cleared for booth');

        res.status(200).json({
            data: {
                boothId,
                cleared: true,
            },
        });

    } catch (error: any) {
        logger.error({ error }, 'Failed to clear active session');
        res.status(500).json({
            error: {
                code: 'INTERNAL_ERROR',
                message: error.message || 'Failed to clear active session',
            },
        });
    }
});

/**
 * GET /booth/:boothId/active-session
 * Get current active session for a booth (operator only)
 */
router.get('/:boothId/active-session', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
        const { boothId } = req.params;

        const activeSessionKey = `${ACTIVE_SESSION_KEY_PREFIX}${boothId}`;
        const activeSessionStr = await redis.get(activeSessionKey);

        if (!activeSessionStr) {
            return res.status(404).json({
                error: {
                    code: 'NO_ACTIVE_SESSION',
                    message: 'No active session found for this booth',
                },
            });
        }

        const activeSession = JSON.parse(activeSessionStr);
        const ttl = await redis.ttl(activeSessionKey);

        res.status(200).json({
            data: {
                boothId,
                ...activeSession,
                ttlSecondsRemaining: ttl,
            },
        });

    } catch (error: any) {
        logger.error({ error }, 'Failed to get active session');
        res.status(500).json({
            error: {
                code: 'INTERNAL_ERROR',
                message: error.message || 'Failed to get active session',
            },
        });
    }
});

/**
 * POST /booth/:boothId/active-session/refresh
 * Refresh TTL of active session (called when file arrives or operator refreshes)
 */
router.post('/:boothId/active-session/refresh', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
        const { boothId } = req.params;

        const activeSessionKey = `${ACTIVE_SESSION_KEY_PREFIX}${boothId}`;
        const exists = await redis.exists(activeSessionKey);

        if (!exists) {
            return res.status(404).json({
                error: {
                    code: 'NO_ACTIVE_SESSION',
                    message: 'No active session found for this booth',
                },
            });
        }

        // Reset TTL
        await redis.expire(activeSessionKey, ACTIVE_SESSION_TTL_SECONDS);

        const activeSessionStr = await redis.get(activeSessionKey);
        const activeSession = activeSessionStr ? JSON.parse(activeSessionStr) : null;

        logger.info({ boothId }, 'Active session TTL refreshed');

        res.status(200).json({
            data: {
                boothId,
                refreshed: true,
                ttlSeconds: ACTIVE_SESSION_TTL_SECONDS,
                session: activeSession,
            },
        });

    } catch (error: any) {
        logger.error({ error }, 'Failed to refresh active session');
        res.status(500).json({
            error: {
                code: 'INTERNAL_ERROR',
                message: error.message || 'Failed to refresh active session',
            },
        });
    }
});

export default router;

export { ACTIVE_SESSION_KEY_PREFIX, ACTIVE_SESSION_TTL_SECONDS };
