import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, Plugin } from 'vite';

/**
 * Dev-only mirror of the Electron proxy in main.cjs, so `npm run dev` behaves
 * like the packaged app: same header contract, same streaming, same deadline.
 * The session token is not enforced here (there is no main process to mint
 * one); the packaged build is the one that requires it.
 */
const llmProxyPlugin = (): Plugin => ({
  name: 'qin-dev-proxy',
  configureServer(server) {
    server.middlewares.use('/api/proxy', async (req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader(
        'Access-Control-Allow-Headers',
        'Content-Type, Authorization, x-api-key, anthropic-version, x-target-url, x-qin-token'
      );

      if (req.method === 'OPTIONS') {
        res.statusCode = 200;
        res.end();
        return;
      }

      const fail = (status: number, error: string, details?: string) => {
        res.statusCode = status;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error, ...(details ? { details } : {}) }));
      };

      const targetUrl = req.headers['x-target-url'] as string | undefined;
      if (!targetUrl) {
        fail(400, 'Missing x-target-url header');
        return;
      }

      let parsed: URL;
      try {
        parsed = new URL(targetUrl);
      } catch {
        fail(400, 'Malformed target URL');
        return;
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        fail(400, `Unsupported protocol: ${parsed.protocol}`);
        return;
      }
      if (parsed.hostname === '169.254.169.254' || parsed.hostname.startsWith('169.254.')) {
        fail(400, 'Link-local / cloud metadata addresses are blocked');
        return;
      }

      const buffers: Buffer[] = [];
      for await (const chunk of req) {
        buffers.push(chunk as Buffer);
      }
      const requestBody = buffers.length ? Buffer.concat(buffers).toString() : undefined;

      const forwardHeaders: Record<string, string> = {};
      for (const [name, value] of Object.entries(req.headers)) {
        const key = name.toLowerCase();
        if (['host', 'content-length', 'x-target-url', 'x-qin-token', 'connection'].includes(key)) {
          continue;
        }
        if (value === undefined) continue;
        forwardHeaders[name] = Array.isArray(value) ? value.join(', ') : value;
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 120_000);

      try {
        const response = await fetch(targetUrl, {
          method: req.method,
          headers: forwardHeaders,
          body: requestBody,
          signal: controller.signal,
          redirect: 'follow',
        });

        res.statusCode = response.status;
        response.headers.forEach((value, key) => {
          const lower = key.toLowerCase();
          if (lower === 'content-encoding' || lower === 'content-length' || lower === 'transfer-encoding') {
            return;
          }
          res.setHeader(key, value);
        });

        if (!response.body) {
          res.end();
          return;
        }

        // Stream rather than buffer, so `stream: true` completions work.
        const { Readable } = await import('node:stream');
        Readable.fromWeb(response.body as never).pipe(res);
      } catch (err) {
        const aborted = controller.signal.aborted;
        if (!res.headersSent) {
          fail(aborted ? 504 : 502, aborted ? 'Upstream timed out' : 'Proxy request failed', String((err as Error)?.message ?? err));
        } else {
          res.end();
        }
      } finally {
        clearTimeout(timer);
      }
    });
  },
});

export default defineConfig(() => ({
  // Relative asset paths so Electron can resolve them from the served root.
  base: './',
  plugins: [react(), tailwindcss(), llmProxyPlugin()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: false,
    hmr: process.env.DISABLE_HMR !== 'true',
    watch: process.env.DISABLE_HMR === 'true' ? null : {},
  },
}));
