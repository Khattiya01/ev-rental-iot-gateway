import { pool } from '../db/client'
import type { TelemetryPayload } from '../validators/telemetry'

const BATCH_SIZE = Number(process.env.TELEMETRY_BATCH_SIZE ?? 10)
const BATCH_INTERVAL_MS = Number(process.env.TELEMETRY_BATCH_INTERVAL_MS ?? 2000)
const COLUMNS_PER_ROW = 8

function log(level: string, event: string, fields: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ level, ts: new Date().toISOString(), event, ...fields }))
}

let buffer: TelemetryPayload[] = []

export function enqueueTelemetry(payload: TelemetryPayload): void {
  buffer.push(payload)
  if (buffer.length >= BATCH_SIZE) drainTelemetry()
}

export async function drainTelemetry(): Promise<void> {
  if (buffer.length === 0) return
  const batch = buffer
  buffer = []

  const values: unknown[] = []
  const rows = batch.map((item, i) => {
    const offset = i * COLUMNS_PER_ROW
    values.push(item.vehicle_id, item.timestamp, Math.round(item.soc), item.temperature, item.charge_cycles, null, item.lat, item.lng)
    const placeholders = Array.from({ length: COLUMNS_PER_ROW }, (_, j) => `$${offset + j + 1}`)
    return `(${placeholders.join(', ')})`
  })

  const sql = `INSERT INTO telemetry_history (vehicle_id, recorded_at, soc_percent, temperature, charge_cycles, deep_discharge_count, lat, lng) VALUES ${rows.join(', ')}`

  try {
    await pool.query(sql, values)
  } catch (err) {
    log('error', 'telemetry_insert_failed', { count: batch.length, error: (err as Error).message })
  }
}

let flushInterval: ReturnType<typeof setInterval> | null = setInterval(() => {
  drainTelemetry().catch((err) => log('error', 'telemetry_flush_failed', { error: (err as Error).message }))
}, BATCH_INTERVAL_MS)

export function stopTelemetryFlushInterval(): void {
  if (flushInterval) {
    clearInterval(flushInterval)
    flushInterval = null
  }
}
