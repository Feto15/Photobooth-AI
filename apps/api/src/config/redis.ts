import Redis from 'ioredis';
import { config } from './index';

export const redis = new Redis(config.redis.url);
