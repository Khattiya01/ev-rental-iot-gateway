import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { TelemetryPayload } from '../validators/telemetry'

const setMock = vi.fn().mockResolvedValue('OK')

vi.mock('../redis/client', () => ({
  redis: { set: setMock },
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

describe('writePosition', () => {
  beforeEach(() => {
    setMock.mockClear()
    setMock.mockResolvedValue('OK')
  })

  it('writes the Redis key in the exact format expected by Next.js + GPS Simulator', async () => {
    const { writePosition } = await import('./redis-writer')
    const payload = makePayload()

    await writePosition(payload)

    expect(setMock).toHaveBeenCalledTimes(1)
    const [key, value, exFlag, ttl] = setMock.mock.calls[0]
    expect(key).toBe(`vehicle:pos:${payload.vehicle_id}`)
    expect(exFlag).toBe('EX')
    expect(ttl).toBe(300)

    const parsed = JSON.parse(value)
    expect(parsed).toMatchObject({
      lat: payload.lat,
      lng: payload.lng,
      soc: payload.soc,
      speed: payload.speed,
      status: payload.status,
    })
    expect(parsed.updated_at).toBeDefined()
    // heading/temperature are intentionally NOT cached to Redis — Next.js doesn't read them (YAGNI)
    expect(parsed).not.toHaveProperty('heading')
    expect(parsed).not.toHaveProperty('temperature')
  })

  it('does not throw when Redis write fails', async () => {
    const { writePosition } = await import('./redis-writer')
    setMock.mockRejectedValueOnce(new Error('connection refused'))

    await expect(writePosition(makePayload())).resolves.toBeUndefined()
  })
})
