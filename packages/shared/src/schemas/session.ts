import { z } from 'zod';

export const SessionDataSchema = z.object({
    sessionId: z.string().uuid(),
    eventId: z.string().min(1).default('default-event'),
    name: z.string().min(2, 'Name must be at least 2 characters'),
    whatsapp: z.string().regex(/^62\d{8,13}$/, 'WhatsApp must start with 62 and be 10-15 digits total'),
    code: z.string().regex(/^[A-Z0-9]{6}$/, 'Code must be 6 uppercase alphanumeric characters'),
    createdAt: z.string().datetime(),
});

export type SessionData = z.infer<typeof SessionDataSchema>;

export const CreateSessionRequestSchema = z.object({
    eventId: z.string().min(1).optional().default('default-event'),
    name: z.string().min(2, 'Name must be at least 2 characters'),
    whatsapp: z.string().regex(/^62\d{8,13}$/, 'WhatsApp must start with 62 and be 10-15 digits total'),
});

export type CreateSessionRequest = z.infer<typeof CreateSessionRequestSchema>;

export const SessionResponseSchema = z.object({
    sessionId: z.string().uuid(),
    code: z.string(),
    expiresAt: z.string().datetime(),
});

export type SessionResponse = z.infer<typeof SessionResponseSchema>;

export const GetSessionResponseSchema = z.object({
    sessionId: z.string().uuid(),
    eventId: z.string(),
    name: z.string(),
    whatsapp: z.string(),
});

export type GetSessionResponse = z.infer<typeof GetSessionResponseSchema>;