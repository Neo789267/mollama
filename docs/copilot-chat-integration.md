# GitHub Copilot Chat 与 mollama 集成研究报告

本文档记录 GitHub Copilot Chat 与 Ollama 的集成机制，以及 mollama 对该集成的兼容性分析。

> **研究日期**: 2026-05-04
> **VS Code 版本**: 最新稳定版
> **Ollama 最新版本**: v0.23.0
> **mollama 模拟版本**: 0.6.4

---

## 一、Copilot Chat 的 Ollama 集成架构

GitHub Copilot Chat 通过 VS Code 内置的 BYOK（Bring Your Own Key）机制连接 Ollama 本地服务。其集成采用**混合协议模式**：

| 阶段 | 端点 | 协议 | 用途 |
|------|------|------|------|
| 版本检查 | `GET /api/version` | Ollama 原生 | 验证版本 ≥ 0.6.4 |
| 模型列表 | `GET /api/tags` | Ollama 原生 | 获取可用模型列表 |
| 模型详情 | `POST /api/show` | Ollama 原生 | 获取 capabilities、context_length 等 |
| **推理请求** | `POST /v1/chat/completions` | **OpenAI 兼容** | 实际的聊天补全 |

> **关键发现**: Copilot Chat 的模型发现使用 Ollama 原生 API，但推理请求使用 OpenAI 兼容 API（`/v1/chat/completions`），而非 Ollama 原生的 `/api/chat`。

---

## 二、最低版本要求

VS Code Copilot 扩展源码中硬编码了最低版本要求：

```typescript
// extensions/copilot/src/extension/byok/vscode-node/ollamaProvider.ts
const MINIMUM_OLLAMA_VERSION = '0.6.4';
```

连接流程：
1. 调用 `GET /api/version` 获取版本号
2. 与 `0.6.4` 进行逐段数值比较
3. 低于此版本则拒绝连接并提示升级

**mollama 配置**: `system.json` → `ollama.version: "0.6.4"`，恰好满足最低要求。

---

## 三、各接口详细分析

### 3.1 `GET /api/version`

**Copilot 用途**: 版本兼容性检查

**Copilot 读取的字段**:
```typescript
const versionInfo = await response.json() as OllamaVersionResponse;
// versionInfo.version → 与 MINIMUM_OLLAMA_VERSION 比较
```

**mollama 返回**:
```json
{
  "version": "0.6.4"
}
```

| 字段 | 类型 | 状态 | 说明 |
|------|------|:----:|------|
| `version` | `string` | ✅ | 格式正确，值 ≥ 0.6.4 |

---

### 3.2 `GET /api/tags`

**Copilot 用途**: 获取模型列表，然后逐个调用 `/api/show` 获取详情

**Copilot 读取的字段**:
```typescript
const models = (await response.json()).models;
for (const model of models) {
    // model.model → 传给 /api/show 的 model 参数
}
```

**mollama 返回**:
```json
{
  "models": [
    {
      "name": "DeepSeek V4 Flash",
      "model": "DeepSeek V4 Flash",
      "modified_at": "1970-01-01T00:00:00.000Z",
      "size": 0,
      "digest": "sha256:42e0625fad86595de00896e457b00a368950ad586c3477aae9c9fd806ed5ace5",
      "details": {
        "parent_model": "",
        "format": "proxy",
        "family": "proxy",
        "families": ["proxy"],
        "parameter_size": "unknown",
        "quantization_level": "unknown"
      }
    }
  ]
}
```

| 字段 | Copilot 是否使用 | 状态 | 说明 |
|------|:---:|:----:|------|
| `models[].model` | ✅ 必需 | ✅ | 传给 `/api/show` |
| `models[].name` | ❌ 不读 | — | 展示用 |
| `models[].modified_at` | ❌ 不读 | — | 展示用 |
| `models[].size` | ❌ 不读 | — | 展示用 |
| `models[].digest` | ❌ 不读 | — | 展示用 |
| `models[].details` | ❌ 不读 | — | 展示用，Copilot 不关心 |

**结论**: Copilot 只使用 `model.model` 字段，其余字段均为展示用途。

---

### 3.3 `POST /api/show`（核心接口）

**Copilot 用途**: 获取模型的能力信息、上下文窗口大小、架构类型

