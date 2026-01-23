import dotenv from 'dotenv';

dotenv.config();

export const config = {
    port: parseInt(process.env.PORT || '3001', 10),
    jwtSecret: process.env.JWT_SECRET || 'super-secret-key-change-in-production',
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || '1h',
    
    // MVP: single operator password (should be hashed in env for production)
    operatorPasswordHash: process.env.OPERATOR_PASSWORD_HASH,
    // Fallback for dev (plaintext, will be hashed on first use)
    operatorPassword: process.env.OPERATOR_PASSWORD || 'admin123',
    
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
        // Comma-separated list of allowed origins, or '*' for dev
        allowedOrigins: process.env.CORS_ALLOWED_ORIGINS?.split(',') || ['http://localhost:5173'],
    },
    
    rateLimit: {
        // Requests per minute
        loginLimit: parseInt(process.env.RATE_LIMIT_LOGIN || '10', 10),
        jobCreateLimit: parseInt(process.env.RATE_LIMIT_JOB_CREATE || '30', 10),
    },
    
    upload: {
        maxFileSizeBytes: parseInt(process.env.MAX_FILE_SIZE_BYTES || String(10 * 1024 * 1024), 10), // 10MB default
        allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
    },
    
    idempotency: {
        ttlSeconds: parseInt(process.env.IDEMPOTENCY_TTL_SECONDS || '600', 10), // 10 minutes
    },
};
