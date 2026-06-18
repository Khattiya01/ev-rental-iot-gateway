import 'dotenv/config'
import express from 'express'
import { connectMqtt } from './mqtt/client'

const app = express()
const port = process.env.PORT ?? 3001

app.listen(port, () => {
  console.log(JSON.stringify({ level: 'info', ts: new Date().toISOString(), event: 'gateway_started', port }))
})

connectMqtt()