**Copilot 解析逻辑**（源码还原）:
```typescript
const modelInfo = await response.json();

// 1. 动态构建 context_length 的 key
const arch = modelInfo.model_info['general.architecture'];  // → "proxy"
const contextWindow = modelInfo.model_info[`${arch}.context_length`]; // → model_info['proxy.context_length']

// 2. 读取显示名
const name = modelInfo.model_info['general.basename'];

// 3. 读取能力标志
const vision = modelInfo.capabilities.includes('vision');
const toolCalling = modelInfo.capabilities.includes('tools');

// 4. 计算 token 限制
const outputTokens = contextWindow < 4096 ? Math.floor(contextWindow / 2) : 4096;
const inputTokens = contextWindow - outputTokens;
```

**mollama 返回（DeepSeek V4 Flash）**:
```json
{
  "license": "",
  "modelfile": "FROM deepseek-v4-flash",
  "parameters": "",
  "template": "",
  "details": {
    "parent_model": "",
    "format": "proxy",
    "family": "proxy",
    "families": ["proxy"],
    "parameter_size": "unknown",
    "quantization_level": "unknown"
  },
  "model_info": {
    "general.basename": "DeepSeek V4 Flash",
    "general.architecture": "proxy",
    "proxy.context_length": 1000000
  },
  "capabilities": ["completion", "tools"],
  "remote_model": "deepseek-v4-flash"
}
```

**Copilot 读取字段 vs mollama 返回值**:

| Copilot 读取路径 | mollama 返回值 | 状态 |
|---|---|:---:|
| `model_info['general.architecture']` | `"proxy"` | ✅ |
| `model_info['proxy.context_length']` | `1000000` | ✅ |
| `model_info['general.basename']` | `"DeepSeek V4 Flash"` | ✅ |
| `capabilities` 包含 `"completion"` | ✅ 始终包含 | ✅ |
| `capabilities` 包含 `"tools"` | ✅ 按配置 | ✅ |
| `capabilities` 包含 `"vision"` | 按配置 | ✅ |
| `remote_model` | `"deepseek-v4-flash"` | ✅ |

**Copilot 最终解析结果**:

| 模型 | maxInputTokens | maxOutputTokens | toolCalling | vision |
|------|---------------|-----------------|:-----------:|:------:|
| DeepSeek V4 Flash | 995,904 | 4,096 | ✅ | ❌ |
| DeepSeek V4 Pro | 995,904 | 4,096 | ✅ | ❌ |
| Kimi K2.6 | 258,048 | 4,096 | ✅ | ✅ |
| Kimi K2.5 | 258,048 | 4,096 | ✅ | ✅ |
| MiMo V2.5 Pro | 1,044,480 | 4,096 | ✅ | ✅ |
| MiMo V2.5 | 1,044,480 | 4,096 | ✅ | ✅ |
| MiMo V2 Flash | 258,048 | 4,096 | ✅ | ✅ |

---

### 3.4 `POST /v1/chat/completions`

**Copilot 用途**: 实际的聊天推理请求

**请求格式**: 标准 OpenAI Chat Completions 格式
```json
{
  "model": "DeepSeek V4 Flash",
  "messages": [
    { "role": "user", "content": "Hello" }
  ],
  "stream": true
}
```

**响应格式**: 标准 OpenAI SSE 流式格式

| 功能 | 状态 | 说明 |
|------|:----:|------|
| 流式响应 | ✅ | SSE → NDJSON 转换 |
| tool_calls | ✅ | 增量拼接 |
| reasoning_content → thinking | ✅ | Copilot 能识别 |
| frontend profile 自动匹配 | ✅ | User-Agent: `GitHubCopilotChat` |

### 3.5 Thinking/Reasoning 字段映射研究

#### 问题背景

mollama 在 `/v1/chat/completions` 路径上对上游返回的 `reasoning_content` 字段做了 `→ thinking` 的转换。既然 Copilot 调用的是 OpenAI 兼容接口，为什么需要这个转换？

#### Copilot 的 thinking 字段体系

Copilot 支持**多种** thinking 格式，按优先级排列：

| 优先级 | 字段名 | 来源 | 说明 |
|:---:|---|---|---|
| 1 | `cot_summary` / `cot_id` | Azure OpenAI / Copilot 内部 API | 主要格式 |
| 2 | `reasoning_text` / `reasoning_opaque` | Copilot 内部 API | 备选格式 |
| 3 | `thinking` / `signature` | Anthropic Claude | 最后兜底 |

