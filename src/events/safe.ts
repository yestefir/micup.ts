import type { GatewayDispatch } from '../gateway/protocol.js';

export interface SafeHandlerOptions {
  timeoutMs?: number;
  onError?: (error: unknown, event: GatewayDispatch) => void;
  retry?: (error: unknown, event: GatewayDispatch) => boolean;
}

type Handler = (event: GatewayDispatch, signal: AbortSignal) => void | Promise<void>;

export function safeHandler(handler: Handler, options: SafeHandlerOptions = {}): Handler {
  const { timeoutMs, onError, retry } = options;
  if (timeoutMs !== undefined && (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647)) {
    throw new RangeError('Gateway handler timeout must be a positive timer duration');
  }

  return async (event, parent) => {
    parent.throwIfAborted();
    const deadline = timeoutMs === undefined ? undefined : AbortSignal.timeout(timeoutMs);
    const signal = deadline ? AbortSignal.any([parent, deadline]) : parent;

    try {
      await new Promise<void>((resolve, reject) => {
        const stop = () => reject(signal.reason);
        signal.addEventListener('abort', stop, { once: true });
        const execute = async () => {
          signal.throwIfAborted();
          await handler(event, signal);
        };
        void execute().then(resolve, reject).finally(() => signal.removeEventListener('abort', stop));
      });
    } catch (error) {
      if (parent.aborted || retry?.(error, event)) throw error;
      onError?.(error, event);
    }
  };
}
