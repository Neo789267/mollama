# Ollama API vs OpenAI API 差异全景

本文档记录 Ollama API 与 OpenAI API 之间的全部差异，以及 mollama 的实现状态。

---

## 一、端点覆盖

| 端点 | 方法 | 状态 | 说明 |
|------|------|------|------|
| `/api/version` | GET | ✅ 已实现 | 本地合成，返回 `system.json` 中的 `ollama.version` |
| `/api/tags` | GET | ✅ 已实现 | 本地合成，从模型注册表生成 |
| `/api/show` | POST | ✅ 已实现 | 本地合成，返回模型元数据与 capabilities |
| `/api/ps` | GET | ✅ 已实现 | 本地合成，返回空列表（代理无模型加载概念） |
| `/api/chat` | POST | ✅ 已实现 | 完整双向协议转换 |
| `/api/generate` | POST | ✅ 已实现 | 转换为 chat/completions 调用 |
| `/api/embed` | POST | ✅ 已实现 | 转换为 OpenAI embeddings 调用 |
| `/api/embeddings` | POST | ✅ 已实现 | 旧版嵌入端点，转换为 OpenAI embeddings 调用 |
| `/v1/chat/completions` | POST | ✅ 已实现 | OpenAI 格式直通，含 frontend profile 支持 + `reasoning_content → thinking` 兼容 |
| `/api/create` | POST | ⏭️ 501 | 代理模式无意义，返回 not_implemented |
| `/api/copy` | POST | ⏭️ 501 | 同上 |
| `/api/pull` | POST | ⏭️ 501 | 同上 |
| `/api/push` | POST | ⏭️ 501 | 同上 |
| `/api/delete` | DELETE | ⏭️ 501 | 同上 |
| `/healthz` | GET | ✅ 已实现 | 健康检查（非 Ollama 标准，运维用） |

---

## 二、请求参数差异（Ollama → OpenAI）

### 2.1 `options` 参数展平

Ollama 将模型参数放在嵌套的 `options` 对象中，OpenAI 使用顶层字段。

| Ollama `options.*` | OpenAI 顶层 | 状态 | 说明 |
|---------------------|------------|------|------|
| `options.temperature` | `temperature` | ✅ 已实现 | 直接展平 |
| `options.top_p` | `top_p` | ✅ 已实现 | 直接展平 |
| `options.num_predict` | `max_tokens` | ✅ 已实现 | 重命名映射 |
| `options.seed` | `seed` | ✅ 已实现 | 直接展平 |
| `options.stop` | `stop` | ✅ 已实现 | 直接展平 |
| `options.repeat_penalty` | `frequency_penalty` | ✅ 已实现 | 近似映射：`repeat_penalty - 1`，钳制到 [-2, 2] |
| `options.top_k` | — | ⏭️ 忽略 | OpenAI 不支持，静默丢弃 |
| `options.mirostat` / `mirostat_tau` / `mirostat_eta` | — | ⏭️ 忽略 | OpenAI 不支持 |
| `options.num_ctx` | — | ⏭️ 忽略 | OpenAI 用模型固定 context window |
| `options.num_gpu` / `num_thread` | — | ⏭️ 忽略 | 部署层面参数，代理无意义 |
| `options.repeat_last_n` | — | ⏭️ 忽略 | OpenAI 不支持 |
| `options.tfs_z` | — | ⏭️ 忽略 | OpenAI 不支持 |
| `options.typical_p` | — | ⏭️ 忽略 | OpenAI 不支持 |

**实现位置**：`src/protocol/ollama-to-openai.ts` → `mapOptionsToOpenAI()`

### 2.2 `format` → `response_format`（结构化输出）

| Ollama | OpenAI | 状态 |
|--------|--------|------|
| `"format": "json"` | `{ "response_format": { "type": "json_object" } }` | ✅ 已实现 |
| `"format": { "type": "object", ... }` | `{ "response_format": { "type": "json_schema", "json_schema": { "name": "structured_output", "schema": ... } } }` | ✅ 已实现 |

**实现位置**：`src/protocol/ollama-to-openai.ts` → `mapOllamaFormatToResponseFormat()`

### 2.3 `images` → 多模态 content 数组

```
Ollama:  { "role": "user", "content": "描述这张图", "images": ["base64data"] }
OpenAI:  { "role": "user", "content": [
            { "type": "text", "text": "描述这张图" },
            { "type": "image_url", "image_url": { "url": "data:image/png;base64,base64data" } }
          ] }
```

| 功能 | 状态 | 说明 |
|------|------|------|
| `images` 数组 → `content` parts | ✅ 已实现 | 自动检测 `images` 字段并转换 |
| 纯 base64 → `data:image/png;base64,...` 前缀 | ✅ 已实现 | `toImageUrl()` 自动补前缀 |
| 已有 `data:` 前缀的 URL | ✅ 已实现 | 直接透传 |