源码证据（`extensions/copilot/src/platform/thinking/common/thinkingUtils.ts`）：

```typescript
function getThinkingDeltaText(thinking: RawThinkingDelta): string | undefined {
    if (thinking.cot_summary) return thinking.cot_summary;      // 优先级 1
    if (thinking.reasoning_text) return thinking.reasoning_text; // 优先级 2
    if (thinking.thinking) return thinking.thinking;             // 优先级 3（兜底）
    return undefined;
}
```

完整的 `RawThinkingDelta` 接口定义：

```typescript
export interface RawThinkingDelta {
    // Azure Open AI fields
    cot_id?: string;
    cot_summary?: string;

    // Copilot API fields
    reasoning_opaque?: string;
    reasoning_text?: string;

    // Anthropic fields
    thinking?: string;
    signature?: string;
}
```

> **注意**: `reasoning_content`（DeepSeek 等使用的字段名）**不在** Copilot 的识别列表中。

#### 转换的必要性

**不是版本问题，而是字段映射问题。** 完整链路：

```
DeepSeek 上游 API
  ↓ SSE delta: { "reasoning_content": "让我想想..." }

mollama reasoning-compat.ts
  ↓ 转换: { "reasoning_content": "..." } → { "thinking": "..." }

Copilot Chat 客户端
  ↓ getThinkingDeltaText() 检查:
    cot_summary?     → 没有
    reasoning_text?  → 没有
    thinking?        → ✅ 有！显示给用户
```

**如果不做转换**：

| 步骤 | 结果 |
|------|------|
| DeepSeek 返回 `reasoning_content` | Copilot 不认识 |
| Copilot 检查 `cot_summary` | ❌ 没有 |
| Copilot 检查 `reasoning_text` | ❌ 没有 |
| Copilot 检查 `thinking` | ❌ 没有 |
| **最终结果** | 用户**看不到**推理过程 |

**做了转换后**：

| 步骤 | 结果 |
|------|------|
| DeepSeek 返回 `reasoning_content` | mollama 转为 `thinking` |
| Copilot 检查 `cot_summary` | ❌ 没有 |
| Copilot 检查 `reasoning_text` | ❌ 没有 |
| Copilot 检查 `thinking` | ✅ 有！ |
| **最终结果** | 用户**能看到**推理过程 |

#### 各字段来源总结

| 字段 | API 标准 | 来源 | 说明 |
|------|:---:|---|---|
| `cot_summary` / `cot_id` | ❌ 非标准 | Azure OpenAI / Copilot 内部 | Copilot 后端自己的格式 |
| `reasoning_text` / `reasoning_opaque` | ❌ 非标准 | Copilot 内部 API | Copilot 的另一种内部格式 |
| `thinking` / `signature` | ❌ 非标准 | Anthropic Claude | Anthropic 的格式 |
| `reasoning_content` | ❌ 非标准 | DeepSeek 等 | DeepSeek 自定义扩展 |

> **OpenAI 公开的 Chat Completions API 本身没有标准的 thinking 字段。** 以上所有字段均为各厂商的非标准扩展。

#### 结论

| 问题 | 答案 |
|------|------|
| 是版本问题吗？ | ❌ 不是。与 Ollama 版本无关 |
| Copilot 需要 `thinking` 吗？ | ✅ 是。`thinking` 是 Copilot 的兜底识别字段 |
| 转换的作用？ | 让 Copilot 能**显示** DeepSeek 的推理过程 |
| 不转换会怎样？ | 功能正常，但用户**看不到** thinking 内容 |
| 转换是否必要？ | 对于**用户体验**是必要的，对于**基本功能**不是 |

**本质**：这是一个**用户体验优化**。Copilot 有自己的 thinking 格式（`cot_summary`），但也兼容 Anthropic 的 `thinking` 格式作为兜底。mollama 的转换确保了 DeepSeek 的推理内容能通过这个兜底路径被 Copilot 识别和展示。

---

## 四、`details` 字段分析

### 4.1 `/api/tags` 中的 `details`

