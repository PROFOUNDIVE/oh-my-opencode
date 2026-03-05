export function createSemaphore(maxConcurrency: number): { run: <T>(fn: () => Promise<T>) => Promise<T> } {
  const max = Math.max(1, Math.floor(maxConcurrency))
  let available = max
  const queue: Array<() => void> = []

  async function acquire(): Promise<() => void> {
    while (available <= 0) {
      await new Promise<void>((resolve) => queue.push(resolve))
    }
    available--

    return () => {
      available++
      const next = queue.shift()
      if (next) next()
    }
  }

  return {
    run: async <T>(fn: () => Promise<T>) => {
      const release = await acquire()
      try {
        return await fn()
      } finally {
        release()
      }
    },
  }
}
