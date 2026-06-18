import { Pool } from 'pg'

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
})

pool.on('error', (err) => {
  console.log(JSON.stringify({ level: 'error', ts: new Date().toISOString(), event: 'db_pool_error', error: err.message }))
})
