# Thinking (Reasoning Effort) 支持说明

## 概述

Copilot Chat 的模型选择器中，部分模型选中后会展示一个 **"Thinking Effort"（思考力度）下拉框**，允许用户在 `none` / `low` / `medium` / `high` / `max` 等档位间切换。

本文档说明 VS Code 不同版本下 thinking effort 的触发条件，以及 mollama 支持该功能的方案。

---

## VS Code 1.120 的变化

[VS Code 1.120](https://code.visualstudio.com/updates/v1_120)（2026 年 5 月）引入了两项相关改进：

### 1. BYOK 模型 Token 用量显示

BYOK 模型的上下文窗口现显示准确的 token 使用量和百分比。该功能由 Copilot Chat 客户端侧实现，**代理服务器无需任何适配**。

### 2. BYOK 模型的 Thinking Effort 配置

用户现可在模型选择器中直接为 BYOK 模型配置 thinking effort。根据官方说明：

> *"Applies to: Bring-Your-Own-Key (BYOK) reasoning models served via OpenAI-compatible endpoints (OpenAI, xAI (Grok), OpenRouter, and custom OpenAI / Azure OpenAI deployments). Anthropic models already supported this; the control is now consistent across providers."*

**Ollama 不在上述列表中。** 经检查 Copilot Chat 源码，Ollama provider 仍未声明 `supportsReasoningEffort` 能力。

---

## 三种模型接入路径

### 路径对比

| 路径 | 模型来源 | 协议 | 1.120+ 支持 Effort 下拉 |
|------|---------|------|----------------------|
| **原生模型** | Copilot 服务端下发 | 内部 API | ✅ |
| **Anthropic / OpenAI / xAI / OpenRouter BYOK** | 用户通过 BYOK 添加 | OpenAI 兼容 API | ✅ |
| **Custom OpenAI** | 用户在设置中配置 | OpenAI 兼容 API | ❌ 1.120 Stable 中不可用 |
| **Ollama (BYOK)** | 本地 / 代理 Ollama | Ollama `/api/tags` | ❌ 不支持 |

---

## 根因分析

Copilot Chat 中的 thinking effort 下拉框由 `buildConfigurationSchema()` 函数触发，需要同时满足：

1. 模型的 `IChatEndpoint.supportsReasoningEffort` 非空
2. 模型的 `family` 以 `claude` 或 `gpt-` 开头（仅针对原生模型路径）

### Ollama 路径为何不支持

mollama 作为 Ollama 代理，走 Copilot Chat 的 `ollamaProvider.ts` 路径。该路径存在三层限制：

#### 第一层：不声明 `supportsReasoningEffort`

`ollamaProvider.ts` 中的 `_getOllamaModelInfo()` 构建模型能力时**没有**包含 `supportsReasoningEffort`：

```ts
// vsocde-copilot-chat ollamaProvider.ts
const modelCapabilities = {
    name: modelInfo?.model_info?.['general.basename'] ?? modelInfo.remote_model ?? modelId,
    maxOutputTokens, maxInputTokens,
    vision: modelInfo.capabilities.includes('vision'),
    toolCalling: modelInfo.capabilities.includes('tools')
    // 没有 supportsReasoningEffort
};
```

#### 第二层：不使用 Effort 注册函数

Ollama provider 调用的是 `byokKnownModelsToAPIInfo()`，而非 `byokKnownModelsToAPIInfoWithEffort()`。后者会为声明了 `supportsReasoningEffort` 的模型挂载 `configurationSchema`。

```ts
// ollama.ts — Ollama 不使用 byokKnownModelsToAPIInfoWithEffort
return byokKnownModelsToAPIInfo(this._name, this._knownModels).map(model => ({
    ...model,
    url: ollamaBaseUrl
}));
```

#### 第三层：`/api/show` 无扩展字段

Copilot Chat 读取 Ollama `/api/show` 返回的 `capabilities` 字段（字符串数组，如 `["completion", "tools", "vision"]`），该格式不支持传递 thinking effort 等结构化信息。

---

## 实际方案：在 models.json 中定义多个条目（已验证可行）

由于 Ollama 路径和 Custom OpenAI 路径均无法激活 thinking effort 下拉框，实际的解决方案是：为同一上游模型定义多个 Ollama 模型条目，每条配置不同的 `reasoning_effort`。

```json
{
  "providers": {
    "deepseek": {
      "models": [
        {
          "id": "deepseek-v4-pro-default",
          "displayName": "DeepSeek V4 Pro",
          "targetModel": "deepseek-v4-pro",
          "parameters": {
            "thinking": { "type": "disabled" }
          },
          "reasoningHistory": { "mode": "none" }
        },
        {
          "id": "deepseek-v4-pro-thinking-high",
          "displayName": "DeepSeek V4 Pro thinking:high",
          "targetModel": "deepseek-v4-pro",
          "parameters": {
            "thinking": { "type": "enabled" },
            "reasoning_effort": "high"
          },
          "reasoningHistory": { "mode": "inject-empty" }
        },
        {
          "id": "deepseek-v4-pro-thinking-max",
          "displayName": "DeepSeek V4 Pro thinking:max",
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

`displayName` 中的 `thinking:high` / `thinking:max` 使用 `:` 作为 effort 级别分隔符，语义上表示"模型:变体"。用户在模型选择器中切换模型即可切换 effort：

---

## mollama 请求路由

无论通过哪种路径，mollama 处理请求的流程一致：

```
Copilot Chat → mollama (Ollama API / OpenAI API)
  → modelRegistry.get() 匹配 displayName
    → buildUpstreamPayload() 合并 parameters
      → 上游 API 请求体含 reasoning_effort
```

上游请求体中自动注入 `thinking.type` 和 `reasoning_effort` 等参数：

```json
{
  "model": "deepseek-v4-pro",
  "thinking": { "type": "enabled" },
  "reasoning_effort": "high",
  "messages": [...]
}
```

---

## supported reasoning_effort 级别

| 值 | 说明 |
|----|------|
| `max` | 最大推理深度 |
| `xhigh` | 极高推理深度 |
| `high` | 高推理深度 |
| `medium` | 中等推理深度 |
| `low` | 低推理深度 |
| `minimal` | 最低推理深度 |

具体支持哪些级别取决于上游 API 提供商。

---

## 总结

| 问题 | 结论 |
|------|------|
| VS Code 1.120 BYOK thinking effort 是否支持 Ollama？ | **不支持**。Ollama provider 仍不声明 `supportsReasoningEffort` |
| VS Code 1.120 Custom OpenAI 能用吗？ | **1.120 Stable 中不可用**，Manage Models 中无此选项 |
| 最稳定的方案 | 在 `models.json` 中定义多个模型条目，通过切换模型间接切换 effort |
