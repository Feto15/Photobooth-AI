import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { config } from '../../config';
import { redis } from '../../config/redis';
import { logger } from '../../index';

const router = Router();

const RATE_LIMIT_KEY_PREFIX = 'ratelimit:login:';
const RATE_LIMIT_WINDOW_SECONDS = 60;

async function checkRateLimit(ip: string): Promise<boolean> {
    const key = `${RATE_LIMIT_KEY_PREFIX}${ip}`;
    const current = await redis.incr(key);
    if (current === 1) {
        await redis.expire(key, RATE_LIMIT_WINDOW_SECONDS);
    }
    return current <= config.rateLimit.loginLimit;
}

router.post('/login', async (req: Request, res: Response) => {
    try {
        const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
        
        // Rate limiting
        const allowed = await checkRateLimit(clientIp);
        if (!allowed) {
            logger.warn({ ip: clientIp }, 'Login rate limit exceeded');
            return res.status(429).json({
                error: {
                    code: 'RATE_LIMITED',
                    message: 'Too many login attempts. Please try again later.',
                },
            });
        }

        const { password } = req.body;

        if (!password || typeof password !== 'string') {
            return res.status(400).json({
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'Password is required',
                },
            });
        }

        let isValid = false;

        // Check against hashed password if available (production)
        if (config.operatorPasswordHash) {
            isValid = await bcrypt.compare(password, config.operatorPasswordHash);
        } else {
            // Fallback to plaintext comparison (dev only)
            isValid = password === config.operatorPassword;
            if (isValid) {
                logger.warn('Using plaintext password comparison. Set OPERATOR_PASSWORD_HASH in production.');
            }
        }

        if (!isValid) {
            logger.warn({ ip: clientIp }, 'Invalid login attempt');
            return res.status(401).json({
                error: {
                    code: 'INVALID_CREDENTIALS',
                    message: 'Invalid password',
                },
            });
        }

        const token = jwt.sign(
            { sub: 'operator-1', role: 'operator' },
            config.jwtSecret,
            { expiresIn: config.jwtExpiresIn as jwt.SignOptions['expiresIn'] }
        );

        logger.info({ ip: clientIp }, 'Operator logged in');

        res.json({
            data: {
                token,
                expiresIn: 3600,
            },
        });
    } catch (error: any) {
        logger.error({ error }, 'Login error');
        res.status(500).json({
            error: {
                code: 'INTERNAL_ERROR',
                message: 'Login failed',
            },
        });
    }
});

export default router;
