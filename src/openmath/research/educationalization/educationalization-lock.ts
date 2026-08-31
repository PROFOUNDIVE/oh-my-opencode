const queues = new Map<string, Promise<void>>()

export async function withEducationalizationLock<Result>(
  educationalizationId: string,
  operation: () => Promise<Result>,
): Promise<Result> {
  const previous = queues.get(educationalizationId) ?? Promise.resolve()
  let release = (): void => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const queued = previous.then(() => gate)
  queues.set(educationalizationId, queued)
  await previous
  try {
    return await operation()
  } finally {
    release()
    if (queues.get(educationalizationId) === queued) queues.delete(educationalizationId)
  }
}
