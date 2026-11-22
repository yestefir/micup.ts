export const maxDiscoveryResponseBytes = 64 * 1024;

export async function readLimitedJson(
  response: Response,
  limit: number,
  label: string,
  signal?: AbortSignal,
): Promise<unknown> {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError('A JSON response limit must be a positive safe integer');
  if (!response.body) return undefined;
  const tooLarge = () => new RangeError(label + ' response exceeds its size limit');
  const announced = Number(response.headers.get('content-length'));
  if (announced > limit) {
    await response.body.cancel().catch(() => {});
    signal?.throwIfAborted();
    throw tooLarge();
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.length;
      if (size > limit) {
        await reader.cancel().catch(() => {});
        signal?.throwIfAborted();
        throw tooLarge();
      }
      chunks.push(next.value);
    }
  } catch (error) {
    signal?.throwIfAborted();
    throw error;
  } finally {
    reader.releaseLock();
  }
  signal?.throwIfAborted();
  if (!size) return undefined;
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size)));
  } catch (cause) {
    throw new Error(label + ' returned invalid JSON', { cause });
  }
}