| 字段 | 真实 Ollama | mollama | Copilot 是否使用 |
|------|------------|---------|:---:|
| `parent_model` | `""` | `""` | ❌ |
| `format` | `"gguf"` | `"proxy"` | ❌ |
| `family` | `"llama"`, `"qwen2"` 等 | `"proxy"` | ❌ |
| `families` | `["llama"]` | `["proxy"]` | ❌ |
| `parameter_size` | `"8.0B"`, `"7.6B"` | `"unknown"` | ❌ |
| `quantization_level` | `"Q4_K_M"` | `"unknown"` | ❌ |

### 4.2 `/api/show` 中的 `details`

| 字段 | 真实 Ollama | mollama | Copilot 是否使用 |
|------|------------|---------|:---:|
| `parent_model` | `""` | `""` | ❌ |
| `format` | `"gguf"` | `"proxy"` | ❌ |
| `family` | `"llama"` | `"proxy"` | ❌ |
| `families` | `["llama"]` | `["proxy"]` | ❌ |
| `parameter_size` | `"8.0B"` | `"unknown"` | ❌ |
| `quantization_level` | `"Q4_K_M"` | `"unknown"` | ❌ |

**结论**: `details` 字段是 Ollama 客户端（`ollama list`、`ollama show`）的展示信息，Copilot Chat **完全不读取** `details` 中的任何字段。Copilot 全部从 `model_info` 和 `capabilities` 获取所需信息。

---

## 五、mollama 的 `model_info` 设计

mollama 采用了一个巧妙的设计来适配 Copilot 的动态 key 构建逻辑：

```typescript
// mollama model-registry.ts
model_info: {
  'general.basename': model.displayName,     // Copilot 读取显示名
  'general.architecture': 'proxy',           // Copilot 用此构建动态 key
  'proxy.context_length': model.contextWindow, // Copilot 读取上下文窗口
}
```

Copilot 的解析逻辑：
```typescript
const arch = modelInfo.model_info['general.architecture']; // → "proxy"
const key = `${arch}.context_length`;                       // → "proxy.context_length"
const contextWindow = modelInfo.model_info[key];            // → 1000000
```

这种 `${architecture}.context_length` 的动态 key 模式是 Ollama 的标准约定，mollama 通过将 `architecture` 设为 `"proxy"` 并使用 `proxy.context_length` 作为 key，完美适配了这一机制。

---

## 六、测试验证结果

### 6.1 接口测试

| 接口 | 状态 | 说明 |
|------|:----:|------|
| `GET /api/version` | ✅ | 返回 `{"version":"0.6.4"}`，通过版本检查 |
| `GET /api/tags` | ✅ | 返回 7 个模型，格式正确 |
| `POST /api/show` | ✅ | 所有 Copilot 需要的字段齐全 |
| `POST /v1/chat/completions` | ✅ | 集成测试通过 |

### 6.2 完整流程验证

```
1. GET /api/version → {"version":"0.6.4"} → ≥ 0.6.4 ✅
2. GET /api/tags → 7 个模型 → 提取 model.model ✅
3. POST /api/show → model_info + capabilities → 解析 context_length、tools、vision ✅
4. POST /v1/chat/completions → OpenAI SSE 流式响应 ✅
```

---

## 七、Copilot 各 Provider 能力对比

Copilot Chat 支持多种 BYOK Provider，各 Provider 的能力差异显著：

| 能力 | Ollama | OpenAI (BYOK) | Anthropic | Custom OAI | OpenRouter |
|------|:---:|:---:|:---:|:---:|:---:|
| `/v1/chat/completions` | ✅ | ✅ | ❌ | ✅ | ✅ |
| `/v1/responses` (Responses API) | ❌ | ✅ | ❌ | ✅ (可选) | ❌ |
| `/v1/messages` (Anthropic API) | ❌ | ❌ | ✅ | ❌ | ✅ (Anthropic 模型) |
| `thinking` 支持 | ❌ | ✅ | ✅ | ✅ (可选) | ✅ (Anthropic 模型) |
| `reasoning_effort` | ❌ | ❌ | ✅ | ❌ | ❌ |
| `prediction` (推测) | ❌ | ✅ | ❌ | ✅ (可选) | ❌ |
| `supported_endpoints` 配置 | 未设置 | `[ChatCompletions, Responses]` | `[Messages]` | 可配置 | 按模型类型 |
| `logprobs` | ❌ | ✅ | ❌ | ✅ (可选) | ❌ |

**关键发现**：Copilot 的 Ollama provider 是**最简化的实现**，只使用 `/v1/chat/completions`，不支持 thinking、Responses API 等新特性。这是因为 Ollama 本身作为本地推理引擎，其 OpenAI 兼容层的功能相对有限。

