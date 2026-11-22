export interface BackgroundOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  name?: string;
  onError?: (error: unknown, name: string) => void | Promise<void>;
}

export function background(task: (signal: AbortSignal) => void | Promise<void>, options: BackgroundOptions = {}): Promise<void> {
  const { signal: parent, timeoutMs, name = 'background task', onError = (error, label) => console.error(label + ' failed', error) } = options;
  if (timeoutMs !== undefined && (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647)) {
    throw new RangeError('Background task timeout must be a positive timer duration');
  }
  const deadline = new AbortController();
  const signals = [parent, deadline.signal].filter((value): value is AbortSignal => value !== undefined);
  const signal = signals.length > 1 ? AbortSignal.any(signals) : signals[0];
  return new Promise<void>((resolve) => {
    setImmediate(() => {
      const timer = timeoutMs === undefined ? undefined : setTimeout(() => deadline.abort(new Error('Background task timed out')), timeoutMs);
      void Promise.resolve()
        .then(() => {
          signal.throwIfAborted();
          return task(signal);
        })
        .catch((error) => {
          if (parent?.aborted) return;
          try {
            void Promise.resolve(onError(error, name)).catch(() => {});
          } catch {}
        })
        .finally(() => {
          if (timer) clearTimeout(timer);
          resolve();
        });
    });
  });
}
