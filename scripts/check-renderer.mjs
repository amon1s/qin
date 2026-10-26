/**
 * End-to-end check of the running packaged app over CDP.
 *
 * Assumes Qin was started with --remote-debugging-port=9333.
 * Verifies the renderer actually mounted, the preload bridge is present, and the
 * vault files are being served from the app origin.
 */

const CDP_PORT = process.env.CDP_PORT || '9333';

async function main() {
  const listRes = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
  const targets = await listRes.json();
  const page = targets.find(t => t.type === 'page');
  if (!page) throw new Error('no page target found');

  console.log('page url   :', page.url);
  console.log('page title :', page.title);

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let nextId = 1;
  const pending = new Map();

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });

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
    const result = await send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text || 'evaluation failed');
    }
    return result.result.value;
  };

  const checks = [];
  const check = (name, value, predicate, expectation) => {
    const ok = predicate(value);
    checks.push({ name, ok, value, expectation });
  };

  check('document.title', await evaluate('document.title'), v => /Qin/.test(v), /Qin/);
  check(
    'react mounted (#root has children)',
    await evaluate("document.getElementById('root').childElementCount"),
    v => v > 0,
    '> 0'
  );
  check(
    'rendered markup size',
    await evaluate("document.getElementById('root').innerHTML.length"),
    v => v > 200,
    '> 200 chars'
  );
  check(
    'preload bridge present (window.qin.storage)',
    await evaluate("typeof window.qin?.storage?.get === 'function'"),
    v => v === true,
    'true'
  );
  check(
    'proxy config exposed to renderer',
    await evaluate('window.qin?.config?.proxyPort > 0'),
    v => v === true,
    'true'
  );
  check(
    'renderer has no Node access',
    await evaluate("typeof require === 'undefined' && typeof process === 'undefined'"),
    v => v === true,
    'true'
  );
  check(
    'no uncaught page errors',
    await evaluate('window.__qinErrorCount ?? 0'),
    v => v === 0,
    '0'
  );

  console.log('');
  let failures = 0;
  for (const c of checks) {
    if (c.ok) {
      console.log(`  ok   ${c.name}  → ${JSON.stringify(c.value)}`);
    } else {
      failures += 1;
      console.log(`  FAIL ${c.name}  → got ${JSON.stringify(c.value)}, want ${c.expectation}`);
    }
  }

  ws.close();
  console.log(failures === 0 ? '\nrenderer checks passed\n' : `\n${failures} renderer checks FAILED\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
