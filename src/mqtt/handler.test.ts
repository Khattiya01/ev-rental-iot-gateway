import { describe, it, expect, vi, beforeEach } from 'vitest'

const validateTelemetryMock = vi.fn()
const vehicleExistsMock = vi.fn()
const writePositionMock = vi.fn().mockResolvedValue(undefined)
const enqueueTelemetryMock = vi.fn()
const checkBatteryAlertMock = vi.fn().mockResolvedValue(undefined)
const resolveOfflineAlertMock = vi.fn().mockResolvedValue(undefined)
const syncVehicleMock = vi.fn().mockResolvedValue(undefined)
const recordMessageMock = vi.fn()

vi.mock('../validators/telemetry', () => ({ validateTelemetry: validateTelemetryMock }))
vi.mock('../services/vehicle-validator', () => ({ vehicleExists: vehicleExistsMock }))
vi.mock('../services/redis-writer', () => ({ writePosition: writePositionMock }))
vi.mock('../services/telemetry-writer', () => ({ enqueueTelemetry: enqueueTelemetryMock }))
vi.mock('../services/alert-service', () => ({
  checkBatteryAlert: checkBatteryAlertMock,
  resolveOfflineAlert: resolveOfflineAlertMock,
}))
vi.mock('../services/vehicle-sync', () => ({ syncVehicle: syncVehicleMock }))
vi.mock('../services/message-rate-tracker', () => ({ recordMessage: recordMessageMock }))

const samplePayload = {
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
}

describe('handleMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('ignores messages on topics that do not match vehicle/{id}/data, without counting them', async () => {
    const { handleMessage } = await import('./handler')
    handleMessage('some/other/topic', Buffer.from('{}'))

    expect(recordMessageMock).not.toHaveBeenCalled()
    expect(validateTelemetryMock).not.toHaveBeenCalled()
  })

  it('counts the message but drops it silently on invalid JSON', async () => {
    const { handleMessage } = await import('./handler')
    handleMessage('vehicle/veh-1/data', Buffer.from('{not valid json'))

    expect(recordMessageMock).toHaveBeenCalledTimes(1)
    expect(validateTelemetryMock).not.toHaveBeenCalled()
  })

  it('stops at validation failure and never checks the vehicle or writes anywhere', async () => {
    validateTelemetryMock.mockReturnValue({ success: false, error: 'soc: too small' })
    const { handleMessage } = await import('./handler')

    handleMessage('vehicle/veh-1/data', Buffer.from(JSON.stringify(samplePayload)))
    await vi.waitFor(() => expect(validateTelemetryMock).toHaveBeenCalledTimes(1))

    expect(vehicleExistsMock).not.toHaveBeenCalled()
    expect(writePositionMock).not.toHaveBeenCalled()
  })

  it('stops after an unknown vehicle and never writes to Redis/Postgres', async () => {
    validateTelemetryMock.mockReturnValue({ success: true, data: samplePayload })
    vehicleExistsMock.mockResolvedValue(false)
    const { handleMessage } = await import('./handler')

    handleMessage('vehicle/veh-1/data', Buffer.from(JSON.stringify(samplePayload)))
    await vi.waitFor(() => expect(vehicleExistsMock).toHaveBeenCalledTimes(1))

    expect(writePositionMock).not.toHaveBeenCalled()
    expect(syncVehicleMock).not.toHaveBeenCalled()
  })

  it('processes a valid message in the documented order: validate -> exists -> redis -> resolve-offline -> telemetry -> battery-alert -> sync', async () => {
    validateTelemetryMock.mockReturnValue({ success: true, data: samplePayload })
    vehicleExistsMock.mockResolvedValue(true)

    const callOrder: string[] = []
    writePositionMock.mockImplementation(async () => { callOrder.push('writePosition') })
    resolveOfflineAlertMock.mockImplementation(async () => { callOrder.push('resolveOfflineAlert') })
    enqueueTelemetryMock.mockImplementation(() => { callOrder.push('enqueueTelemetry') })
    checkBatteryAlertMock.mockImplementation(async () => { callOrder.push('checkBatteryAlert') })
    syncVehicleMock.mockImplementation(async () => { callOrder.push('syncVehicle') })

    const { handleMessage } = await import('./handler')
    handleMessage('vehicle/veh-1/data', Buffer.from(JSON.stringify(samplePayload)))

    await vi.waitFor(() => expect(syncVehicleMock).toHaveBeenCalledTimes(1))

    expect(callOrder).toEqual([
      'writePosition',
      'resolveOfflineAlert',
      'enqueueTelemetry',
      'checkBatteryAlert',
      'syncVehicle',
    ])
    expect(recordMessageMock).toHaveBeenCalledTimes(1)
  })

  it('extracts the vehicle id from the topic, not the payload', async () => {
    validateTelemetryMock.mockReturnValue({ success: true, data: samplePayload })
    vehicleExistsMock.mockResolvedValue(true)
    const { handleMessage } = await import('./handler')

    handleMessage('vehicle/topic-vehicle-id/data', Buffer.from(JSON.stringify(samplePayload)))

    await vi.waitFor(() => expect(vehicleExistsMock).toHaveBeenCalledWith('topic-vehicle-id'))
  })
})
