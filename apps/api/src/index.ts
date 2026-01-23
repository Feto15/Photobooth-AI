import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import pino from 'pino';
import { config } from './config';
import { redis } from './config/redis';
import authRouter from './modules/auth/auth.controller';
import jobsRouter from './modules/jobs/jobs.controller';
import kieRouter from './modules/kie/kie.controller';

export const logger = pino({
    transport: {
        target: 'pino-pretty',
        options: {
            colorize: true,
        },
    },
});

const app = express();

// Trust proxy for rate limiting by IP
app.set('trust proxy', 1);

app.use(helmet());

// CORS with allowlist
app.use(cors({
    origin: (origin, callback) => {
        // Allow requests with no origin (mobile apps, curl, etc.)
        if (!origin) {
            return callback(null, true);
        }
        if (config.cors.allowedOrigins.includes(origin) || config.cors.allowedOrigins.includes('*')) {
            return callback(null, true);
        }
        logger.warn({ origin }, 'CORS blocked request from origin');
        return callback(new Error('Not allowed by CORS'), false);
    },
    credentials: true,
}));

app.use(compression());
app.use(express.json());

// Health check with Redis ping
app.get('/health', async (req, res) => {
    try {
        const redisStatus = await redis.ping();
        res.json({
            status: 'ok',
            timestamp: new Date().toISOString(),
            services: {
                redis: redisStatus === 'PONG' ? 'ok' : 'error',
            },
        });
    } catch (error) {
        logger.error({ error }, 'Health check failed');
        res.status(503).json({
            status: 'error',
            timestamp: new Date().toISOString(),
            services: {
                redis: 'error',
            },
        });
    }
});

app.use('/auth', authRouter);
app.use('/jobs', jobsRouter);
app.use('/api/kie', kieRouter);

// Error handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    logger.error({ error: err.message }, 'Unhandled error');
    res.status(err.status || 500).json({
        error: {
            code: 'INTERNAL_ERROR',
            message: err.message || 'Internal server error',
        },
    });
});

// Start server
app.listen(config.port, () => {
    logger.info(`Server is running on http://localhost:${config.port}`);
});

export { app };