**实现位置**：`src/protocol/ollama-to-openai.ts` → `mapMessage()`

### 2.4 `system` 顶层参数 → messages 注入

```
Ollama:  { "model": "...", "system": "You are helpful", "messages": [...] }
OpenAI:  { "model": "...", "messages": [{ "role": "system", "content": "You are helpful" }, ...] }
```

| 功能 | 状态 | 说明 |
|------|------|------|
| 顶层 `system` → 插入 messages 头部 | ✅ 已实现 | `unshift` 到 messages 数组首位 |

**实现位置**：`src/protocol/ollama-to-openai.ts` → `normalizeOllamaChatToOpenAI()`

### 2.5 `thinking` / `think` 参数

| Ollama | OpenAI | 状态 | 说明 |
|--------|--------|------|------|
| `"think": true/false` | `"thinking": { "type": "enabled"/"disabled" }` | ✅ 已实现 | 透传给 provider-policy 处理 |
| `"thinking": { "type": "enabled" }` | 同结构 | ✅ 已实现 | 直接透传 |

**实现位置**：`src/protocol/ollama-to-openai.ts` → `normalizeOllamaChatToOpenAI()` + `src/provider-policy.ts`

### 2.6 `tool` role 消息（工具调用结果）

```
Ollama:  { "role": "tool", "content": "结果", "tool_name": "get_weather" }
OpenAI:  { "role": "tool", "content": "结果", "tool_call_id": "call_xxx" }
```

| 功能 | 状态 | 说明 |
|------|------|------|
| `tool_name` → 合成 `tool_call_id` | ✅ 已实现 | 格式：`call_{toolName}_{messageIndex}` |
| 已有 `tool_call_id` | ✅ 已实现 | 直接透传 |

**实现位置**：`src/protocol/ollama-to-openai.ts` → `mapMessage()`

### 2.7 assistant 消息中的 `tool_calls`

```
Ollama:  "tool_calls": [{ "function": { "name": "...", "arguments": { "key": "val" } } }]
OpenAI:  "tool_calls": [{ "id": "call_xxx", "type": "function", "function": { "name": "...", "arguments": "{\"key\":\"val\"}" } }]
```

| 差异 | 状态 | 说明 |
|------|------|------|
| `arguments` 对象 → JSON 字符串 | ✅ 已实现 | `JSON.stringify()` 转换 |
| 补充 `id` 和 `type` 字段 | ✅ 已实现 | 合成 `call_{index}_{name}` |

**实现位置**：`src/protocol/ollama-to-openai.ts` → `mapToolCallForOpenAI()`

### 2.8 其他请求参数

| 参数 | 状态 | 说明 |
|------|------|------|
| `model` | ✅ 已实现 | 通过 model registry 映射到 `targetModel` |
| `messages` | ✅ 已实现 | 格式基本兼容，含上述转换 |
| `stream` | ✅ 已实现 | 直接透传 |
| `tools` | ✅ 已实现 | 直接透传（格式兼容） |
| `tool_choice` | ✅ 已实现 | 直接透传 |
| `keep_alive` | ⏭️ 忽略 | 代理无模型加载概念 |
| `template` | ⏭️ 忽略 | OpenAI 无此概念 |
| `raw` | ⏭️ 忽略 | OpenAI 无此概念 |
| `context` (KV cache tokens) | ⏭️ 忽略 | OpenAI 无此概念 |

---

## 三、响应格式差异（OpenAI → Ollama）

### 3.1 非流式响应结构

```
OpenAI:
{
  "id": "chatcmpl-xxx",
  "object": "chat.completion",
  "created": 1234567890,
  "model": "deepseek-v4-pro",
  "choices": [{
    "index": 0,
    "message": { "role": "assistant", "content": "你好！" },
    "finish_reason": "stop"
  }],
  "usage": { "prompt_tokens": 10, "completion_tokens": 20, "total_tokens": 30 }
}

Ollama:
{
  "model": "DeepSeek V4 Pro",
  "created_at": "2026-05-03T12:00:00.000Z",
  "message": { "role": "assistant", "content": "你好！" },
  "done": true,
  "done_reason": "stop",
  "total_duration": 0,
  "load_duration": 0,
  "prompt_eval_count": 10,
  "prompt_eval_duration": 0,
  "eval_count": 20,
  "eval_duration": 0
}
```

