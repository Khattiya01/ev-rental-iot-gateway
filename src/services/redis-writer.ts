import { redis } from '../redis/client'
import type { TelemetryPayload } from '../validators/telemetry'

const POSITION_TTL_SECONDS = 300

function log(level: string, event: string, fields: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ level, ts: new Date().toISOString(), event, ...fields }))
}

export async function writePosition(payload: TelemetryPayload): Promise<void> {
  const value = JSON.stringify({
    lat: payload.lat,
    lng: payload.lng,
    soc: payload.soc,
    speed: payload.speed,
    status: payload.status,
    updated_at: new Date().toISOString(),
  })

  try {
    await redis.set(`vehicle:pos:${payload.vehicle_id}`, value, 'EX', POSITION_TTL_SECONDS)
  } catch (err) {
    log('error', 'redis_write_failed', { vehicleId: payload.vehicle_id, error: (err as Error).message })
  }
}
