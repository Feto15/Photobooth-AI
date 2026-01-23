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
        const payload = req.body as KieCallbackPayload;

        if (!payload.taskId) {
            logger.warn('Kie callback received without taskId');
            return res.status(400).json({ error: 'taskId is required' });
        }

        logger.info({ taskId: payload.taskId, status: payload.status }, 'Kie callback received');

        // Get jobId from taskId mapping
        const jobId = await redis.get(`${KIE_TASK_MAPPING_PREFIX}${payload.taskId}`);
        
        if (!jobId) {
            logger.warn({ taskId: payload.taskId }, 'No job found for taskId');
            return res.status(404).json({ error: 'Task not found' });
        }

        // Publish callback result to Redis channel for worker to receive
        const callbackData = JSON.stringify({
            taskId: payload.taskId,
            jobId,
            status: payload.status,
            imageUrls: payload.output?.image_urls || payload.output?.images || [],
            error: payload.error,
        });

        await redis.publish(KIE_CALLBACK_CHANNEL, callbackData);

        logger.info({ taskId: payload.taskId, jobId }, 'Callback published to worker');

        res.json({ success: true });

    } catch (error: any) {
        logger.error({ error: error.message }, 'Kie callback error');
        res.status(500).json({ error: 'Internal error' });
    }
});

export default router;

export { KIE_CALLBACK_CHANNEL, KIE_TASK_MAPPING_PREFIX };
