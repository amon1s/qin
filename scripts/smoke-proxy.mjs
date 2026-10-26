/**
 * Smoke test for the local proxy, runnable without a display:
 *
 *   node scripts/smoke-proxy.mjs
 *
 * Starts the real proxy app against the built `dist/`, then asserts the
 * behaviours that matter: token enforcement, SSRF blocking, upstream
 * forwarding, streaming, and the CSP header on the served page.
 */

import { createRequire } from 'node:module';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { createProxyApp, blockedTargetReason } = require(path.join(root, 'proxy.cjs'));

const TOKEN = 'smoke-test-token';

/** A tiny upstream that echoes and can stream, standing in for a provider. */
function startUpstream() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');

    if (url.pathname === '/v1/models') {
      const authorized = req.headers.authorization === 'Bearer sk-good';
      res.writeHead(authorized ? 200 : 401, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify(
          authorized
            ? { data: [{ id: 'test-model', context_length: 8192 }] }
            : { error: 'bad key' }
        )
      );
      return;
    }

    if (url.pathname === '/v1/chat/completions') {
      let body = '';
      req.on('data', chunk => (body += chunk));
      req.on('end', () => {
        const parsed = JSON.parse(body || '{}');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            choices: [{ message: { content: `echo:${parsed.model}` } }],
            usage: { prompt_tokens: 3, completion_tokens: 4 },
          })
        );
      });
      return;
    }

    if (url.pathname === '/stream') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write('data: first\n\n');
      setTimeout(() => {
        res.write('data: second\n\n');
        res.end();
      }, 60);
      return;
    }

    if (url.pathname === '/slow') {
      // Never responds: exercises the proxy deadline.
      return;
    }

    res.writeHead(404);
    res.end('not found');
  });

  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function listen(app) {
  return new Promise(resolve => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function call(base, { method = 'GET', target, token = TOKEN, body, headers = {} }) {
  const requestHeaders = { ...headers };
  if (target) requestHeaders['x-target-url'] = target;
  if (token) requestHeaders['x-qin-token'] = token;
  if (body) requestHeaders['content-type'] = 'application/json';

  const response = await fetch(`${base}/api/proxy`, {
    method,
    headers: requestHeaders,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  return { status: response.status, text, headers: response.headers };
}

const results = [];
function check(name, fn) {
  results.push({ name, fn });
}

async function main() {
  const upstream = await startUpstream();
  const upstreamBase = `http://127.0.0.1:${upstream.address().port}`;

  const app = createProxyApp({
    proxyToken: TOKEN,
    distDir: path.join(root, 'dist'),
    version: '1.1.0-smoke',
    timeoutMs: 1500,
  });
  const server = await listen(app);
  const base = `http://127.0.0.1:${server.address().port}`;

  let failures = 0;
  let total = 0;

  const run = async (name, fn) => {
    total += 1;
    try {
      await fn();
      console.log(`  ok   ${name}`);
    } catch (err) {
      failures += 1;
      console.error(`  FAIL ${name}`);
      console.error(`       ${err.message}`);
    }
  };

  console.log('\nproxy smoke test\n');

  await run('health endpoint reports version', async () => {
    const res = await fetch(`${base}/api/health`);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.version, '1.1.0-smoke');
  });

  await run('rejects a request with no session token', async () => {
    const res = await call(base, { target: `${upstreamBase}/v1/models`, token: null });
    assert.equal(res.status, 401);
  });

  await run('rejects a request with a wrong session token', async () => {
    const res = await call(base, { target: `${upstreamBase}/v1/models`, token: 'nope' });
    assert.equal(res.status, 401);
  });

  await run('rejects cloud metadata targets even with a valid token', async () => {
    const res = await call(base, { target: 'http://169.254.169.254/latest/meta-data/' });
    assert.equal(res.status, 400);
    assert.match(res.text, /metadata/i);
  });

  await run('rejects non-http protocols', async () => {
    assert.match(String(blockedTargetReason('file:///etc/passwd')), /protocol/i);
  });

  await run('requires x-target-url', async () => {
    const res = await call(base, {});
    assert.equal(res.status, 400);
  });

  await run('forwards a GET and returns the upstream body', async () => {
    const res = await call(base, {
      target: `${upstreamBase}/v1/models`,
      headers: { authorization: 'Bearer sk-good' },
    });
    assert.equal(res.status, 200);
    assert.match(res.text, /test-model/);
  });

  await run('passes upstream auth failures through as-is', async () => {
    const res = await call(base, {
      target: `${upstreamBase}/v1/models`,
      headers: { authorization: 'Bearer sk-bad' },
    });
    assert.equal(res.status, 401);
  });

  await run('forwards a POST body and returns usage', async () => {
    const res = await call(base, {
      method: 'POST',
      target: `${upstreamBase}/v1/chat/completions`,
      headers: { authorization: 'Bearer sk-good' },
      body: { model: 'test-model', messages: [{ role: 'user', content: 'hi' }] },
    });
    assert.equal(res.status, 200);
    const parsed = JSON.parse(res.text);
    assert.equal(parsed.choices[0].message.content, 'echo:test-model');
    assert.equal(parsed.usage.prompt_tokens, 3);
  });

  await run('streams the upstream body instead of buffering it', async () => {
    const response = await fetch(`${base}/api/proxy`, {
      headers: { 'x-target-url': `${upstreamBase}/stream`, 'x-qin-token': TOKEN },
    });
    assert.equal(response.status, 200);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const first = await reader.read();
    // The first chunk must arrive before the upstream has finished.
    assert.match(decoder.decode(first.value), /first/);

    let rest = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      rest += decoder.decode(value);
    }
    assert.match(rest, /second/);
  });

  await run('times out a hanging upstream with 504', async () => {
    const res = await call(base, { target: `${upstreamBase}/slow` });
    assert.equal(res.status, 504);
    assert.match(res.text, /timed out/i);
  });

  await run('serves the built index.html with a CSP header', async () => {
    const res = await fetch(base);
    assert.equal(res.status, 200);
    const csp = res.headers.get('content-security-policy');
    assert.ok(csp, 'missing Content-Security-Policy');
    assert.match(csp, /script-src 'self'/);
    assert.match(csp, /frame-ancestors 'none'/);
    const html = await res.text();
    assert.match(html, /<div id="root">/);
  });

  await run('does not advertise the express fingerprint', async () => {
    const res = await fetch(base);
    assert.equal(res.headers.get('x-powered-by'), null);
  });

  server.close();
  upstream.close();

  console.log(
    failures === 0
      ? `\nall ${total} proxy checks passed\n`
      : `\n${failures} of ${total} proxy checks FAILED\n`
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
