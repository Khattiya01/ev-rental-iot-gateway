import { pool } from '../db/client'
import type { TelemetryPayload } from '../validators/telemetry'

const ALERT_TYPE = 'battery_low'
const WARNING_THRESHOLD = 20
const CRITICAL_THRESHOLD = 15

function log(level: string, event: string, fields: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ level, ts: new Date().toISOString(), event, ...fields }))
}

export async function checkBatteryAlert(payload: TelemetryPayload): Promise<void> {
  if (payload.soc >= WARNING_THRESHOLD) return

  const severity = payload.soc < CRITICAL_THRESHOLD ? 'critical' : 'warning'

  try {
    // INSERT ... WHERE NOT EXISTS keeps the debounce check atomic with the write,
    // closing the race a separate SELECT-then-INSERT would leave between concurrent messages.
    const result = await pool.query(
      `INSERT INTO alerts (type, severity, message, entity_id)
       SELECT $1::varchar, $2::alert_severity, $3::varchar, $4::varchar
       WHERE NOT EXISTS (
         SELECT 1 FROM alerts WHERE entity_id = $4::varchar AND type = $1::varchar AND resolved = false
       )`,
      [ALERT_TYPE, severity, `Battery low (${payload.soc}%)`, payload.vehicle_id],
    )
    if (result.rowCount && result.rowCount > 0) {
      log('info', 'battery_alert_created', { vehicleId: payload.vehicle_id, soc: payload.soc, severity })
    }
  } catch (err) {
    log('error', 'battery_alert_failed', { vehicleId: payload.vehicle_id, error: (err as Error).message })
  }
}

// Receiving valid telemetry means the vehicle is reachable again — unlike battery_low
// (manual resolve only), 'offline' is a connectivity state that's simply over once data flows again.
export async function resolveOfflineAlert(vehicleId: string): Promise<void> {
  try {
    await pool.query(
      `UPDATE alerts SET resolved = true WHERE entity_id = $1 AND type = 'vehicle_offline' AND resolved = false`,
      [vehicleId],
    )
  } catch (err) {
    log('error', 'resolve_offline_alert_failed', { vehicleId, error: (err as Error).message })
  }
}
