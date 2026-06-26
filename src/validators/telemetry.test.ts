import { describe, it, expect } from 'vitest'
import { validateTelemetry } from './telemetry'

function basePayload(overrides: Record<string, unknown> = {}) {
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

describe('validateTelemetry', () => {
  it('accepts a valid payload matching the MQTT contract', () => {
    const result = validateTelemetry(basePayload())
    expect(result.success).toBe(true)
  })

  it('rejects a non-UUID vehicle_id', () => {
    const result = validateTelemetry(basePayload({ vehicle_id: 'not-a-uuid' }))
    expect(result.success).toBe(false)
  })

  it.each([
    ['lat above range', { lat: 91 }],
    ['lat below range', { lat: -91 }],
    ['lng above range', { lng: 181 }],
    ['lng below range', { lng: -181 }],
    ['soc above range', { soc: 101 }],
    ['soc below range', { soc: -1 }],
    ['speed above range', { speed: 201 }],
    ['heading above range', { heading: 361 }],
    ['temperature above range', { temperature: 81 }],
    ['negative odometer', { odometer: -1 }],
    ['negative charge_cycles', { charge_cycles: -1 }],
  ])('rejects %s', (_label, overrides) => {
    const result = validateTelemetry(basePayload(overrides))
    expect(result.success).toBe(false)
  })

  it('rejects an unknown status value', () => {
    const result = validateTelemetry(basePayload({ status: 'parked' }))
    expect(result.success).toBe(false)
  })

  it('rejects a timestamp older than 60 seconds (clock drift protection)', () => {
    const staleTimestamp = new Date(Date.now() - 61_000).toISOString()
    const result = validateTelemetry(basePayload({ timestamp: staleTimestamp }))
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error).toContain('timestamp')
  })

  it('accepts a timestamp just under the 60 second drift window', () => {
    const freshTimestamp = new Date(Date.now() - 59_000).toISOString()
    const result = validateTelemetry(basePayload({ timestamp: freshTimestamp }))
    expect(result.success).toBe(true)
  })

  it('rejects a payload missing a required field', () => {
    const payload = basePayload() as Record<string, unknown>
    delete payload.soc
    const result = validateTelemetry(payload)
    expect(result.success).toBe(false)
  })
})
