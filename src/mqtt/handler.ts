import { validateTelemetry } from '../validators/telemetry'
import { vehicleExists } from '../services/vehicle-validator'
import { writePosition } from '../services/redis-writer'
import { enqueueTelemetry } from '../services/telemetry-writer'

const TOPIC_PATTERN = /^vehicle\/([^/]+)\/data$/

function log(level: string, event: string, fields: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ level, ts: new Date().toISOString(), event, ...fields }))
}

export function handleMessage(topic: string, payload: Buffer): void {
  const match = TOPIC_PATTERN.exec(topic)
  if (!match) {
    log('warn', 'mqtt_topic_unrecognized', { topic })
    return
  }
  const vehicleId = match[1]

  let data: unknown
  try {
    data = JSON.parse(payload.toString())
  } catch {
    log('warn', 'mqtt_payload_invalid_json', { topic, vehicleId })
    return
  }

  validateAndProcess(vehicleId, data).catch((err) => {
    log('error', 'telemetry_processing_failed', { vehicleId, error: (err as Error).message })
  })
}

async function validateAndProcess(vehicleId: string, data: unknown): Promise<void> {
  const result = validateTelemetry(data)
  if (!result.success) {
    log('warn', 'telemetry_validation_failed', { vehicleId, error: result.error })
    return
  }

  if (!(await vehicleExists(vehicleId))) {
    log('warn', 'telemetry_unknown_vehicle', { vehicleId })
    return
  }

  await writePosition(result.data)
  enqueueTelemetry(result.data)

  log('info', 'telemetry_received', { vehicleId })
}
