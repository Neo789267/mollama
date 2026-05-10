# Reasoning Effort 支持说明

## 概述

Copilot Chat 的模型选择器中，部分模型在选中后会展示一个 **"Thinking Effort"（思考力度）下拉框**，允许用户在 `low` / `medium` / `high` / `max` 等档位间切换。

本文档说明 mollama 作为 Ollama 代理，如何支持模型的 reasoning effort 配置。

---

## 三种模型接入路径对比

| 路径 | 模型来源 | 协议 | 是否有 Effort 下拉 |
|------|---------|------|-------------------|
| **原生模型** | GitHub Copilot 服务端下发 | 内部 API | ✅ 有（仅限 `claude` / `gpt-` family） |
| **VS Code 扩展注册** | 第三方扩展通过 `LanguageModelChatProvider` API 注册 | VS Code 扩展 API | ✅ 有（需声明 `configurationSchema`） |
| **Ollama (BYOK)** | 本地 / 代理 Ollama 实例 | `/api/tags` → `/api/show` | ❌ **没有** |

mollama 属于 Ollama (BYOK) 路径。

---

## 根因分析

Copilot Chat 的 Effort 下拉框由 `buildConfigurationSchema()` 函数触发，该函数要求以下条件**同时满足**：

1. 模型的 `IChatEndpoint.supportsReasoningEffort` 字段非空
2. 模型的 `IChatEndpoint.family` 以 `claude` 或 `gpt-` 开头

**Ollama 路径下三层堵死：**

### 第一层：`/api/show` 不输出 effort 能力

Copilot Chat 通过 Ollama 的 `/api/show` 接口获取每个模型的能力信息，返回的 `capabilities` 字段格式为字符串数组（如 `["completion", "tools", "vision"]`），**不包含** `supportsReasoningEffort` 信息。

```ts
// Copilot Chat ollamaProvider.ts — 构建模型能力
const modelCapabilities = {
    name: modelInfo?.model_info?.['general.basename'] ?? modelInfo.remote_model ?? modelId,
    maxOutputTokens, maxInputTokens,
    vision: modelInfo.capabilities.includes('vision'),
    toolCalling: modelInfo.capabilities.includes('tools')
    // 注意：没有 supportsReasoningEffort 字段
};
```

### 第二层：Ollama 提供商不输出 `configurationSchema`

Copilot Chat 中 Anthropic 等提供商使用 `byokKnownModelsToAPIInfoWithEffort()` 为模型挂载 `configurationSchema`，而 Ollama 提供商使用的是不带 Effort 的 `byokKnownModelsToAPIInfo()`。

### 第三层：family 白名单限制

即使前两层被绕过，Copilot Chat 的 `buildConfigurationSchema()` 也**仅对 `claude` 和 `gpt-` 开头的 family 启用** Effort 下拉框：

```ts
const family = endpoint.family.toLowerCase();
if (!family.startsWith('claude') && !family.startsWith('gpt-')) {
    return {};  // 不输出 configurationSchema
}
```

由于 mollama 代理的模型其 family 不可控（由 Copilot Chat 从 `/api/show` 的 `details.family` 中读取），无法保证命中此白名单。

---

## mollama 的可行方案

**为同一上游模型定义多个 Ollama 模型条目**，每条配置不同的 `reasoning_effort` 和 `thinking` 参数。用户在 Copilot Chat 模型选择器中直接选择对应条目即可切换 effort。

### 配置示例

```json
{
  "providers": {
    "deepseek": {
      "upstream": {
        "baseUrl": "https://api.deepseek.com",
        "apiKey": "env:DEEPSEEK_API_KEY"
      },
      "models": [
        {
          "id": "deepseek-v4-pro-local",
          "displayName": "deepseek-v4-pro",
          "targetModel": "deepseek-v4-pro",
          "parameters": {
            "thinking": { "type": "disabled" }
          },
          "reasoningHistory": { "mode": "none" }
        },
        {
          "id": "deepseek-v4-pro-thinking-high",
          "displayName": "deepseek-v4-pro-thinking:high",
          "targetModel": "deepseek-v4-pro",
          "parameters": {
            "thinking": { "type": "enabled" },
            "reasoning_effort": "high"
          },
          "reasoningHistory": { "mode": "inject-empty" }
        },
        {
          "id": "deepseek-v4-pro-thinking-max",
          "displayName": "deepseek-v4-pro-thinking:max",
          "targetModel": "deepseek-v4-pro",
          "parameters": {
            "thinking": { "type": "enabled" },
            "reasoning_effort": "max"
          },
          "reasoningHistory": { "mode": "inject-empty" }
        }
      ]
    }
  }
}
```

### 设计要点

| 配置项 | 说明 |
|--------|------|
| `id` | 每个变体必须唯一，用于 mollama 内部路由 |
| `displayName` | Ollama 模型名，`:` 为 Ollama 原生的 tag 分隔符（如 `llama3:8b`），语义上表示"模型:变体" |
| `targetModel` | 所有变体指向同一上游模型 ID |
| `parameters.thinking.type` | `"enabled"` 启用思考，`"disabled"` 关闭 |
| `parameters.reasoning_effort` | OpenAI 标准的 reasoning effort 级别 |
| `reasoningHistory.mode` | thinking 启用时设为 `"inject-empty"`，关闭时设为 `"none"` |

### 支持的所有 reasoning_effort 级别

| 值 | 说明 |
|----|------|
| `max` | 最大推理深度 |
| `xhigh` | 极高推理深度 |
| `high` | 高推理深度 |
| `medium` | 中等推理深度 |
| `low` | 低推理深度 |
| `minimal` | 最低推理深度 |

具体支持哪些级别取决于上游 API 提供商。

### 效果

Copilot Chat 模型选择器中将出现：

| 显示的模型名 | thinking | reasoning_effort |
|---|---|---|
| `deepseek-v4-pro` | disabled | — |
| `deepseek-v4-pro-thinking:high` | enabled | `high` |
| `deepseek-v4-pro-thinking:max` | enabled | `max` |

> **注意**：`:` (单冒号) 是 Ollama 原生的 tag 分隔符，但 Copilot Chat 不会对 Ollama 模型执行合并——它们将作为三个独立模型出现在选择器中。要切换 effort，只需切换模型即可。

---

## 请求路由流程

```
Copilot Chat 用户选择 "deepseek-v4-pro-thinking:high"
  → Copilot Chat 发送 Ollama 请求: { model: "deepseek-v4-pro-thinking:high" }
    → mollama 通过 displayName 匹配到对应 ModelDefinition
      → buildUpstreamPayload() 合并 parameters
        → 上游 API 请求体包含:
            "thinking": { "type": "enabled" },
            "reasoning_effort": "high"
```

---

## 总结

| 问题 | 结论 |
|------|------|
| mollama 能否实现单模型 + Thinking Effort 下拉框？ | **不能**（受限于 Ollama 路径在 Copilot Chat 中的实现） |
| mollama 的替代方案 | 配置多个模型条目，用 `displayName` 区分 effort 档位 |
| 用户体验 | 在模型选择器中切换模型即切换 effort |
