import { Router } from 'express'
import { getMqttClient } from '../mqtt/client'
import { redis } from '../redis/client'
import { pool } from '../db/client'

function log(level: string, event: string, fields: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ level, ts: new Date().toISOString(), event, ...fields }))
}

function checkMqtt(): boolean {
  return getMqttClient()?.connected ?? false
}

function checkRedis(): boolean {
  return redis.status === 'ready'
}

async function checkDb(): Promise<boolean> {
  try {
    await pool.query('SELECT 1')
    return true
  } catch (err) {
    log('error', 'health_db_check_failed', { error: (err as Error).message })
    return false
  }
}

export const healthRouter = Router()

healthRouter.get('/health', async (_req, res) => {
  const mqtt = checkMqtt()
  const redisOk = checkRedis()
  const db = await checkDb()

  const healthy = mqtt && redisOk && db
  if (!healthy) {
    log('warn', 'health_check_degraded', { mqtt, redis: redisOk, db })
  }
  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'degraded',
    mqtt,
    redis: redisOk,
    db,
  })
})
