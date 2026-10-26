/**
 * Qin local proxy + static host.
 *
 * Kept separate from main.cjs so it can be exercised without an Electron window
 * (see scripts/smoke-proxy.mjs). The main process supplies the per-launch
 * token, the dist directory, and the app version.
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const { Readable } = require('stream');

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

// Headers the renderer uses to talk to us, not to the upstream.
const INTERNAL_HEADERS = new Set(['host', 'content-length', 'x-target-url', 'x-qin-token']);

const UPSTREAM_TIMEOUT_MS = 120_000;

/**
 * Reject targets that are never a legitimate LLM endpoint. Without this the
 * proxy is a server-side request forgery primitive: anything that can reach the
 * port could read cloud instance metadata.
 */
function blockedTargetReason(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return 'Malformed target URL';
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return `Unsupported protocol: ${url.protocol}`;
  }
  const host = url.hostname.toLowerCase();
  if (host === '169.254.169.254' || host.startsWith('169.254.')) {
    return 'Link-local / cloud metadata addresses are blocked';
  }
  if (host === '0.0.0.0' || host === '::' || host === '[::]') {
    return 'Unspecified addresses are blocked';
  }
  if (host === 'metadata.google.internal' || host.endsWith('.internal')) {
    return 'Internal metadata hostnames are blocked';
  }
  return null;
}

function buildForwardHeaders(headers) {
  const forwarded = {};
  for (const [name, value] of Object.entries(headers)) {
    const key = name.toLowerCase();
    if (HOP_BY_HOP.has(key) || INTERNAL_HEADERS.has(key)) continue;
    if (value === undefined) continue;
    forwarded[name] = Array.isArray(value) ? value.join(', ') : value;
  }
  return forwarded;
}

function tokenMatches(presented, expected) {
  if (typeof presented !== 'string' || presented.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(presented), Buffer.from(expected));
}

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

/**
 * @param {object} options
 * @param {string} options.proxyToken  per-launch session token
 * @param {string} options.distDir     directory holding the built renderer
 * @param {string} options.version     app version, reported by /api/health
 * @param {number} [options.timeoutMs] upstream deadline
 */
function createProxyApp({ proxyToken, distDir, version, timeoutMs = UPSTREAM_TIMEOUT_MS }) {
  if (!proxyToken) throw new Error('createProxyApp requires a proxyToken');

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '25mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, version });
  });

  app.all('/api/proxy', async (req, res) => {
    if (!tokenMatches(req.get('x-qin-token') || '', proxyToken)) {
      res.status(401).json({ error: 'Unauthorized: missing or invalid proxy token' });
      return;
    }

    const targetUrl = req.get('x-target-url');
    if (!targetUrl) {
      res.status(400).json({ error: 'Missing x-target-url header' });
      return;
    }

    const blocked = blockedTargetReason(targetUrl);
    if (blocked) {
      res.status(400).json({ error: blocked });
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    // If the client goes away mid-flight, stop paying for the upstream call.
    res.on('close', () => controller.abort());

    try {
      const hasBody = !['GET', 'HEAD'].includes(req.method);
      const upstream = await fetch(targetUrl, {
        method: req.method,
        headers: buildForwardHeaders(req.headers),
        body: hasBody ? JSON.stringify(req.body) : undefined,
        signal: controller.signal,
        redirect: 'follow',
      });

      res.status(upstream.status);
      upstream.headers.forEach((value, name) => {
        const key = name.toLowerCase();
        if (HOP_BY_HOP.has(key) || key === 'content-encoding' || key === 'content-length') return;
        res.setHeader(name, value);
      });

      if (!upstream.body) {
        res.end();
        return;
      }

      // Stream through so SSE / `stream: true` completions work. Buffering with
      // `await response.text()` silently broke token streaming.
      const body = Readable.fromWeb(upstream.body);
      body.on('error', () => {
        if (!res.headersSent) res.status(502);
        res.end();
      });
      body.pipe(res);
    } catch (err) {
      const aborted = err && (err.name === 'AbortError' || err.code === 'ABORT_ERR');
      if (!res.headersSent) {
        res.status(aborted ? 504 : 502).json({
          error: aborted ? 'Upstream timed out' : 'Proxy request failed',
          details: err?.message || String(err),
        });
      } else {
        res.end();
      }
    } finally {
      clearTimeout(timer);
    }
  });

  app.use((_req, res, next) => {
    // Everything is same-origin through this server, so the policy can be
    // strict. `unsafe-inline` for styles is required by React/GSAP inline style
    // writes; scripts stay locked to the bundle.
    res.setHeader('Content-Security-Policy', CSP);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });

  app.use(express.static(distDir));

  app.get('*', (_req, res) => {
    const indexFile = path.join(distDir, 'index.html');
    if (!fs.existsSync(indexFile)) {
      res
        .status(503)
        .type('text/plain')
        .send('Qin build missing. Run `npm run build` (or `npm run dist`) first.');
      return;
    }
    res.sendFile(indexFile);
  });

  return app;
}

module.exports = { createProxyApp, blockedTargetReason, buildForwardHeaders };
