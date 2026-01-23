import { Queue } from 'bullmq';
import { config } from './index';

export const jobQueue = new Queue('job-queue', {
    connection: {
        url: config.redis.url,
    }
});
