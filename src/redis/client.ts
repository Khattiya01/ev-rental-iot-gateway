import Redis from 'ioredis'

function log(level: string, event: string, fields: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ level, ts: new Date().toISOString(), event, ...fields }))
}

export const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  retryStrategy: (times) => Math.min(times * 1_000, 60_000),
})

redis.on('connect', () => {
  log('info', 'redis_connected')
})

redis.on('error', (err) => {
  log('error', 'redis_error', { error: err.message })
})
