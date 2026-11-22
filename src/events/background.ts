export interface BackgroundOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  name?: string;
  onError?: (error: unknown, name: string) => void;
}

export function background(task: (signal: AbortSignal) => void | Promise<void>, options: BackgroundOptions = {}): Promise<void> {
  const { signal: parent, timeoutMs, name = 'background task', onError = (error, label) => console.error(label + ' failed', error) } = options;
  if (timeoutMs !== undefined && (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647)) {
    throw new RangeError('Background task timeout must be a positive timer duration');
  }
  const signals = [parent, timeoutMs === undefined ? undefined : AbortSignal.timeout(timeoutMs)].filter((value): value is AbortSignal => value !== undefined);
  const signal = signals.length ? AbortSignal.any(signals) : new AbortController().signal;
  return new Promise<void>((resolve) => {
    setImmediate(() => {
      void Promise.resolve()
        .then(() => task(signal))
        .catch((error) => {
          if (parent?.aborted) return;
          try {
            onError(error, name);
          } catch {}
        })
        .finally(resolve);
    });
  });
}
