import { pool } from '../db/client'
import type { TelemetryPayload } from '../validators/telemetry'

function log(level: string, event: string, fields: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ level, ts: new Date().toISOString(), event, ...fields }))
}

export async function syncVehicle(payload: TelemetryPayload): Promise<void> {
  try {
    await pool.query(
      `UPDATE vehicles
       SET soc_percent = $1,
           odometer = GREATEST(odometer, $2),
           status = CASE WHEN status != $3 THEN $3 ELSE status END,
           version = CASE WHEN status != $3 THEN version + 1 ELSE version END
       WHERE id = $4`,
      [Math.round(payload.soc), Math.round(payload.odometer), payload.status, payload.vehicle_id],
    )
  } catch (err) {
    log('error', 'vehicle_sync_failed', { vehicleId: payload.vehicle_id, error: (err as Error).message })
  }
}
