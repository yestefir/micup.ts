import assert from 'node:assert/strict';
import test from 'node:test';
import { MicupUserSession } from '../dist/index.js';

test('connects with a user session and edits only supported profile fields', async (t) => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input);
    calls.push({ url, init });
    if (url.pathname === '/.well-known/fluxer') {
      return Response.json({ endpoints: { api_public: 'https://micup.example/api' } });
    }
    if (url.pathname === '/api/v1/users/@me' && init.method === 'GET') {
      return Response.json({ id: '123', username: 'user', bot: false });
    }
    return Response.json({ id: '123', username: 'updated', bot: false });
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const session = await MicupUserSession.connect({ token: 'user.fixture', origin: 'https://micup.example' });
  assert.equal(session.self.id, '123');
  assert.equal((await session.editCurrentUser({ username: 'updated', bio: null })).username, 'updated');
  assert.equal(calls[0].init.headers, undefined);
  assert.equal(calls[1].init.headers.get('Authorization'), 'user.fixture');
  assert.equal(calls[2].init.headers.get('Authorization'), 'user.fixture');
  assert.deepEqual(JSON.parse(calls[2].init.body), { username: 'updated', bio: null });
  assert.throws(() => session.editCurrentUser({ email: 'private@example.com' }), /Unsupported Micup profile field/);
  assert.throws(() => session.editCurrentUser({}), /at least one field/);
  assert.equal(calls.length, 3);
});

test('rejects a discovered API on another origin before sending the user token', async (t) => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input) => {
    calls.push(new URL(input));
    return Response.json({ endpoints: { api_public: 'https://attacker.example/api' } });
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  await assert.rejects(MicupUserSession.connect({ token: 'user.fixture', origin: 'https://micup.example' }), /invalid API endpoint/);
  assert.equal(calls.length, 1);
});

test('preserves the discovery HTTP error when its body cannot be cancelled', async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(new ReadableStream({
    cancel() {
      return Promise.reject(new Error('stream cancellation failed'));
    },
  }), { status: 503 });
  t.after(() => { globalThis.fetch = originalFetch; });
  await assert.rejects(MicupUserSession.connect({ token: 'user.fixture', origin: 'https://micup.example' }), (error) =>
    error.name === 'MicupAPIError' && error.status === 503);
});

test('rejects oversized discovery responses before authenticating a user', async (t) => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response('', { headers: { 'content-length': String(64 * 1024 + 1) } });
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  await assert.rejects(MicupUserSession.connect({ token: 'user.fixture', origin: 'https://micup.example' }), /discovery response exceeds its size limit/);
  assert.equal(calls, 1);
});

test('rejects bot credentials for a user session', async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => new URL(input).pathname === '/.well-known/fluxer'
    ? Response.json({ endpoints: { api_public: 'https://micup.example/api' } })
    : Response.json({ id: '123', username: 'bot', bot: true });
  t.after(() => { globalThis.fetch = originalFetch; });
  await assert.rejects(MicupUserSession.connect({ token: 'bot.fixture', origin: 'https://micup.example' }), /credential must belong to a Micup user/);
});
