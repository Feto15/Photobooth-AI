import { StorageClient } from '@photobot/shared';
import { config } from './index';

export const storageClient = new StorageClient({
    endpoint: config.s3.endpoint,
    region: config.s3.region,
    bucket: config.s3.bucket,
    credentials: {
        accessKeyId: config.s3.accessKeyId || '',
        secretAccessKey: config.s3.secretAccessKey || '',
    },
    forcePathStyle: config.s3.forcePathStyle,
});
