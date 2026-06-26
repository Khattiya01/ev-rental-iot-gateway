import { describe, it, expect, vi, beforeEach } from 'vitest'

const scanMock = vi.fn()
const queryMock = vi.fn()

vi.mock('../redis/client', () => ({
  redis: { scan: scanMock },
}))

vi.mock('../db/client', () => ({
  pool: { query: queryMock },
}))

describe('scanOnlineVehicleIds', () => {
  beforeEach(() => {
    scanMock.mockReset()
  })

  it('strips the "vehicle:pos:" prefix to return bare vehicle ids', async () => {
    const { scanOnlineVehicleIds } = await import('./offline-detector')
    scanMock.mockResolvedValueOnce(['0', ['vehicle:pos:aaa', 'vehicle:pos:bbb']])

    const online = await scanOnlineVehicleIds()

    expect(online).toEqual(new Set(['aaa', 'bbb']))
    expect(scanMock).toHaveBeenCalledWith('0', 'MATCH', 'vehicle:pos:*', 'COUNT', 100)
  })

  it('follows the SCAN cursor across multiple pages until it returns to "0"', async () => {
    const { scanOnlineVehicleIds } = await import('./offline-detector')
    scanMock
      .mockResolvedValueOnce(['5', ['vehicle:pos:aaa']])
      .mockResolvedValueOnce(['0', ['vehicle:pos:bbb']])

    const online = await scanOnlineVehicleIds()

    expect(online).toEqual(new Set(['aaa', 'bbb']))
    expect(scanMock).toHaveBeenCalledTimes(2)
    expect(scanMock.mock.calls[1][0]).toBe('5')
  })

  it('returns an empty set when no vehicle is reporting position', async () => {
    const { scanOnlineVehicleIds } = await import('./offline-detector')
    scanMock.mockResolvedValueOnce(['0', []])

    const online = await scanOnlineVehicleIds()

    expect(online).toEqual(new Set())
  })
})

describe('detectOfflineVehicles', () => {
  beforeEach(() => {
    scanMock.mockReset()
    queryMock.mockReset()
  })

  function mockDbWith(rows: { id: string }[], updateRowCounts: Record<string, number> = {}) {
    queryMock.mockImplementation(async (sql: string, params: unknown[] = []) => {
      if (sql.includes('SELECT id FROM vehicles')) return { rows }
      if (sql.includes('UPDATE vehicles')) {
        const vehicleId = params[0] as string
        return { rowCount: updateRowCounts[vehicleId] ?? 1 }
      }
      if (sql.includes('INSERT INTO alerts')) return { rowCount: 1 }
      return { rows: [], rowCount: 0 }
    })
  }

  it('excludes vehicles already offline or under_repair from candidates via the SQL filter', async () => {
    scanMock.mockResolvedValueOnce(['0', []])
    mockDbWith([])
    const { detectOfflineVehicles } = await import('./offline-detector')

    await detectOfflineVehicles()

    const [selectSql] = queryMock.mock.calls[0]
    expect(selectSql).toContain("NOT IN ('offline', 'under_repair')")
  })

  it('marks only vehicles missing from the online set as offline, leaves online ones alone', async () => {
    scanMock.mockResolvedValueOnce(['0', ['vehicle:pos:a']]) // only 'a' is online
    mockDbWith([{ id: 'a' }, { id: 'b' }, { id: 'c' }])
    const { detectOfflineVehicles } = await import('./offline-detector')

    await detectOfflineVehicles()

    const updateCalls = queryMock.mock.calls.filter(([sql]) => sql.includes('UPDATE vehicles'))
    const updatedIds = updateCalls.map(([, params]) => params[0])
    expect(updatedIds.sort()).toEqual(['b', 'c'])

    const alertCalls = queryMock.mock.calls.filter(([sql]) => sql.includes('INSERT INTO alerts'))
    const alertedIds = alertCalls.map(([, params]) => params[2])
    expect(alertedIds.sort()).toEqual(['b', 'c'])
  })

  it('does not create a duplicate offline alert when the UPDATE affects 0 rows (already offline)', async () => {
    scanMock.mockResolvedValueOnce(['0', []])
    mockDbWith([{ id: 'b' }], { b: 0 })
    const { detectOfflineVehicles } = await import('./offline-detector')

    await detectOfflineVehicles()

    const alertCalls = queryMock.mock.calls.filter(([sql]) => sql.includes('INSERT INTO alerts'))
    expect(alertCalls).toHaveLength(0)
  })

  it('does not throw when the DB or Redis call fails', async () => {
    scanMock.mockRejectedValueOnce(new Error('redis down'))
    const { detectOfflineVehicles } = await import('./offline-detector')

    await expect(detectOfflineVehicles()).resolves.toBeUndefined()
  })
})
