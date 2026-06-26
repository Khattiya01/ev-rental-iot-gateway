import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const queryMock = vi.fn()

vi.mock('../db/client', () => ({
  pool: { query: queryMock },
}))

// Cache is a module-scoped Map, so each test needs a fresh module instance.
describe('vehicleExists', () => {
  beforeEach(() => {
    vi.resetModules()
    queryMock.mockReset()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('queries the DB and returns true when the vehicle exists', async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 1 })
    const { vehicleExists } = await import('./vehicle-validator')

    await expect(vehicleExists('veh-1')).resolves.toBe(true)
    expect(queryMock).toHaveBeenCalledTimes(1)
  })

  it('returns false when the vehicle is not found, and caches the negative result', async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 0 })
    const { vehicleExists } = await import('./vehicle-validator')

    await expect(vehicleExists('veh-missing')).resolves.toBe(false)

    await vehicleExists('veh-missing')
    expect(queryMock).toHaveBeenCalledTimes(1) // second call hit the cache
  })

  it('does not re-query the DB within the 5 minute cache TTL', async () => {
    queryMock.mockResolvedValue({ rowCount: 1 })
    const { vehicleExists } = await import('./vehicle-validator')

    await vehicleExists('veh-1')
    await vi.advanceTimersByTimeAsync(4 * 60_000) // 4 min — still within TTL
    await vehicleExists('veh-1')

    expect(queryMock).toHaveBeenCalledTimes(1)
  })

  it('re-queries the DB once the cache entry expires after 5 minutes', async () => {
    queryMock.mockResolvedValue({ rowCount: 1 })
    const { vehicleExists } = await import('./vehicle-validator')

    await vehicleExists('veh-1')
    await vi.advanceTimersByTimeAsync(5 * 60_000 + 1)
    await vehicleExists('veh-1')

    expect(queryMock).toHaveBeenCalledTimes(2)
  })

  it('falls back to false when the DB query fails and there is no prior cache entry', async () => {
    queryMock.mockRejectedValueOnce(new Error('connection terminated'))
    const { vehicleExists } = await import('./vehicle-validator')

    await expect(vehicleExists('veh-new')).resolves.toBe(false)
  })

  it('falls back to the last known cached value when a refresh query fails after TTL expiry', async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 1 }) // initial lookup succeeds → exists=true
    const { vehicleExists } = await import('./vehicle-validator')

    await expect(vehicleExists('veh-1')).resolves.toBe(true)

    await vi.advanceTimersByTimeAsync(5 * 60_000 + 1) // expire the cache entry
    queryMock.mockRejectedValueOnce(new Error('connection terminated'))

    // DB is unreachable on the refresh attempt — should fall back to the stale cached value
    // (true) rather than failing closed to false.
    await expect(vehicleExists('veh-1')).resolves.toBe(true)
  })
})