| 字段映射 | 状态 | 说明 |
|----------|------|------|
| `model` ← 请求中的 `displayName` | ✅ 已实现 | 使用可见模型名而非上游 targetModel |
| `created_at` ← 当前时间 ISO 8601 | ✅ 已实现 | `new Date().toISOString()` |
| `message` ← `choices[0].message` | ✅ 已实现 | 提取 role + content |
| `done` ← `true` | ✅ 已实现 | 非流式固定为 true |
| `done_reason` ← `finish_reason` | ✅ 已实现 | 直接映射 |
| `prompt_eval_count` ← `usage.prompt_tokens` | ✅ 已实现 | |
| `eval_count` ← `usage.completion_tokens` | ✅ 已实现 | |
| `total_duration` / `load_duration` / `prompt_eval_duration` / `eval_duration` | ⏭️ 填 0 | 上游不返回时间统计，填零 |

**实现位置**：`src/protocol/openai-to-ollama.ts` → `mapOpenAITextToOllamaChat()`

### 3.2 流式响应格式

```
OpenAI SSE:
data: {"choices":[{"delta":{"role":"assistant"},"index":0}]}
data: {"choices":[{"delta":{"content":"你"},"index":0}]}
data: {"choices":[{"delta":{"content":"好"},"index":0}]}
data: {"choices":[{"delta":{},"finish_reason":"stop","index":0}]}
data: [DONE]

Ollama NDJSON:
{"model":"...","created_at":"...","message":{"role":"assistant","content":"你"},"done":false}
{"model":"...","created_at":"...","message":{"role":"assistant","content":"好"},"done":false}
{"model":"...","created_at":"...","message":{"role":"assistant","content":""},"done":true,"done_reason":"stop",...}
```

| 差异 | 状态 | 说明 |
|------|------|------|
| SSE `data:` 格式 → NDJSON 每行一个 JSON | ✅ 已实现 | `OpenAIStreamToOllamaNdjson` Transform 流 |
| `choices[0].delta.content` → 顶层 `message.content` | ✅ 已实现 | |
| `choices[0].delta.reasoning_content` → `message.thinking` | ✅ 已实现 | |
| `choices[0].delta.thinking` → `message.thinking` | ✅ 已实现 | 兼容两种上游字段名 |
| `[DONE]` 事件 → 最终 `done: true` chunk | ✅ 已实现 | |
| `finish_reason` → `done_reason` | ✅ 已实现 | |
| `usage` → `prompt_eval_count` / `eval_count` | ✅ 已实现 | 从最终 chunk 提取 |
| 流式 tool_calls 增量拼接 | ✅ 已实现 | 缓冲 `arguments` 增量文本，最终输出完整对象 |

**实现位置**：`src/protocol/openai-to-ollama.ts` → `OpenAIStreamToOllamaNdjson` 类

### 3.3 Tool Calls 响应格式

```
OpenAI:
"tool_calls": [{
  "id": "call_abc123",
  "type": "function",
  "function": { "name": "get_weather", "arguments": "{\"location\":\"北京\"}" }
}]

Ollama:
"tool_calls": [{
  "function": { "name": "get_weather", "arguments": { "location": "北京" } }
}]
```

| 差异 | 状态 | 说明 |
|------|------|------|
| 移除 `id` 和 `type` 字段 | ✅ 已实现 | |
| `arguments` JSON 字符串 → 对象 | ✅ 已实现 | `parseArguments()` 解析 |
| 流式增量 tool_calls 缓冲 | ✅ 已实现 | 按 `index` 累积，最终输出完整对象 |

**实现位置**：`src/protocol/openai-to-ollama.ts` → `mapToolCallsToOllama()` + `OpenAIStreamToOllamaNdjson`

### 3.4 Thinking/Reasoning 响应

> **注意**：`reasoning_content → thinking` 转换在两条路径上均有实现：
> - **Ollama 协议路径**（`/api/chat` 等）：由 `openai-to-ollama.ts` 中的 `mapThinking()` 和 `OpenAIStreamToOllamaNdjson` 在出站转换时处理。
> - **OpenAI 直通路径**（`/v1/chat/completions`）：由 `reasoning-compat.ts` 中的 `createReasoningContentToThinkingStream()`（流式）和 `mapReasoningContentToThinkingTextBody()`（非流式）在响应管道中处理。该层直接操作 SSE 事件流或 JSON body，将 `reasoning_content` 字段镜像为 `thinking`，确保 Copilot 等客户端能正确识别推理内容。

```
OpenAI (DeepSeek 等):
"message": { "content": "回答", "reasoning_content": "思考过程..." }

Ollama:
"message": { "content": "回答", "thinking": "思考过程..." }
```

| 差异 | 状态 | 说明 |
|------|------|------|
| `reasoning_content` → `thinking` | ✅ 已实现 | 非流式和流式均已处理 |
| `thinking` 字段直接透传 | ✅ 已实现 | 兼容已有 thinking 字段的上游 |

**实现位置**：`src/protocol/openai-to-ollama.ts` → `mapThinking()` + `OpenAIStreamToOllamaNdjson`

