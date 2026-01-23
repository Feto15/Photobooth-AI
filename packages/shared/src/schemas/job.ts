import { z } from 'zod';

export const JobStatusSchema = z.enum(['queued', 'running', 'succeeded', 'failed', 'canceled']);
export type JobStatus = z.infer<typeof JobStatusSchema>;

export const CreateJobRequestSchema = z.object({
    sessionId: z.string().uuid('sessionId must be a valid UUID'),
    eventId: z.string().min(1, 'eventId is required'),
    mode: z.string().min(1, 'mode is required'),
    styleId: z.string().min(1, 'styleId is required'),
    metadata: z.string().optional(), // JSON string for additional metadata
});

export type CreateJobRequest = z.infer<typeof CreateJobRequestSchema>;

export const JobDataSchema = z.object({
    jobId: z.string().uuid().or(z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/)), // UUID or ULID
    sessionId: z.string().uuid(),
    eventId: z.string().min(1),
    participantName: z.string(), // From session snapshot
    participantWhatsapp: z.string(), // From session snapshot
    mode: z.string(),
    styleId: z.string(),
    providerType: z.enum(['kie', 'comfy']).default('kie'),
    inputKey: z.string(),
    inputContentType: z.string(),
    inputSha256: z.string(),
    inputSizeBytes: z.number(),
    createdAt: z.string().datetime(),
});

export type JobData = z.infer<typeof JobDataSchema>;

export const JobProgressSchema = z.object({
    percent: z.number().min(0).max(100),
    stage: z.string(),
});

export type JobProgress = z.infer<typeof JobProgressSchema>;

export const JobReturnValueSchema = z.object({
    outputKeys: z.array(z.string()),
    bestOutputKey: z.string(),
    providerRequestId: z.string().optional(),
    seed: z.number().optional(),
    metadata: z.record(z.any()).optional(),
    errorCode: z.string().optional(),
    errorMessage: z.string().optional(),
});

export type JobReturnValue = z.infer<typeof JobReturnValueSchema>;