源码证据（`ollamaProvider.ts`）：

```typescript
// 硬编码只用 Chat Completions，不支持 Responses API
protected override async createOpenAIEndPoint(model) {
    const url = `${model.url}/v1/chat/completions`;
    return this._instantiationService.createInstance(OpenAIEndpoint, modelInfo, apiKey, url);
}

// 模型能力只提取 tools 和 vision，不提取 thinking
const modelCapabilities = {
    toolCalling: modelInfo.capabilities.includes('tools'),
    vision: modelInfo.capabilities.includes('vision')
    // ❌ 没有 thinking
    // ❌ 没有 reasoning_effort
};
```

---

## 八、Ollama v0.23.0 新端点 vs Copilot 使用情况

Ollama v0.23.0 新增了多个 OpenAI 兼容端点，但 Copilot **均未使用**：

| Ollama v0.23.0 端点 | Copilot 是否使用 | 说明 |
|---|:---:|---|
| `/v1/responses` | ❌ | Copilot 的 Ollama provider 不支持 Responses API |
| `/v1/messages` (Anthropic) | ❌ | 只有 Anthropic provider 用 |
| `/v1/images/generations` | ❌ | Copilot 不通过 Ollama 做图片生成 |
| `/v1/audio/transcriptions` | ❌ | Copilot 不通过 Ollama 做音频转录 |
| `/v1/completions` (Legacy) | ❌ | Copilot 不用 legacy completions |
| `/v1/embeddings` | ❌ | Copilot 用自己的 embedding 服务 |
| `/v1/models` / `/v1/models/:model` | ❌ | Copilot 用 `/api/tags` + `/api/show` |

**原因**：Copilot 的 Ollama 集成设计为最简化的本地推理代理，只使用核心的 Chat Completions 功能。其他新端点主要面向直接使用 Ollama 的场景（如 Claude Desktop 集成、图片生成等），不适用于 Copilot 的 BYOK 模式。

---

## 九、mollama 是否需要实现更多新特性？

### 当前状态评估

| 特性 | 是否需要实现 | 优先级 | 原因 |
|------|:---:|:---:|---|
| `/v1/responses` | ⏸️ 暂不需要 | 低 | Copilot 的 Ollama provider 不使用此端点 |
| `/v1/messages` (Anthropic) | ⏸️ 暂不需要 | 低 | Copilot 只有 Anthropic provider 用 |
| `/v1/images/generations` | ⏸️ 暂不需要 | 低 | Copilot 不通过 Ollama 做图片生成 |
| `/v1/audio/transcriptions` | ⏸️ 暂不需要 | 低 | Copilot 不通过 Ollama 做音频转录 |
| `/v1/completions` (Legacy) | ⏸️ 暂不需要 | 低 | Copilot 不用 legacy completions |
| `/v1/embeddings` | ⏸️ 暂不需要 | 低 | Copilot 用自己的 embedding 服务 |
| `/v1/models` | ⏸️ 暂不需要 | 低 | Copilot 用 `/api/tags` + `/api/show` |
| `thinking` 能力上报 | 🔜 可考虑 | 中 | 如果 `/api/show` 返回 thinking capability，且 Copilot 未来支持 Ollama thinking |
| `logprobs` 透传 | 🔜 可考虑 | 中 | Copilot 支持 logprobs，但 Ollama provider 未配置 |
| `reasoning_effort` 参数 | ⏸️ 暂不需要 | 低 | Copilot 的 Ollama provider 不发送此参数 |

### 建议

1. **当前不需要实现更多新特性** — mollama 现有实现已完全满足 Copilot Chat 的集成需求
2. **Ollama v0.23.0 的新端点对 Copilot 无影响** — Copilot 不使用这些新端点
3. **thinking 支持是双向的** — 即使 mollama 上报 thinking capability，Copilot 的 Ollama provider 也不会发送 thinking 参数（因为它没有配置 `supports.thinking: true`）
4. **未来可能的变化** — 如果 VS Code Copilot 扩展更新 Ollama provider 以支持 thinking 或 Responses API，mollama 需要相应跟进

### 未来增强方向（低优先级）

如果未来需要支持更多 Ollama v0.23.0 特性，可以考虑：

