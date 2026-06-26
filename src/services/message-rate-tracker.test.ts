import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Module holds rate state in top-level variables, so each test needs a fresh module
// instance (vi.resetModules) loaded under fake timers — otherwise the real 60s
// setInterval registered at import time would leak across tests.
describe('message-rate-tracker', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('reports 0 before the first 60s window elapses', async () => {
    const { getMessageRate } = await import('./message-rate-tracker')
    expect(getMessageRate()).toBe(0)
  })

  it('reports the count from the previous window, not the in-progress one', async () => {
    const { recordMessage, getMessageRate } = await import('./message-rate-tracker')

    recordMessage()
    recordMessage()
    recordMessage()
    // Window hasn't reset yet — rate should still read the old (empty) window.
    expect(getMessageRate()).toBe(0)

    await vi.advanceTimersByTimeAsync(60_000)
    expect(getMessageRate()).toBe(3)
  })

  it('resets the in-progress counter after each window', async () => {
    const { recordMessage, getMessageRate } = await import('./message-rate-tracker')

    recordMessage()
    recordMessage()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(getMessageRate()).toBe(2)

    recordMessage()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(getMessageRate()).toBe(1)
  })
})
