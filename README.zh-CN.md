# mollama

[English](README.md)

> **模型自由，从这里开始。** 一个轻量级 Ollama 协议兼容代理，将任意远程 OpenAI 兼容大模型 API 包装为本地 Ollama 服务——让所有支持 Ollama 的编程助手无缝接入你想要的模型。

## 什么是 mollama？

mollama 是一个兼容代理，伪装为本地 Ollama 服务器。它将远程大模型提供商的 API（OpenAI 兼容协议）转换为原生 Ollama 协议，使所有支持 Ollama 本地模型的编程助手（Coding Agent）都能无缝访问远程大语言模型。

项目最初是为了让 VS Code 中的 **GitHub Copilot Chat** 通过伪装的本地 Ollama 服务间接支持 **DeepSeek**、**Kimi** 等国产大模型而开发。如今 mollama 已发展为通用的**模型聚合网关**。实际上，大部分前端通过 Ollama 的 OpenAI 兼容接口调用模型，并未使用原生 Ollama 接口——mollama 只是为模型自由提供了一种更简洁的新方式。

### 支持的模型与提供商

mollama 适用于**所有**提供 OpenAI 兼容接口的提供商。热门模型包括：

| 分类          | 模型                                                                                                                                                                       |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🇨🇳 国产大模型 | DeepSeek（V3/R1）、Kimi（月之暗面）、Qwen（通义千问）、GLM（智谱）、Baichuan（百川）、Yi（零一万物）、Doubao（豆包/字节）、StepFun（阶跃星辰）、MiniMax、SenseChat（商汤） |
| 🌍 国际大模型 | GPT-4o / GPT-4.1 / o1 / o3、Claude 3.5 / Claude 4（Sonnet/Opus）、Gemini 2.5 Pro/Flash、Llama 4、Mistral Large、Command R+                                                 |
| 🔧 代码模型   | DeepSeek-Coder、CodeGeeX、Qwen-Coder、StarCoder、CodeLlama、Codestral                                                                                                      |

> 只要提供商提供 OpenAI 兼容端点，mollama 就能代理它。

## 核心特性

| 特性                        | 说明                                                                                                               |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 🔌 **完整 Ollama 协议**     | `/api/chat`、`/api/generate`、`/api/embed`、`/api/embeddings`、`/api/tags`、`/api/show`、`/api/ps`、`/api/version` |
| 🌐 **多模型配置**           | 在 `models.json` 中配置多个提供商和模型，一键切换                                                                  |
| 🔒 **内置 HTTP/HTTPS 代理** | 全局或按提供商独立代理配置，轻松绕过网络限制                                                                       |
| 🎯 **前端提示词注入**       | 通过 `user-agent` 自动匹配前端 Profile，注入个性化系统提示词和工具配置                                             |
| 📡 **支持远程部署**         | 可部署至自有云端服务器，前端仅与云端通信，有效规避大部分网络监管                                                   |
| ⚡ **流式传输优先**         | SSE 到 NDJSON 的高效转换，支持增量 `tool_calls` 缓冲                                                               |
| 🧠 **推理兼容**             | 自动处理 `reasoning_content` 与 `thinking` 格式转换                                                                |
| 🖼️ **多模态支持**           | `images` 数组 → OpenAI `content` parts，支持 base64 data URLs                                                      |
| 📋 **结构化输出**           | `format: "json"` / `format: { schema }` → `response_format` 映射                                                   |

## 适用场景

| 场景                        | 说明                                                               |
| --------------------------- | ------------------------------------------------------------------ |
| **Copilot + DeepSeek/Kimi** | 让 GitHub Copilot Chat 使用 DeepSeek、Kimi、通义千问等国产模型     |
| **模型聚合网关**            | 统一管理多个提供商，一个本地端口访问所有模型                       |
| **网络绕路代理**            | 部署到云端服务器，前端仅与云端通信，摆脱网络限制                   |
| **多前端统一接入**          | 为 GitHub Copilot、OpenCode、Continue、Cline、Aider 等提供统一服务 |

## 快速开始

```bash
# 一键安装（创建 .env、安装依赖、构建、校验配置）
npm run setup
```

然后将你的 Ollama 兼容客户端指向 `http://localhost:11434`，即可开始使用。

### VS Code Copilot Chat 集成

mollama 专为 **VS Code GitHub Copilot Chat** 的 BYOK（Bring Your Own Key）Ollama 提供商设计，实现无缝集成。

**连接步骤：**

1. 打开 VS Code 中的 Copilot Chat（`Cmd+Shift+I` / `Ctrl+Shift+I`）
2. 点击聊天面板底部的模型选择器下拉菜单
3. 选择 **"Add Model..."** 或 **"Manage Models..."**
4. 选择 **Ollama** 作为提供商
5. 输入服务器地址：`http://localhost:11434`
6. 命名为：`Neo-Mollama`
7. 从列表中选择模型（如 **DeepSeek V4 Pro** 或 **DeepSeek V4 Flash**）

**底层工作原理：**

