import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { TelemetryPayload } from '../validators/telemetry'

const queryMock = vi.fn().mockResolvedValue({ rowCount: 1 })

vi.mock('../db/client', () => ({
  pool: { query: queryMock },
}))

function makePayload(overrides: Partial<TelemetryPayload> = {}): TelemetryPayload {
  return {
    vehicle_id: '550e8400-e29b-41d4-a716-446655440000',
    lat: 13.7563,
    lng: 100.5018,
    speed: 45.5,
    heading: 180,
    soc: 78.5,
    temperature: 35.2,
    odometer: 12450,
    charge_cycles: 142,
    status: 'rented',
    timestamp: new Date().toISOString(),
    ...overrides,
  }
}

describe('syncVehicle', () => {
  beforeEach(() => {
    queryMock.mockClear()
    queryMock.mockResolvedValue({ rowCount: 1 })
  })

  it('rounds soc/odometer and passes status + vehicle_id in order', async () => {
    const { syncVehicle } = await import('./vehicle-sync')
    const payload = makePayload({ soc: 78.5, odometer: 12450.9 })

    await syncVehicle(payload)

    expect(queryMock).toHaveBeenCalledTimes(1)
    const [sql, params] = queryMock.mock.calls[0]
    expect(sql).toContain('UPDATE vehicles')
    expect(sql).toContain('GREATEST(odometer')
    expect(params).toEqual([79, 12451, 'rented', payload.vehicle_id])
  })

  it('uses GREATEST() so the DB itself never lets odometer roll back', async () => {
    // The rollback guard is enforced in SQL (`GREATEST(odometer, $2)`), not in JS —
    // this asserts the query still ships that guard rather than a plain assignment.
    const { syncVehicle } = await import('./vehicle-sync')
    await syncVehicle(makePayload())

    const [sql] = queryMock.mock.calls[0]
    expect(sql).toMatch(/GREATEST\(odometer,\s*\$2\)/)
  })

  it('only bumps version when status actually changes (CASE WHEN status != $3)', async () => {
    const { syncVehicle } = await import('./vehicle-sync')
    await syncVehicle(makePayload())

    const [sql] = queryMock.mock.calls[0]
    expect(sql).toMatch(/CASE WHEN status != \$3 THEN version \+ 1 ELSE version END/)
  })

  it('does not throw when the DB write fails', async () => {
    const { syncVehicle } = await import('./vehicle-sync')
    queryMock.mockRejectedValueOnce(new Error('connection terminated'))

    await expect(syncVehicle(makePayload())).resolves.toBeUndefined()
  })
})
