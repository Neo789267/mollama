# mollama

[中文文档](README.zh-CN.md)

> **Model freedom starts here.** A lightweight Ollama protocol compatibility proxy that wraps any remote OpenAI-compatible LLM API behind a local Ollama service — so every coding agent that speaks Ollama can use the model you want.

## What is mollama?

mollama is a compatibility proxy that disguises itself as a local Ollama server. It converts remote LLM provider APIs (OpenAI-compatible protocol) into the native Ollama protocol, enabling all coding agents that support Ollama local models to seamlessly access remote large language models.

Originally built to make **GitHub Copilot Chat** in VS Code work with **DeepSeek**, **Kimi**, and other Chinese LLMs through a fake local Ollama service, mollama has grown into a general-purpose **model aggregation gateway**. In reality, most frontends already call models via Ollama's OpenAI-compatible interface rather than the native Ollama API — mollama simply provides a new, cleaner path to **model freedom**.

### Supported Models & Providers

mollama works with **any** provider that exposes an OpenAI-compatible API. Popular models include:

| Category | Models |
|----------|--------|
| 🇨🇳 Chinese LLMs | DeepSeek (V3/R1), Kimi (Moonshot), Qwen (通义千问), GLM (智谱), Baichuan (百川), Yi (零一万物), Doubao (豆包/字节), StepFun (阶跃星辰), MiniMax, SenseChat (商汤) |
| 🌍 International LLMs | GPT-4o / GPT-4.1 / o1 / o3, Claude 3.5 / Claude 4 (Sonnet/Opus), Gemini 2.5 Pro/Flash, Llama 4, Mistral Large, Command R+ |
| 🔧 Coding Models | DeepSeek-Coder, CodeGeeX, Qwen-Coder, StarCoder, CodeLlama, Codestral |

> If the provider offers an OpenAI-compatible endpoint, mollama can proxy it.

## Key Features

| Feature | Description |
|---------|-------------|
| 🔌 **Full Ollama Protocol** | `/api/chat`, `/api/generate`, `/api/embed`, `/api/embeddings`, `/api/tags`, `/api/show`, `/api/ps`, `/api/version` |
| 🌐 **Multi-Provider Config** | Configure multiple providers and models in `models.json`, switch instantly |
| 🔒 **Built-in HTTP/HTTPS Proxy** | Global or per-provider proxy — bypass network restrictions with ease |
| 🎯 **Frontend Prompt Injection** | Auto-match frontend profiles via `user-agent`, inject custom system prompts and tool configs |
| 📡 **Remote Deployment Ready** | Deploy to your own cloud server; frontends talk only to the cloud, bypassing most network restrictions |
| ⚡ **Streaming First** | SSE → NDJSON conversion with incremental `tool_calls` buffering |
| 🧠 **Reasoning Compat** | Automatic `reasoning_content` ↔ `thinking` format conversion |
| 🖼️ **Multimodal** | `images` array → OpenAI `content` parts with base64 data URLs |
| 📋 **Structured Output** | `format: "json"` / `format: { schema }` → `response_format` mapping |

## Use Cases

| Scenario | Description |
|----------|-------------|
| **Copilot + DeepSeek/Kimi** | Make GitHub Copilot Chat use DeepSeek, Kimi, Qwen, or any Chinese LLM |
| **Model Aggregation Gateway** | Unified endpoint for multiple providers — one local port, all models |
| **Network Bypass Proxy** | Deploy to a cloud server; frontends communicate only with the cloud |
| **Multi-Frontend Hub** | Serve GitHub Copilot, OpenCode, Continue, Cline, Aider, and more from one instance |

## Quick Start

```bash
# Install & build
npm install
npm run build

# Start with default config
npm run start -- --config config/system.json
```

Then point your Ollama-compatible client to `http://localhost:11434` and start chatting.

## Configuration

mollama uses two JSON config files:

| File | Purpose |
|------|---------|
| `config/system.json` | Server settings, Ollama compatibility, frontend profiles, logging |
| `config/models.json` | Global proxy, provider upstreams, model catalog |

👉 **Full configuration reference**: [docs/configuration-reference.md](docs/configuration-reference.md)

## Documentation

| Document | Description |
|----------|-------------|
| 📖 [Configuration Reference](docs/configuration-reference.md) | Complete schema for `system.json` and `models.json` |
| 🔬 [Ollama vs OpenAI API Difference](docs/api-difference.md) | Full API endpoint coverage and protocol differences |
| 🤖 [GitHub Copilot Chat Integration](docs/copilot-chat-integration.md) | How Copilot Chat discovers and uses Ollama models |

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
