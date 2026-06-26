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

describe('checkBatteryAlert', () => {
  beforeEach(() => {
    queryMock.mockClear()
    queryMock.mockResolvedValue({ rowCount: 1 })
  })

  it('does not create an alert when soc is at or above the warning threshold (20%)', async () => {
    const { checkBatteryAlert } = await import('./alert-service')
    await checkBatteryAlert(makePayload({ soc: 20 }))
    expect(queryMock).not.toHaveBeenCalled()

    await checkBatteryAlert(makePayload({ soc: 55 }))
    expect(queryMock).not.toHaveBeenCalled()
  })

  it('creates a "warning" alert for soc between 15 and 20 (exclusive of 20)', async () => {
    const { checkBatteryAlert } = await import('./alert-service')
    await checkBatteryAlert(makePayload({ soc: 18 }))

    expect(queryMock).toHaveBeenCalledTimes(1)
    const [sql, params] = queryMock.mock.calls[0]
    expect(sql).toContain('INSERT INTO alerts')
    expect(sql).toContain('WHERE NOT EXISTS')
    expect(params[0]).toBe('battery_low')
    expect(params[1]).toBe('warning')
  })

  it('creates a "critical" alert for soc below 15', async () => {
    const { checkBatteryAlert } = await import('./alert-service')
    await checkBatteryAlert(makePayload({ soc: 10, vehicle_id: 'veh-critical' }))

    const [, params] = queryMock.mock.calls[0]
    expect(params[1]).toBe('critical')
    expect(params[3]).toBe('veh-critical')
  })

  it('uses an atomic INSERT...WHERE NOT EXISTS for debounce instead of SELECT-then-INSERT', async () => {
    // Regression guard: a separate SELECT-then-INSERT previously raced under concurrent
    // gateway instances and produced duplicate alert rows microseconds apart.
    const { checkBatteryAlert } = await import('./alert-service')
    await checkBatteryAlert(makePayload({ soc: 5 }))

    expect(queryMock).toHaveBeenCalledTimes(1)
    const [sql] = queryMock.mock.calls[0]
    expect(sql).toMatch(/WHERE NOT EXISTS/)
  })

  it('does not throw when the DB write fails', async () => {
    const { checkBatteryAlert } = await import('./alert-service')
    queryMock.mockRejectedValueOnce(new Error('connection terminated'))

    await expect(checkBatteryAlert(makePayload({ soc: 5 }))).resolves.toBeUndefined()
  })
})

describe('resolveOfflineAlert', () => {
  beforeEach(() => {
    queryMock.mockClear()
    queryMock.mockResolvedValue({ rowCount: 1 })
  })

  it('resolves only the vehicle_offline alert for the given vehicle', async () => {
    const { resolveOfflineAlert } = await import('./alert-service')
    await resolveOfflineAlert('veh-1')

    expect(queryMock).toHaveBeenCalledTimes(1)
    const [sql, params] = queryMock.mock.calls[0]
    expect(sql).toContain("type = 'vehicle_offline'")
    expect(sql).toContain('resolved = true')
    expect(params).toEqual(['veh-1'])
  })

  it('does not throw when the DB write fails', async () => {
    const { resolveOfflineAlert } = await import('./alert-service')
    queryMock.mockRejectedValueOnce(new Error('connection terminated'))

    await expect(resolveOfflineAlert('veh-1')).resolves.toBeUndefined()
  })
})
