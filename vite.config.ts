import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, Plugin } from 'vite';

const llmProxyPlugin = (): Plugin => ({
  name: 'llm-proxy-middleware',
  configureServer(server) {
    server.middlewares.use('/api/proxy', async (req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key, anthropic-version, x-target-url');

      if (req.method === 'OPTIONS') {
        res.statusCode = 200;
        res.end();
        return;
      }

      try {
        const targetUrl = req.headers['x-target-url'] as string;
        if (!targetUrl) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'Missing x-target-url header' }));
          return;
        }

        const buffers: Buffer[] = [];
        for await (const chunk of req) {
          buffers.push(chunk as Buffer);
        }
        const requestBody = buffers.length ? Buffer.concat(buffers).toString() : undefined;

        const forwardHeaders: Record<string, string> = {
          'Content-Type': (req.headers['content-type'] as string) || 'application/json',
        };

        if (req.headers['authorization']) {
          forwardHeaders['Authorization'] = req.headers['authorization'] as string;
        }
        if (req.headers['x-api-key']) {
          forwardHeaders['x-api-key'] = req.headers['x-api-key'] as string;
        }
        if (req.headers['anthropic-version']) {
          forwardHeaders['anthropic-version'] = req.headers['anthropic-version'] as string;
        }

        const response = await fetch(targetUrl, {
          method: req.method,
          headers: forwardHeaders,
          body: requestBody,
        });

        res.statusCode = response.status;
        response.headers.forEach((val, key) => {
          if (key.toLowerCase() !== 'content-encoding' && key.toLowerCase() !== 'content-length') {
            res.setHeader(key, val);
          }
        });

        const responseData = await response.text();
        res.end(responseData);
      } catch (err: any) {
        res.statusCode = 502;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'Proxy request failed', details: err?.message || String(err) }));
      }
    });
  },
});

export default defineConfig(() => {
  return {
    base: './', // Crucial for Electron to resolve static assets in production builds
    plugins: [react(), tailwindcss(), llmProxyPlugin()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
