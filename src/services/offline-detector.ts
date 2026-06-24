import cron, { type ScheduledTask } from 'node-cron'
import { pool } from '../db/client'
import { redis } from '../redis/client'

const SCAN_PATTERN = 'vehicle:pos:*'
const KEY_PREFIX = 'vehicle:pos:'
const ALERT_TYPE = 'vehicle_offline'

function log(level: string, event: string, fields: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ level, ts: new Date().toISOString(), event, ...fields }))
}

export async function scanOnlineVehicleIds(): Promise<Set<string>> {
  const online = new Set<string>()
  let cursor = '0'
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', SCAN_PATTERN, 'COUNT', 100)
    cursor = next
    for (const key of keys) online.add(key.slice(KEY_PREFIX.length))
  } while (cursor !== '0')
  return online
}

async function markOffline(vehicleId: string): Promise<void> {
  try {
    // status condition re-checked here (not just in the caller's SELECT) to close the
    // race against a message arriving between the scan and this write
    const result = await pool.query(
      `UPDATE vehicles SET status = 'offline', version = version + 1
       WHERE id = $1 AND status NOT IN ('offline', 'under_repair')`,
      [vehicleId],
    )
    if (result.rowCount === 0) return

    await pool.query(
      `INSERT INTO alerts (type, severity, message, entity_id)
       SELECT $1::varchar, 'critical'::alert_severity, $2::varchar, $3::varchar
       WHERE NOT EXISTS (
         SELECT 1 FROM alerts WHERE entity_id = $3::varchar AND type = $1::varchar AND resolved = false
       )`,
      [ALERT_TYPE, 'Vehicle went offline', vehicleId],
    )
    log('info', 'vehicle_marked_offline', { vehicleId })
  } catch (err) {
    log('error', 'mark_offline_failed', { vehicleId, error: (err as Error).message })
  }
}

export async function detectOfflineVehicles(): Promise<void> {
  try {
    const onlineIds = await scanOnlineVehicleIds()

    // under_repair vehicles intentionally have no telemetry while in the workshop —
    // excluded so the cron doesn't clobber that status with 'offline'
    const { rows } = await pool.query<{ id: string }>(
      `SELECT id FROM vehicles WHERE status NOT IN ('offline', 'under_repair')`,
    )

    const newlyOffline = rows.filter((r) => !onlineIds.has(r.id))
    for (const { id } of newlyOffline) {
      await markOffline(id)
    }
  } catch (err) {
    log('error', 'offline_detector_failed', { error: (err as Error).message })
  }
}

let scheduledTask: ScheduledTask | null = null

export function startOfflineDetector(): void {
  scheduledTask = cron.schedule('* * * * *', () => {
    void detectOfflineVehicles()
  })
  log('info', 'offline_detector_started')
}

export function stopOfflineDetector(): void {
  scheduledTask?.stop()
  log('info', 'offline_detector_stopped')
}
