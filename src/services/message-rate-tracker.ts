const WINDOW_MS = 60_000

let messageCount = 0
let lastRate = 0

export function recordMessage(): void {
  messageCount += 1
}

function resetWindow(): void {
  lastRate = messageCount
  messageCount = 0
}

export function getMessageRate(): number {
  return lastRate
}

setInterval(resetWindow, WINDOW_MS)
