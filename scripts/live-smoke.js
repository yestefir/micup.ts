import assert from 'node:assert/strict';
import { MicupClient } from '../dist/index.js';

const token = process.env.MICUP_TEST_BOT_TOKEN;
if (!token) throw new Error('Set MICUP_TEST_BOT_TOKEN to run the live smoke checks');

const client = await MicupClient.connect({
  token,
  ...(process.env.MICUP_TEST_ORIGIN && { origin: process.env.MICUP_TEST_ORIGIN }),
});

assert.equal(client.self.bot, true, 'the credential must belong to a bot');
assert.equal(typeof client.self.id, 'string');
assert.ok(client.self.id.length > 0);
process.stdout.write('REST identity check passed\n');

const application = await client.application();
assert.equal(typeof application.id, 'string');
assert.ok(application.id.length > 0);
process.stdout.write('REST application check passed\n');

const stop = new AbortController();
const deadline = AbortSignal.timeout(20_000);
let gatewayReady = false;
const session = client.newSession({
  handler: async (event) => {
    if (event.name === 'READY' || event.name === 'RESUMED') {
      gatewayReady = true;
      stop.abort();
    }
  },
});

try {
  await session.run({ signal: AbortSignal.any([stop.signal, deadline]) });
} finally {
  stop.abort();
}

assert.equal(gatewayReady, true, 'the Gateway did not become ready before the deadline');
assert.equal(session.ready, false, 'the smoke session should be closed after its handshake');
process.stdout.write('Gateway handshake check passed\n');
