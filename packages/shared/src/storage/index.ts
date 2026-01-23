import {
    S3Client,
    PutObjectCommand,
    GetObjectCommand,
    S3ClientConfig
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export interface StorageConfig {
    endpoint?: string;
    region: string;
    bucket: string;
    credentials: {
        accessKeyId: string;
        secretAccessKey: string;
    };
    forcePathStyle?: boolean;
}

export class StorageClient {
    private client: S3Client;
    private bucket: string;

    constructor(config: StorageConfig) {
        const s3Config: S3ClientConfig = {
            region: config.region,
            credentials: config.credentials,
            forcePathStyle: config.forcePathStyle,
        };

        if (config.endpoint) {
            s3Config.endpoint = config.endpoint;
        }

        this.client = new S3Client(s3Config);
        this.bucket = config.bucket;
    }

    async putObject(key: string, body: Buffer | Uint8Array, contentType: string) {
        const command = new PutObjectCommand({
            Bucket: this.bucket,
            Key: key,
            Body: body,
            ContentType: contentType,
        });

        return this.client.send(command);
    }

    async getObject(key: string) {
        const command = new GetObjectCommand({
            Bucket: this.bucket,
            Key: key,
        });

        const response = await this.client.send(command);
        if (!response.Body) {
            throw new Error(`Object not found: ${key}`);
        }

        // Convert stream to Buffer
        const chunks: any[] = [];
        for await (const chunk of response.Body as any) {
            chunks.push(chunk);
        }
        return Buffer.concat(chunks);
    }

    async createSignedGetUrl(key: string, ttlSeconds: number = 3600) {
        const command = new GetObjectCommand({
            Bucket: this.bucket,
            Key: key,
        });

        return getSignedUrl(this.client, command, { expiresIn: ttlSeconds });
    }

    static buildKey(eventId: string, jobId: string, type: 'input' | 'output', ext: string, index?: number) {
        const date = new Date().toISOString().split('T')[0];
        const filename = type === 'input' ? `input.${ext}` : `output_${index ?? 1}.${ext}`;
        return `events/${eventId}/${date}/${jobId}/${filename}`;
    }
}
