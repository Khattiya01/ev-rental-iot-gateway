import { pool } from '../db/client'

const CACHE_TTL_MS = 5 * 60_000

const cache = new Map<string, { exists: boolean; expiresAt: number }>()

function log(level: string, event: string, fields: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ level, ts: new Date().toISOString(), event, ...fields }))
}

export async function vehicleExists(vehicleId: string): Promise<boolean> {
  const cached = cache.get(vehicleId)
  if (cached && cached.expiresAt > Date.now()) return cached.exists

  let exists: boolean
  try {
    const result = await pool.query('SELECT 1 FROM vehicles WHERE id = $1 LIMIT 1', [vehicleId])
    exists = result.rowCount !== null && result.rowCount > 0
  } catch (err) {
    log('error', 'vehicle_lookup_failed', { vehicleId, error: (err as Error).message })
    return cached?.exists ?? false
  }

  cache.set(vehicleId, { exists, expiresAt: Date.now() + CACHE_TTL_MS })
  return exists
}
