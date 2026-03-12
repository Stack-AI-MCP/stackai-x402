import Redis from 'ioredis'
import { parseConfig } from './config.js'

let _redis: Redis | null = null

/**
 * Returns the ioredis singleton, creating it on first call.
 * The connection is lazy — ioredis connects on first command.
 */
export function getRedis(): Redis {
  if (!_redis) {
    const config = parseConfig()
    _redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null })
  }
  return _redis
}
