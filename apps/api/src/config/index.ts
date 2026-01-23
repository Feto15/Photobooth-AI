import dotenv from 'dotenv';

dotenv.config();

export const config = {
    port: parseInt(process.env.PORT || '3000', 10),
    jwtSecret: process.env.JWT_SECRET || 'default-secret-change-in-production',
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || '1h',
    operatorPassword: process.env.OPERATOR_PASSWORD || 'password123',
    operatorPasswordHash: process.env.OPERATOR_PASSWORD_HASH,
    redis: {
        url: process.env.REDIS_URL || 'redis://localhost:6379',
    },
    s3: {
        endpoint: process.env.S3_ENDPOINT,
        region: process.env.S3_REGION || 'auto',
        bucket: process.env.S3_BUCKET || 'photobooth',
        accessKeyId: process.env.S3_ACCESS_KEY_ID,
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
        forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
    },
    cors: {
        allowedOrigins: process.env.CORS_ALLOWED_ORIGINS?.split(',') || ['http://localhost:5173'],
    },
    rateLimit: {
        loginLimit: parseInt(process.env.LOGIN_RATE_LIMIT || '5', 10),
        jobCreateLimit: parseInt(process.env.JOB_CREATE_RATE_LIMIT || '10', 10),
        sessionCreateLimit: parseInt(process.env.SESSION_CREATE_RATE_LIMIT || '30', 10),
    },
    upload: {
        maxFileSizeBytes: parseInt(process.env.MAX_FILE_SIZE_BYTES || `${10 * 1024 * 1024}`, 10), // 10MB
        allowedMimeTypes: (process.env.ALLOWED_MIME_TYPES || 'image/jpeg,image/png,image/webp').split(','),
    },
    idempotency: {
        ttlSeconds: parseInt(process.env.IDEMPOTENCY_TTL_SECONDS || '1800', 10), // 30 minutes
    },
    sessionTtlSeconds: parseInt(process.env.SESSION_TTL_SECONDS || '21600', 10), // 6 hours
};
