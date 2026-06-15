export interface StoppableBackend {
  stop(): Promise<unknown>;
}

export async function stopBackendWithTimeout(
  backend: StoppableBackend | null,
  timeoutMs = 2000,
): Promise<boolean> {
  if (!backend) return true;

  let timedOut = false;
  await Promise.race([
    backend.stop().catch(() => undefined),
    new Promise<void>((resolve) =>
      setTimeout(() => {
        timedOut = true;
        resolve();
      }, timeoutMs),
    ),
  ]);

  return !timedOut;
}
