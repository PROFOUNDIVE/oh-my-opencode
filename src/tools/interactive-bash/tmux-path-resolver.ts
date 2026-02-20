let cachedTmuxPath: string | null = null
let pendingTmuxPath: Promise<string | null> | null = null

async function resolveTmuxPath(): Promise<string | null> {
  try {
    return Bun.which("tmux")
  } catch {
    return null
  }
}

export async function getTmuxPath(): Promise<string | null> {
  if (cachedTmuxPath !== null) {
    return cachedTmuxPath
  }

  if (pendingTmuxPath) {
    return pendingTmuxPath
  }

  pendingTmuxPath = (async () => {
    const path = await resolveTmuxPath()
    cachedTmuxPath = path
    pendingTmuxPath = null
    return path
  })()

  return pendingTmuxPath
}

export function startBackgroundCheck(): void {
  void getTmuxPath()
}
