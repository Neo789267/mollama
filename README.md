# mollama

`mollama` is a compatibility proxy that wraps remote OpenAI-compatible models behind a complete Ollama protocol interface. It enables Ollama-speaking clients (such as GitHub Copilot, Continue, etc.) to transparently use any upstream provider that exposes an OpenAI-compatible API.

## Goals

- Move provider upstream config into `models.json` under `providers.<name>.upstream` and keep `system.json` focused on runtime/frontends.
- Provide complete core Ollama runtime routes: `/api/chat`, `/api/generate`, `/api/embed`, `/api/embeddings`, discovery routes, and compatibility stubs for lifecycle routes.
- Support OpenAI-format pass-through via `/v1/chat/completions` with automatic `reasoning_content → thinking` compatibility for clients like Copilot.
- Preserve TypeScript + Node.js + undici stack, with streaming-first conversions and low overhead.

## Config Model

- `system.json` no longer includes `upstreams`, `defaultProvider`, or `activeFrontend`.
- `models.json` now uses:
	- `defaults`
	- `providers.<providerName>.upstream`
	- `providers.<providerName>.models[]`
- Frontend profile selection is automatic via `user-agent` header substring matching against `userAgentPattern` in each frontend profile. Profiles are matched in config order; the first match wins.

## Project Structure

```
mollama/
├── config/
│   ├── system.json          # Server, Ollama, logging, frontend profiles
│   └── models.json          # Provider upstreams + model registry
├── src/
│   ├── cli.ts               # CLI entry (start / init / validate)
│   ├── server.ts            # HTTP route orchestration
│   ├── types.ts             # Schema types
│   ├── model-registry.ts    # Model name → provider resolution
│   ├── provider-policy.ts   # Payload assembly, thinking/reasoning, max_tokens
│   ├── frontend-policy.ts   # Config-driven prompt/tool shaping
│   ├── config/
│   │   └── load.ts          # Config loading & validation
│   ├── protocol/
│   │   ├── ollama-to-openai.ts    # Request: Ollama → OpenAI
│   │   ├── openai-to-ollama.ts    # Response: OpenAI → Ollama
│   │   └── reasoning-compat.ts    # reasoning_content → thinking compat
│   └── upstream/
│       ├── client.ts        # Model resolution + upstream dispatch
│       └── transport.ts     # Retry, timeout, proxy, streaming
├── test/
│   └── integration.test.js  # Integration tests
├── scripts/
│   └── sync-test-env.cjs    # Deploy to test environment
└── docs/
    └── api-difference.md    # Ollama vs OpenAI API difference reference
```

## Key Features

| Feature | Description |
|---------|-------------|
| **Full Ollama protocol** | `/api/chat`, `/api/generate`, `/api/embed`, `/api/embeddings`, `/api/tags`, `/api/show`, `/api/ps`, `/api/version` |
| **OpenAI pass-through** | `/v1/chat/completions` with frontend profile + provider policy |
| **Reasoning compat** | `reasoning_content → thinking` on both Ollama and OpenAI paths |
| **Streaming** | SSE → NDJSON conversion with tool_calls incremental buffering |
| **Multi-provider** | Multiple upstream providers in `models.json`, each with independent auth |
| **Frontend selection** | `user-agent` substring matching for per-client prompt/tool shaping |
| **Structured output** | `format: "json"` / `format: { schema }` → `response_format` mapping |
| **Multimodal** | `images` array → OpenAI `content` parts with base64 data URLs |

## Quick Start

```bash
cd mollama
npm install
npm run build
npm run start -- --config config/system.json
```

## Development

```bash
npm run build          # Compile TypeScript
npm test               # Run integration tests
npm run sync:test-env  # Deploy to C:\tmp\mollama
```

## Notes

- This version does not modify the original project runtime.
- Config files can be shared with the existing project.
- See [docs/api-difference.md](docs/api-difference.md) for the full Ollama vs OpenAI API difference reference.
