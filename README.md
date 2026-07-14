# mollama

[中文文档](README.zh-CN.md)

> **Model freedom starts here.** A lightweight Ollama protocol compatibility proxy that wraps any remote OpenAI-compatible LLM API behind a local Ollama service — so every coding agent that speaks Ollama can use the model you want.

## What is mollama?

mollama is a compatibility proxy that disguises itself as a local Ollama server. It converts remote LLM provider APIs (OpenAI-compatible protocol) into the native Ollama protocol, enabling all coding agents that support Ollama local models to seamlessly access remote large language models.

Originally built to make **GitHub Copilot Chat** in VS Code work with **DeepSeek**, **Kimi**, and other Chinese LLMs through a fake local Ollama service, mollama has grown into a general-purpose **model aggregation gateway**. In reality, most frontends already call models via Ollama's OpenAI-compatible interface rather than the native Ollama API — mollama simply provides a new, cleaner path to **model freedom**.

### Supported Models & Providers

mollama works with **any** provider that exposes an OpenAI-compatible API. Popular models include:

| Category              | Models                                                                                                                                                            |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🇨🇳 Chinese LLMs       | DeepSeek (V3/R1), Kimi (Moonshot), Qwen (通义千问), GLM (智谱), Baichuan (百川), Yi (零一万物), Doubao (豆包/字节), StepFun (阶跃星辰), MiniMax, SenseChat (商汤) |
| 🌍 International LLMs | GPT-4o / GPT-4.1 / o1 / o3, Claude 3.5 / Claude 4 (Sonnet/Opus), Gemini 2.5 Pro/Flash, Llama 4, Mistral Large, Command R+                                         |
| 🔧 Coding Models      | DeepSeek-Coder, CodeGeeX, Qwen-Coder, StarCoder, CodeLlama, Codestral                                                                                             |

> If the provider offers an OpenAI-compatible endpoint, mollama can proxy it.

## Key Features

| Feature                          | Description                                                                                                        |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 🔌 **Full Ollama Protocol**      | `/api/chat`, `/api/generate`, `/api/embed`, `/api/embeddings`, `/api/tags`, `/api/show`, `/api/ps`, `/api/version` |
| 🌐 **Multi-Provider Config**     | Configure multiple providers and models in `models.json`, switch instantly                                         |
| 🔒 **Built-in HTTP/HTTPS Proxy** | Global or per-provider proxy — bypass network restrictions with ease                                               |
| 🎯 **Frontend Prompt Injection** | Auto-match frontend profiles via `user-agent`, inject custom system prompts and tool configs                       |
| 📡 **Remote Deployment Ready**   | Deploy to your own cloud server; frontends talk only to the cloud, bypassing most network restrictions             |
| ⚡ **Streaming First**           | SSE → NDJSON conversion with incremental `tool_calls` buffering                                                    |
| 🧠 **Reasoning Compat**          | Automatic `reasoning_content` ↔ `thinking` format conversion                                                       |
| 🖼️ **Multimodal**                | `images` array → OpenAI `content` parts with base64 data URLs                                                      |
| 📋 **Structured Output**         | `format: "json"` / `format: { schema }` → `response_format` mapping                                                |

## Use Cases

| Scenario                      | Description                                                                        |
| ----------------------------- | ---------------------------------------------------------------------------------- |
| **Copilot + DeepSeek/Kimi**   | Make GitHub Copilot Chat use DeepSeek, Kimi, Qwen, or any Chinese LLM              |
| **Model Aggregation Gateway** | Unified endpoint for multiple providers — one local port, all models               |
| **Network Bypass Proxy**      | Deploy to a cloud server; frontends communicate only with the cloud                |
| **Multi-Frontend Hub**        | Serve GitHub Copilot, OpenCode, Continue, Cline, Aider, and more from one instance |

## Quick Start

```bash
# One-command setup (creates .env, installs deps, builds, validates config)
npm run setup
```

Then point your Ollama-compatible client to `http://localhost:11434` and start chatting.

### VS Code Copilot Chat Integration

mollama is designed to work seamlessly with **GitHub Copilot Chat** in VS Code via the BYOK (Bring Your Own Key) Ollama provider.

**Step-by-step connection:**

1. Open Copilot Chat in VS Code (`Cmd+Shift+I` / `Ctrl+Shift+I`)
2. Click the model selector dropdown at the bottom of the chat panel
3. Choose **"Add Model..."** or **"Manage Models..."**
4. Select **Ollama** as the provider
5. Enter the server URL: `http://localhost:11434`
6. Name it: `Neo-Mollama`
7. Pick a model from the list (e.g. **DeepSeek V4 Pro** or **DeepSeek V4 Flash**)

**How it works under the hood:**

