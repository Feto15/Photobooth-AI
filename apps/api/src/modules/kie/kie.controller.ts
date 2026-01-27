import { Router, Request, Response } from 'express';
import { redis } from '../../config/redis';
import { logger } from '../../index';

const router = Router();

const KIE_CALLBACK_CHANNEL = 'kie:callback';
const KIE_TASK_MAPPING_PREFIX = 'kie:task:';

export interface KieCallbackPayload {
    taskId: string;
    status: 'completed' | 'failed';
    output?: {
        image_urls?: string[];
        images?: string[];
    };
    error?: string;
}

router.post('/callback', async (req: Request, res: Response) => {
    try {
        const body = req.body || {};
        const data = body.data || {};
        const result = body.result || {};

        logger.info({ bodyKeys: Object.keys(body) }, 'Kie callback received');
        logger.info({ body }, 'Kie callback raw');

        // 1. Unified Task ID Extraction (Handle camelCase and snake_case)
        const taskId = body.taskId || body.task_id || body.id ||
            data.taskId || data.task_id ||
            result.taskId || result.task_id;

        if (!taskId) {
            logger.warn({ bodyKeys: Object.keys(body) }, 'Kie callback missing taskId/task_id');
            return res.status(400).json({ error: 'taskId is required' });
        }

        // 2. Unified Status Extraction
        const rawStatus = (
            body.status ||
            data.status ||
            data.state ||
            data.callbackType ||
            result.status ||
            ''
        ).toString().toLowerCase();

        const code = body.code;

        const isSuccess =
            ['completed', 'success', 'complete', 'succeeded'].includes(rawStatus) ||
            code === 200;

        const normalizedStatus = isSuccess ? 'completed' : 'failed';

        // 3. Unified Result Extraction (Flexible image/video/audio URLs)
        let imageUrls: string[] = [];

        // Check various standard locations
        const possibleImageSources = [
            body.image_urls, body.images,
            body.output?.image_urls, body.output?.images,
            data.image_urls, data.images,
            result.image_urls, result.images,
            body.output_urls, data.output_urls
        ];

        for (const src of possibleImageSources) {
            if (Array.isArray(src) && src.length > 0) {
                imageUrls = src.map(s => typeof s === 'string' ? s : (s.url || s.image_url || s.audio_url)).filter(Boolean);
                break;
            }
        }

        // Handle resultJson (Sora-2 / Video style)
        if (imageUrls.length === 0 && data.resultJson) {
            try {
                const parsed = JSON.parse(data.resultJson);
                if (Array.isArray(parsed.resultUrls)) {
                    imageUrls = parsed.resultUrls;
                }
            } catch (e) {
                logger.warn({ taskId }, 'Failed to parse resultJson in callback');
            }
        }

        // Handle Music/Flat Data Array (Suno style)
        if (imageUrls.length === 0 && Array.isArray(data.data)) {
            imageUrls = data.data
                .map((item: any) => item.image_url || item.audio_url || item.url)
                .filter(Boolean);
        }

        logger.info({ taskId, status: normalizedStatus, foundUrls: imageUrls.length }, 'Kie callback analyzed');

        // 4. Redis Publish & Notification
        const jobId = await redis.get(`${KIE_TASK_MAPPING_PREFIX}${taskId}`);

        if (!jobId) {
            logger.warn({ taskId }, 'No internal jobId found for this taskId mapping');
            return res.status(404).json({ error: 'Task mapping not found' });
        }

        const callbackData = JSON.stringify({
            taskId,
            jobId,
            status: normalizedStatus,
            imageUrls,
            error: isSuccess ? null : (body.msg || body.message || data.error || 'AI Processing Failed'),
        });

        await redis.publish(KIE_CALLBACK_CHANNEL, callbackData);

        res.json({ success: true });

    } catch (error: any) {
        logger.error({ error: error.message }, 'Fatal error in Kie callback handler');
        res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;

export { KIE_CALLBACK_CHANNEL, KIE_TASK_MAPPING_PREFIX };
