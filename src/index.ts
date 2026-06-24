import 'dotenv/config'
import express from 'express'
import { connectMqtt, disconnectMqtt } from './mqtt/client'
import { startOfflineDetector, stopOfflineDetector } from './services/offline-detector'
import { drainTelemetry, stopTelemetryFlushInterval } from './services/telemetry-writer'
import { redis } from './redis/client'
import { pool } from './db/client'
import { healthRouter } from './api/health'
import { statusRouter } from './api/status'

function log(level: string, event: string, fields: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ level, ts: new Date().toISOString(), event, ...fields }))
}

const app = express()
const port = process.env.PORT ?? 3001

app.use(healthRouter)
app.use(statusRouter)

const server = app.listen(port, () => {
  log('info', 'gateway_started', { port })
})

connectMqtt()
startOfflineDetector()

let shuttingDown = false

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true

  // pm2 sends SIGTERM and expects a timely exit before it considers the process
  // unresponsive; without this, a hung drain/connection-close would block restarts forever
  const forceExitTimer = setTimeout(() => {
    log('error', 'shutdown_timeout_forced_exit')
    process.exit(1)
  }, 10_000)
  forceExitTimer.unref()

  log('info', 'shutdown_initiated', { signal })

  // close the HTTP listener first so /health and /status stop accepting new
  // connections before Redis/the pool get torn down underneath them
  await new Promise<void>((resolve) => server.close(() => resolve()))

  // stop accepting/scheduling new work before draining what's already buffered
  stopOfflineDetector()
  disconnectMqtt()
  stopTelemetryFlushInterval()

  try {
    await drainTelemetry()
  } catch (err) {
    log('error', 'telemetry_drain_failed', { error: (err as Error).message })
  }

  try {
    await redis.quit()
  } catch (err) {
    log('error', 'redis_quit_failed', { error: (err as Error).message })
  }

  try {
    await pool.end()
  } catch (err) {
    log('error', 'db_pool_end_failed', { error: (err as Error).message })
  }

  log('info', 'shutdown_complete')
  process.exit(0)
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
