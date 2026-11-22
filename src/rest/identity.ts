const digits = /^\d+$/;
const base64 = /^[A-Za-z0-9+/_-]+={0,2}$/;

export function tokenId(token: string): string | undefined {
  if (typeof token !== 'string' || !token.includes('.')) return undefined;
  const head = token.slice(0, token.indexOf('.'));
  if (!head) return undefined;
  if (base64.test(head)) {
    const decoded = Buffer.from(head.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('latin1');
    if (decoded && digits.test(decoded)) return decoded;
  }
  return digits.test(head) ? head : undefined;
}