| Step            | Endpoint                    | Purpose                                          |
| --------------- | --------------------------- | ------------------------------------------------ |
| Version check   | `GET /api/version`          | Verifies Ollama ≥ 0.6.4                          |
| Model discovery | `GET /api/tags`             | Lists available models                           |
| Model details   | `POST /api/show`            | Reads context window, tools, vision capabilities |
| Chat inference  | `POST /v1/chat/completions` | OpenAI-compatible streaming chat                 |

> Copilot Chat uses Ollama's native API for model discovery but the **OpenAI-compatible** `/v1/chat/completions` for actual inference. mollama handles both protocols, plus automatic `reasoning_content` → `thinking` field conversion so DeepSeek's reasoning process is visible in Copilot Chat.

For a deep dive, see [docs/copilot-chat-integration.md](docs/copilot-chat-integration.md).

**Manual alternative** (if you prefer step-by-step control):

```bash
cp .env.example .env         # then edit .env and add your API keys
npm install
npm run build
npm run start-server          # starts mollama in background
```

Server lifecycle commands:

```bash
npm run start-server      # start mollama in background
npm run server-status     # check if the server is running
npm run stop-server       # stop the server
```

## Configuration

mollama uses two JSON config files:

| File                 | Purpose                                                           |
| -------------------- | ----------------------------------------------------------------- |
| `config/system.json` | Server settings, Ollama compatibility, frontend profiles, logging |
| `config/models.json` | Global proxy, provider upstreams, model catalog                   |

Environment variables and `.env`

You can provide API keys and proxy settings via environment variables. For convenience the repo includes `.env.example` — copy it to `.env` and fill in your keys (the repo already ignores `.env`).

Examples:

```bash
# create .env from the example and edit the values
cp .env.example .env
open .env   # edit DEEPSEEK_API_KEY, KIMI_API_KEY, MIMO_API_KEY, etc.

# then install, build and start (no extra `export` needed)
npm install
npm run build
npm run start -- --config config/system.json
```

Why this works: `models.json` references secrets using the `env:VAR_NAME` form (for example `env:DEEPSEEK_API_KEY`). The application loads environment variables from `.env` at startup, so you don't need to edit `models.json` to insert keys.

👉 **Full configuration reference**: [docs/configuration-reference.md](docs/configuration-reference.md)

## Documentation

## Troubleshooting

- **Port already in use**: If `mollama` cannot start because port 11434 is in use, find and stop the process:

```bash
# show the process listening on the port
lsof -i :11434 -sTCP:LISTEN -n -P

# kill the process (replace PID with the number shown)
# kill <PID>
```

- **Proxy warning**: You may see `[mollama] Warning: Environment variable HTTPS_PROXY for proxyUrl is not set.` This is informational — set `HTTPS_PROXY` in `.env` if you need to route provider requests through a proxy.

- **Validate config**: Use the built-in config validator to ensure your JSON configs and environment variables resolve correctly:

```bash
npm run build
npm run validate-config -- --config config/system.json
```

- **Logs & stop**: Start the server in a terminal to view logs, and press `Ctrl+C` to stop it. Use `npm run start` (it auto-loads `.env`) as shown above.

| Document                                                               | Description                                         |
| ---------------------------------------------------------------------- | --------------------------------------------------- |
| 📖 [Configuration Reference](docs/configuration-reference.md)          | Complete schema for `system.json` and `models.json` |
| 🔬 [Ollama vs OpenAI API Difference](docs/api-difference.md)           | Full API endpoint coverage and protocol differences |
| 🤖 [GitHub Copilot Chat Integration](docs/copilot-chat-integration.md) | How Copilot Chat discovers and uses Ollama models   |

## Project Structure

```
mollama/
├── config/
│   ├── system.json          # Server, Ollama, logging, frontend profiles
│   └── models.json          # Provider upstreams + model registry
├── src/
│   ├── cli.ts               # CLI entry (start / init / validate)
│   ├── server.ts            # HTTP route orchestration
│   ├── protocol/
│   │   ├── ollama-to-openai.ts    # Request: Ollama → OpenAI
│   │   ├── openai-to-ollama.ts    # Response: OpenAI → Ollama
│   │   └── reasoning-compat.ts    # reasoning_content → thinking
│   └── upstream/
│       ├── client.ts        # Model resolution + upstream dispatch
│       └── transport.ts     # Retry, timeout, proxy, streaming
├── test/
│   └── integration.test.js  # Integration tests
└── docs/
    ├── configuration-reference.md
    ├── api-difference.md
    └── copilot-chat-integration.md
```

## Development

```bash
npm run build          # Compile TypeScript
npm test               # Run integration tests
npm run sync:test-env  # Deploy to test environment
```

## License

MIT

---

🚀 **Model freedom, powered by mollama.** Configure your models, start the server, and enjoy the freedom.