### 3.5 Generate 端点响应差异

```
Ollama /api/chat:    { "message": { "role": "assistant", "content": "..." }, ... }
Ollama /api/generate: { "response": "...", "context": [], ... }
```

| 差异 | 状态 | 说明 |
|------|------|------|
| `response` 字段替代 `message.content` | ✅ 已实现 | `mapOpenAITextToOllamaGenerate()` |
| `context` 字段（空数组） | ✅ 已实现 | 代理无 KV cache，返回空数组 |
| 流式使用 `response` 而非 `message` | ✅ 已实现 | `mode: 'generate'` 分支 |

**实现位置**：`src/protocol/openai-to-ollama.ts` → `mapOpenAITextToOllamaGenerate()` + `OpenAIStreamToOllamaNdjson`

### 3.6 Embed 端点响应差异

```
OpenAI embeddings:
{ "data": [{ "embedding": [0.1, 0.2] }, { "embedding": [0.3, 0.4] }], "usage": { "prompt_tokens": 2 } }

Ollama /api/embed:
{ "model": "...", "embeddings": [[0.1, 0.2], [0.3, 0.4]], "prompt_eval_count": 2 }

Ollama /api/embeddings (旧版):
{ "embedding": [0.1, 0.2] }
```

| 差异 | 状态 | 说明 |
|------|------|------|
| `data[].embedding` → `embeddings[]`（复数） | ✅ 已实现 | `/api/embed` |
| `data[0].embedding` → `embedding`（单数） | ✅ 已实现 | `/api/embeddings` 旧版 |
| `usage.prompt_tokens` → `prompt_eval_count` | ✅ 已实现 | |

**实现位置**：`src/protocol/openai-to-ollama.ts` → `mapOpenAITextToOllamaEmbed()` + `mapOpenAITextToOllamaEmbeddings()`

---

## 四、Ollama 不支持但 OpenAI 支持的参数

以下参数 Ollama 客户端不会发送，但如果通过 `/v1/chat/completions` 直通，会被原样转发：

| 参数 | 处理方式 |
|------|---------|
| `n` (多选) | 透传 |
| `logprobs` / `top_logprobs` | 透传 |
| `presence_penalty` | 透传 |
| `frequency_penalty` | 透传 |
| `user` | 透传 |
| `function_call` / `functions` (旧版) | 透传 |

---

## 五、Ollama 特有但代理忽略的参数

| 参数 | 说明 | 处理 |
|------|------|------|
| `keep_alive` | 控制模型在内存中的驻留时间 | ⏭️ 忽略，代理无模型加载 |
| `template` | 自定义 prompt 模板 | ⏭️ 忽略 |
| `raw` | 跳过模板格式化 | ⏭️ 忽略 |
| `context` (请求中) | KV cache token 数组 | ⏭️ 忽略 |
| `options.top_k` | 采样参数 | ⏭️ 忽略，OpenAI 不支持 |
| `options.mirostat*` | 自适应采样 | ⏭️ 忽略 |
| `options.num_ctx` | 上下文窗口大小 | ⏭️ 忽略 |
| `options.num_gpu` / `num_thread` | 部署参数 | ⏭️ 忽略 |

---

## 六、实现架构

```
Ollama 客户端
    ↓ POST /api/chat (Ollama 格式)
[ollama-to-openai.ts]  ← 入站转换：options 展平、images、system、format、tool_calls
    ↓ POST /v1/chat/completions (OpenAI 格式)
[provider-policy.ts]   ← 策略层：thinking/reasoning、frontend profile、max_tokens 钳制
    ↓
[transport.ts]         ← 传输层：重试、超时、代理、流式转发
    ↓ OpenAI 格式响应
[openai-to-ollama.ts]  ← 出站转换：响应结构、tool_calls、thinking、SSE→NDJSON
    ↓ Ollama 格式响应
Ollama 客户端
```

```
OpenAI 客户端 (Copilot 等)
    ↓ POST /v1/chat/completions (OpenAI 格式)
[provider-policy.ts]   ← 策略层：frontend profile、max_tokens 钳制
    ↓
[transport.ts]         ← 传输层：重试、超时、代理、流式转发
    ↓ OpenAI 格式响应
[reasoning-compat.ts]  ← 兼容层：reasoning_content → thinking（流式 SSE + 非流式 JSON）
    ↓ OpenAI 格式响应（thinking 字段已注入）
OpenAI 客户端
```

两条并行路径：
- `/api/chat`、`/api/generate`、`/api/embed`、`/api/embeddings` → 完整双向转换（Ollama ↔ OpenAI）
- `/v1/chat/completions` → OpenAI 格式直通（应用 frontend profile + provider policy + reasoning 兼容）
