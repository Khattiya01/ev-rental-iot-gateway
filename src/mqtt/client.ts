import mqtt, { type MqttClient } from 'mqtt'
import { handleMessage } from './handler'

const TOPIC = 'vehicle/+/data'
const INITIAL_RECONNECT_DELAY_MS = 1_000
const MAX_RECONNECT_DELAY_MS = 60_000

let client: MqttClient | null = null
let reconnectDelayMs = INITIAL_RECONNECT_DELAY_MS
let reconnectTimer: ReturnType<typeof setTimeout> | null = null

function log(level: string, event: string, fields: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ level, ts: new Date().toISOString(), event, ...fields }))
}

function scheduleReconnect(): void {
  if (reconnectTimer) return
  const delayMs = reconnectDelayMs
  reconnectDelayMs = Math.min(reconnectDelayMs * 2, MAX_RECONNECT_DELAY_MS)
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    log('info', 'mqtt_reconnecting', { delayMs })
    connect()
  }, delayMs)
}

function connect(): MqttClient {
  const c = mqtt.connect(process.env.MQTT_URL ?? 'mqtt://localhost:1883', {
    username: process.env.MQTT_USERNAME,
    password: process.env.MQTT_PASSWORD,
    reconnectPeriod: 0,
  })

  c.on('connect', () => {
    reconnectDelayMs = INITIAL_RECONNECT_DELAY_MS
    log('info', 'mqtt_connected')
    c.subscribe(TOPIC, (err) => {
      if (err) log('error', 'mqtt_subscribe_failed', { topic: TOPIC, error: err.message })
      else log('info', 'mqtt_subscribed', { topic: TOPIC })
    })
  })

  c.on('message', (topic, payload) => handleMessage(topic, payload))

  c.on('close', () => {
    log('warn', 'mqtt_disconnected')
    scheduleReconnect()
  })

  c.on('error', (err) => {
    log('error', 'mqtt_error', { error: err.message })
  })

  client = c
  return c
}

export function connectMqtt(): MqttClient {
  return client ?? connect()
}

export function getMqttClient(): MqttClient | null {
  return client
}
