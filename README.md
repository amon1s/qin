# Qin

A local desktop app for managing LLM API endpoints: store keys in an encrypted
vault, discover the models each endpoint offers, send test completions through a
loopback proxy, and see what each request cost.

Built with React, Vite and Electron. Linux-first, packaged as a single AppImage.

---

## What it does

- **Encrypted key vault** — AES-GCM 256 with PBKDF2-SHA256 at 600,000 iterations.
  A random data key encrypts the vault and is wrapped twice: once with your
  master password, once with a recovery key. Either one unlocks it.
- **Multi-instance endpoints** — the same company can hold several accounts or
  regions, each with its own key, base URL and auth style.
- **OpenAI-compatible and custom endpoints** — preset providers (OpenAI,
  Anthropic, Groq, DeepSeek, Mistral, OpenRouter, Ollama) or any base URL with a
  custom auth header.
- **Model discovery** — reads `/v1/models`, Ollama's `/api/tags`, or any path you
  specify. Context windows and prices are shown only when the provider actually
  publishes them.
- **Test dispatcher** — send a real completion, inspect tokens, latency and the
  raw JSON. Requests can be cancelled, and every call has a deadline.
- **Token ledger** — records tokens, latency and cost per request, and marks each
  cost as *published* by the provider, an *estimate*, or *local* (free).
- **Local proxy** — the renderer never calls a provider directly. One proxy, one
  timeout policy, one place that holds the session token.

---

## Security model

Worth knowing exactly what is and is not protected.

| Concern | Behaviour |
| --- | --- |
| Where keys live | `~/.config/qin/vault.json`, encrypted, written `0600`. |
| Master password | Never stored and never hashed. It is proven by decrypting the vault. |
| Recovery key | Unwraps the same data key, so resetting the password keeps your keys. |
| Renderer sandbox | `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. |
| Proxy binding | `127.0.0.1` only, on an OS-assigned port. |
| Proxy auth | Requires a per-launch 32-byte token, handed over via the preload bridge. |
| SSRF guard | Cloud metadata (`169.254.0.0/16`), `.internal` hosts and non-HTTP schemes rejected. |
| CSP | `default-src 'self'`, `script-src 'self'`, `frame-ancestors 'none'`. |

What it does **not** protect against: a compromised local account, malware with
access to your user session, or a provider that logs your prompts. The vault
protects keys at rest — not a machine that is already compromised.

---

## Install (AppImage)

1. Download `Qin-<version>.AppImage` from [Releases](../../releases).
2. `chmod +x Qin-*.AppImage`
3. `./Qin-*.AppImage`

If your distro does not run AppImages out of the box, install FUSE:

```bash
# Ubuntu / Debian
sudo apt install libfuse2
# Fedora
sudo dnf install fuse-libs
```

---

## Build from source

Requires **Node.js 20+** and npm.

```bash
git clone https://github.com/amon1s/qin.git
cd qin
npm install

npm run dev      # Vite dev server on 127.0.0.1:5173 (browser mode, localStorage)
npm run app      # Electron against the built dist/
npm run verify   # typecheck + unit tests + build + proxy smoke test
npm run dist     # verify, then produce release/Qin-<version>.AppImage
```

`npm run dist` will not package unless `typecheck`, the unit tests, the build and
the proxy smoke test all pass.

### Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Vite dev server with a dev copy of the proxy |
| `npm run build` | Production renderer build into `dist/` |
| `npm run app` | Launch Electron against `dist/` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run test` | Vitest unit tests (services layer) |
| `npm run smoke` | Boots the real proxy; asserts token, SSRF, streaming, timeout, CSP |
| `npm run check:renderer` | Against a running app with `--remote-debugging-port`: renderer mounts, bridge present, no Node access |
| `npm run check:storage` | Against a running app: writes land on disk `0600`, key allowlist enforced |
| `npm run verify` | All of the above |
| `npm run dist` | `verify` + electron-builder AppImage |

---

## Where your data lives

Everything is under the Electron userData directory:

```
~/.config/qin/
├── vault.json        # encrypted payload (wrapped data key + encrypted body)
├── vault_meta.json   # KDF version, timestamps, recovery state
├── ledger.json       # request history (prompt snippets included)
└── settings.json     # appearance and behaviour
```

`vault.json` is ciphertext — copying it without the password or recovery key gets
you nothing. `ledger.json` is plaintext and contains prompt snippets; clear it
from the app if that matters to you.

Upgrading from a pre-1.1 build migrates the old `localStorage` vault into
`vault.json` on first launch and re-encrypts it at the current KDF strength.

---

## Project structure

```
qin/
├── main.cjs           # Electron main: storage IPC, window, boot
├── proxy.cjs          # Local proxy + static host (testable without Electron)
├── preload.cjs        # contextBridge surface exposed as window.qin
├── scripts/
│   └── smoke-proxy.mjs
├── src/
│   ├── App.tsx        # app shell, vault lifecycle, provider state
│   ├── components/    # vault, discovery, ledger, dispatcher, settings
│   ├── services/
│   │   ├── crypto.ts    # vault format, KDF, recovery wrapping
│   │   ├── proxy.ts     # renderer-side proxy client (timeouts, error mapping)
│   │   ├── providers.ts # presets, URL building, discovery, dispatch
│   │   ├── ledger.ts    # pricing resolution and ledger accounting
│   │   └── storage.ts   # file-backed store (localStorage in browser dev)
│   └── types/
├── assets/            # app icon
└── public/fonts/      # Megrim + Smooch Sans
```

---

## Notes and limitations

- **GSAP Club plugins.** The splash intro uses GSAP's `SplitText`. If it is not
  licensed for your use, the component falls back to plain text and logs a
  warning — nothing else breaks.
- **Streaming.** The proxy streams responses, so `stream: true` works through it,
  but the dispatcher UI currently renders only the completed response.
- **Costs are only as good as the provider's data.** OpenRouter publishes per-model
  pricing, so its costs are exact. Where a provider publishes none, the row is
  labelled `estimate` rather than presented as measured.
- **Single window.** A second launch focuses the existing window instead of
  starting a competing server.

---

## License

MIT © [Amon (amon1s)](https://github.com/amon1s)