| 增强项 | 说明 | 依赖 |
|---|---|---|
| `/v1/responses` 端点 | 支持 OpenAI Responses API | Copilot 扩展支持 |
| `/v1/models` 端点 | 标准 OpenAI 模型列表 | 其他客户端需要 |
| `thinking` 能力上报 | 在 `/api/show` 中返回 thinking capability | Copilot 扩展支持 |
| `logprobs` 透传 | 支持 token 概率返回 | Copilot 扩展支持 |

---

## 十、结论

| 维度 | 结论 |
|------|------|
| **协议兼容性** | ✅ 完全兼容。Copilot 使用混合协议（Ollama 原生 + OpenAI 兼容），mollama 两个协议都支持 |
| **版本兼容性** | ✅ 完全兼容。mollama 模拟版本 0.6.4 满足 Copilot 最低要求 |
| **模型发现** | ✅ 完全兼容。`/api/tags` + `/api/show` 返回 Copilot 需要的所有字段 |
| **推理能力** | ✅ 完全兼容。`/v1/chat/completions` 支持流式、tool_calls、reasoning |
| **Frontend Profile** | ✅ 自动匹配。Copilot 的 `User-Agent: GitHubCopilotChat` 触发 copilot profile |
| **新特性需求** | ✅ 无需实现。Copilot 的 Ollama provider 是最简化实现，不使用 Ollama v0.23.0 的新端点 |
| **无需修改** | ✅ mollama 现有实现已完全满足 Copilot Chat 的集成需求 |

**用户只需将 Copilot Chat 的 Ollama 端点指向 mollama 服务地址（如 `http://127.0.0.1:11434`）即可直接使用。**

---

## 十一、Reasoning 字段兼容：双端配置模型

### 问题背景

不同上游 provider 返回推理内容的字段名不同，不同客户端期望接收的字段名也不同：

| 上游 Provider | 返回的字段 | 客户端 | 期望的字段 |
|---|---|---|---|
| DeepSeek | `reasoning_content` | GitHub Copilot | `thinking` |
| Kimi | `reasoning_content` | Cursor / Continue / Cline | `reasoning_content` |
| OpenRouter (Anthropic) | `thinking` | OpenAI SDK | `reasoning_content` |
| 本地 Ollama | `thinking` | — | — |

mollama 需要在响应中添加客户端期望的字段别名，同时保留原始上游字段。

### 配置模型

```
Upstream Provider → [thinkingField] → mollama 转换层 → [reasoningCompat] → Frontend Client
```

| 配置项 | 位置 | 含义 | 默认值 |
|---|---|---|---|
| `thinkingField` | `models.json → providers.*` | 上游返回的推理字段名 | `"reasoning_content"` |
| `reasoningCompat` | `system.json → frontends.*` | 客户端期望接收的字段名 | `undefined`（不转换） |

### 转换逻辑

当 `reasoningCompat` 已设置且与 `thinkingField` 不同时，mollama 在响应的每个 choice 的 `delta` / `message` 中添加别名字段。原始字段始终保留。

| 上游 `thinkingField` | 客户端 `reasoningCompat` | 转换动作 |
|---|---|---|
| `reasoning_content` | `thinking` | 添加 `thinking` = `reasoning_content` |
| `thinking` | `reasoning_content` | 添加 `reasoning_content` = `thinking` |
| `reasoning_content` | `reasoning_content` | 不转换（相同） |
| `reasoning_content` | *(未设置)* | 不转换（客户端不关心） |

### 配置示例

**models.json** — 告诉 mollama 上游返回什么：

```json
{
  "providers": {
    "deepseek": {
      "thinkingField": "reasoning_content",
      "upstream": { "baseUrl": "https://api.deepseek.com", ... },
      "models": [...]
    },
    "openrouter-anthropic": {
      "thinkingField": "thinking",
      "upstream": { "baseUrl": "https://openrouter.ai/api/v1", ... },
      "models": [...]
    }
  }
}
```

**system.json** — 告诉 mollama 客户端期望什么：

```json
{
  "frontends": {
    "copilot": {
      "reasoningCompat": "thinking",
      ...
    }
  }
}
```

### 默认行为

- **`thinkingField` 默认值**：`"reasoning_content"`（覆盖大多数 provider）
- **`reasoningCompat` 默认值**：`undefined`（不转换，原样透传）
- **Copilot profile**：已显式配置 `reasoningCompat: "thinking"`
