import { Router } from 'express'
import { scanOnlineVehicleIds } from '../services/offline-detector'
import { getMessageRate } from '../services/message-rate-tracker'

function log(level: string, event: string, fields: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ level, ts: new Date().toISOString(), event, ...fields }))
}

export const statusRouter = Router()

statusRouter.get('/status', async (_req, res) => {
  let vehiclesOnline = 0
  try {
    vehiclesOnline = (await scanOnlineVehicleIds()).size
  } catch (err) {
    log('error', 'status_online_scan_failed', { error: (err as Error).message })
  }

  res.status(200).json({
    vehiclesOnline,
    messagesPerMinute: getMessageRate(),
  })
})