| 步骤     | 端点                        | 用途                             |
| -------- | --------------------------- | -------------------------------- |
| 版本检查 | `GET /api/version`          | 验证 Ollama 版本 ≥ 0.6.4         |
| 模型发现 | `GET /api/tags`             | 列出可用模型                     |
| 模型详情 | `POST /api/show`            | 读取上下文窗口、工具、视觉等能力 |
| 聊天推理 | `POST /v1/chat/completions` | OpenAI 兼容的流式聊天            |

> Copilot Chat 使用 Ollama 原生 API 进行模型发现，但使用 **OpenAI 兼容接口** `/v1/chat/completions` 进行实际推理。mollama 同时处理两种协议，并自动进行 `reasoning_content` → `thinking` 字段转换，让 DeepSeek 的推理过程能在 Copilot Chat 中可见。

深入了解请参阅 [docs/copilot-chat-integration.md](docs/copilot-chat-integration.md)。

**手动安装**（如果你想逐步控制）：

```bash
cp .env.example .env          # 编辑 .env 并填入你的 API 密钥
npm install
npm run build
npm run start-server          # 在后台启动 mollama
```

服务器生命周期命令：

```bash
npm run start-server      # 启动 mollama（后台运行）
npm run server-status     # 检查服务器状态
npm run stop-server       # 停止 mollama
```

## 配置说明

mollama 使用两个 JSON 配置文件：

| 文件                 | 用途                                          |
| -------------------- | --------------------------------------------- |
| `config/system.json` | 服务器设置、Ollama 兼容性、前端 Profile、日志 |
| `config/models.json` | 全局代理、提供商上游配置、模型目录            |

环境变量与 `.env`

你可以通过环境变量提供 API 密钥和代理设置。仓库内包含了 `.env.example`，复制为 `.env` 并填写你的密钥（仓库已将 `.env` 加入 `.gitignore`，不会被提交）。

示例：

```bash
# 从示例创建 .env 并编辑
cp .env.example .env
open .env   # 编辑 DEEPSEEK_API_KEY、KIMI_API_KEY、MIMO_API_KEY 等

# 然后安装、构建并启动（无需额外的 export）
npm install
npm run build
npm run start -- --config config/system.json
```

这样可行的原因：`models.json` 使用 `env:VAR_NAME` 的方式引用密钥（例如 `env:DEEPSEEK_API_KEY`）。应用在启动时会自动从 `.env` 加载环境变量，因此无需在 `models.json` 中直接写入明文密钥。

👉 **完整配置参考**：[docs/configuration-reference.md](docs/configuration-reference.md)

## 文档

## 故障排查

- **端口被占用**：如果 `mollama` 无法启动且提示端口 11434 被占用，可定位并停止占用进程：

```bash
# 查看监听该端口的进程
lsof -i :11434 -sTCP:LISTEN -n -P

# 结束进程（将 <PID> 替换为上一步输出的进程号）
# kill <PID>
```

- **代理警告**：你可能会看到 `[mollama] Warning: Environment variable HTTPS_PROXY for proxyUrl is not set.` 这是提示信息；如果需要通过代理访问提供商，请在 `.env` 中设置 `HTTPS_PROXY`。

- **配置校验**：使用内置的配置校验器检查 JSON 配置和环境变量是否正确解析：

```bash
npm run build
npm run validate-config -- --config config/system.json
```

- **日志与停止**：在终端运行服务以便查看日志，使用 `Ctrl+C` 停止。使用 `npm run start`（该命令已配置为自动加载 `.env`）。

| 文档                                                            | 说明                                         |
| --------------------------------------------------------------- | -------------------------------------------- |
| 📖 [配置参考](docs/configuration-reference.md)                  | `system.json` 和 `models.json` 的完整 Schema |
| 🔬 [Ollama vs OpenAI API 差异](docs/api-difference.md)          | 完整的 API 端点覆盖与协议差异                |
| 🤖 [GitHub Copilot Chat 集成](docs/copilot-chat-integration.md) | Copilot Chat 如何发现和使用 Ollama 模型      |

## 项目结构

```
mollama/
├── config/
│   ├── system.json          # 服务器、Ollama、日志、前端 Profile
│   └── models.json          # 提供商上游 + 模型注册表
├── src/
│   ├── cli.ts               # CLI 入口（start / init / validate）
│   ├── server.ts            # HTTP 路由编排
│   ├── protocol/
│   │   ├── ollama-to-openai.ts    # 请求：Ollama → OpenAI
│   │   ├── openai-to-ollama.ts    # 响应：OpenAI → Ollama
│   │   └── reasoning-compat.ts    # reasoning_content → thinking
│   └── upstream/
│       ├── client.ts        # 模型解析 + 上游分发
│       └── transport.ts     # 重试、超时、代理、流式传输
├── test/
│   └── integration.test.js  # 集成测试
└── docs/
    ├── configuration-reference.md
    ├── api-difference.md
    └── copilot-chat-integration.md
```

## 开发

```bash
npm run build          # 编译 TypeScript
npm test               # 运行集成测试
npm run sync:test-env  # 部署到测试环境
```

## 许可证

MIT

---

🚀 **模型自由，由 mollama 驱动。** 配置你的模型，启动服务，享受无限可能。
