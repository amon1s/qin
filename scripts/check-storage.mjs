/**
 * Verifies the storage bridge against a running packaged app.
 *
 * Assumes Qin was started with --remote-debugging-port=9333 and a throwaway
 * --user-data-dir, e.g.:
 *
 *   ./release/linux-unpacked/qin --no-sandbox \
 *     --remote-debugging-port=9333 --user-data-dir=/tmp/qin-smoke
 *   node scripts/check-storage.mjs /tmp/qin-smoke
 */

import fs from 'node:fs/promises';
import path from 'node:path';

const CDP_PORT = process.env.CDP_PORT || '9333';
const dataDir = process.argv[2] || '/tmp/qin-smoke';

async function connect() {
  const targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
  const page = targets.find(t => t.type === 'page');
  if (!page) throw new Error('no page target');

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let nextId = 1;
  const pending = new Map();

  ws.addEventListener('message', event => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    }
  });

  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', () => reject(new Error('cdp websocket failed')), { once: true });
  });

  const evaluate = async expression => {
    const id = nextId++;
    const result = await new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      ws.send(
        JSON.stringify({
          id,
          method: 'Runtime.evaluate',
          params: { expression, returnByValue: true, awaitPromise: true },
        })
      );
    });
    if (result.exceptionDetails) {
      return { error: result.exceptionDetails.text || 'threw' };
    }
    return { value: result.result.value };
  };

  return { evaluate, close: () => ws.close() };
}

const checks = [];
function record(name, ok, detail) {
  checks.push({ name, ok, detail });
}

async function main() {
  const { evaluate, close } = await connect();

  // 1. Write through the bridge.
  const written = await evaluate(
    `window.qin.storage.set('settings', { theme: 'dark', smoke: true })`
  );
  record('bridge accepted a whitelisted key', written.value === true, JSON.stringify(written));

  // 2. It must actually land on disk, not just in memory.
  const settingsFile = path.join(dataDir, 'settings.json');
  let onDisk = null;
  try {
    onDisk = JSON.parse(await fs.readFile(settingsFile, 'utf8'));
  } catch (err) {
    record('settings.json written to disk', false, err.message);
  }
  if (onDisk) {
    record('settings.json written to disk', true, settingsFile);
    record('content round-trips', onDisk.smoke === true, JSON.stringify(onDisk));
  }

  // 3. File permissions must not expose the vault to other users.
  if (onDisk) {
    const stat = await fs.stat(settingsFile);
    const mode = (stat.mode & 0o777).toString(8);
    record('file mode is 0600', mode === '600', `0${mode}`);
  }

  // 4. Read back through the bridge.
  const readBack = await evaluate(`window.qin.storage.get('settings')`);
  record('bridge reads the value back', readBack.value?.smoke === true, JSON.stringify(readBack.value));

  // 5. The key allowlist must reject traversal and unknown names.
  const traversal = await evaluate(
    `window.qin.storage.set('../../etc/passwd', { pwned: true }).then(() => 'ALLOWED').catch(e => 'REJECTED: ' + e.message)`
  );
  record(
    'rejects path traversal in the key',
    typeof traversal.value === 'string' && traversal.value.startsWith('REJECTED'),
    String(traversal.value)
  );

  const unknown = await evaluate(
    `window.qin.storage.set('not_a_real_key', { x: 1 }).then(() => 'ALLOWED').catch(e => 'REJECTED: ' + e.message)`
  );
  record(
    'rejects keys outside the allowlist',
    typeof unknown.value === 'string' && unknown.value.startsWith('REJECTED'),
    String(unknown.value)
  );

  // 6. openExternal must refuse non-http schemes.
  const badScheme = await evaluate(`window.qin.openExternal('file:///etc/passwd')`);
  record('openExternal refuses file://', badScheme.value === false, JSON.stringify(badScheme.value));

  close();

  let failures = 0;
  console.log('');
  for (const c of checks) {
    if (c.ok) {
      console.log(`  ok   ${c.name}  → ${c.detail}`);
    } else {
      failures += 1;
      console.log(`  FAIL ${c.name}  → ${c.detail}`);
    }
  }
  console.log(failures === 0 ? '\nstorage bridge checks passed\n' : `\n${failures} checks FAILED\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
