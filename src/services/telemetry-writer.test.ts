import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { TelemetryPayload } from '../validators/telemetry'

const queryMock = vi.fn().mockResolvedValue({})

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

// BATCH_SIZE/BATCH_INTERVAL_MS are read from env at module import time, and the flush
// interval starts immediately on import — so every test needs a fresh module instance
// under a controlled, fake-timed env.
describe('telemetry-writer batching', () => {
  beforeEach(() => {
    vi.resetModules()
    queryMock.mockClear()
    queryMock.mockResolvedValue({})
    vi.useFakeTimers()
    process.env.TELEMETRY_BATCH_SIZE = '3'
    process.env.TELEMETRY_BATCH_INTERVAL_MS = '2000'
  })

  afterEach(() => {
    vi.useRealTimers()
    delete process.env.TELEMETRY_BATCH_SIZE
    delete process.env.TELEMETRY_BATCH_INTERVAL_MS
  })

  it('does not flush before the buffer reaches the batch size or the interval elapses', async () => {
    const { enqueueTelemetry, stopTelemetryFlushInterval } = await import('./telemetry-writer')
    enqueueTelemetry(makePayload())
    enqueueTelemetry(makePayload())

    expect(queryMock).not.toHaveBeenCalled()
    stopTelemetryFlushInterval()
  })

  it('flushes immediately once the buffer reaches the configured batch size', async () => {
    const { enqueueTelemetry, stopTelemetryFlushInterval } = await import('./telemetry-writer')
    enqueueTelemetry(makePayload({ vehicle_id: 'a' }))
    enqueueTelemetry(makePayload({ vehicle_id: 'b' }))
    enqueueTelemetry(makePayload({ vehicle_id: 'c' })) // hits BATCH_SIZE=3

    expect(queryMock).toHaveBeenCalledTimes(1)
    const [sql] = queryMock.mock.calls[0]
    expect(sql).toContain('INSERT INTO telemetry_history')
    expect(sql.match(/\(\$/g)).toHaveLength(3) // 3 row tuples
    stopTelemetryFlushInterval()
  })

  it('flushes on the interval even if the batch size has not been reached', async () => {
    const { enqueueTelemetry, stopTelemetryFlushInterval } = await import('./telemetry-writer')
    enqueueTelemetry(makePayload())

    await vi.advanceTimersByTimeAsync(2000)

    expect(queryMock).toHaveBeenCalledTimes(1)
    stopTelemetryFlushInterval()
  })

  it('rounds soc to an integer for the soc_percent column (regression: float caused an insert failure in production)', async () => {
    const { enqueueTelemetry, stopTelemetryFlushInterval } = await import('./telemetry-writer')
    enqueueTelemetry(makePayload({ soc: 78.5 }))
    await vi.advanceTimersByTimeAsync(2000)

    const [, values] = queryMock.mock.calls[0]
    // column order: vehicle_id, recorded_at, soc_percent, temperature, charge_cycles, deep_discharge_count, lat, lng
    expect(values[2]).toBe(79)
    expect(Number.isInteger(values[2])).toBe(true)
    stopTelemetryFlushInterval()
  })

  it('always inserts deep_discharge_count as null (no source data from MQTT payload yet)', async () => {
    const { enqueueTelemetry, stopTelemetryFlushInterval } = await import('./telemetry-writer')
    enqueueTelemetry(makePayload())
    await vi.advanceTimersByTimeAsync(2000)

    const [, values] = queryMock.mock.calls[0]
    expect(values[5]).toBeNull()
    stopTelemetryFlushInterval()
  })

  it('does not flush again after stopTelemetryFlushInterval() is called', async () => {
    const { enqueueTelemetry, stopTelemetryFlushInterval } = await import('./telemetry-writer')
    enqueueTelemetry(makePayload())
    stopTelemetryFlushInterval()

    await vi.advanceTimersByTimeAsync(10_000)

    expect(queryMock).not.toHaveBeenCalled()
  })

  it('does not throw when the batch INSERT fails', async () => {
    queryMock.mockRejectedValueOnce(new Error('connection terminated'))
    const { enqueueTelemetry, drainTelemetry, stopTelemetryFlushInterval } = await import('./telemetry-writer')
    enqueueTelemetry(makePayload())

    await expect(drainTelemetry()).resolves.toBeUndefined()
    stopTelemetryFlushInterval()
  })
})
