# 单模型、多思考档位

模型 API 核对日期：2026-10-05。客户端兼容性于 2026-10-28 复核至 ollama-vscode 0.0.14，官方 main `8265bb2`；本次未修改提供商参数或默认档位。0.0.14 仍通过 `ollama.thinkingLevels` 设置档位，没有原生强度选择控件。

每个实际模型只在目录中出现一次，通过 `ollama.thinkingLevels` 选择思考开关或强度。未设置时采用用户确认的默认：DeepSeek `high`、Kimi For Coding `max`。

## 官方 API 核对与最终配置

| 目录 ID | 上游模型 | 可选值 | 默认 | 上游参数 |
|---|---|---|---|---|
| `deepseek-flash` | `deepseek-flash`（V4.1 Flash） | `false`, `low`, `high`, `max` | `high` | `thinking.type` + `reasoning_effort`；关闭时删除 effort |
| `deepseek-v4-pro` | `deepseek-v4-pro` | `false`, `low`, `high`, `max` | `high` | 同上 |
| `kimi-for-coding` | `kimi-for-coding`（K2.8 Preview） | `false`, `low`, `high`, `max` | `max` | 仅 `reasoning_effort`；关闭发送 `none` |
| `kimi-k2-6-local` | `kimi-k2.6` | `false`, `true` | `true` | `thinking.type` |
| `kimi-k2-5-local` | `kimi-k2.5` | `false`, `true` | `true` | `thinking.type` |
| `kimi-k2-7-code-local` | `kimi-k2.7-code` | 固定开启 | `true` | 不发送思考控制参数 |
| `mimo-v2-6-pro-local` | `mimo-v2.6-pro` | `false`, `true` | `true` | `thinking.type`，不发送 reasoning_effort |
| `mimo-v2-6-flash-local` | `mimo-v2.6-flash` | `false`, `true` | `true` | 同上 |

- [DeepSeek 模型列表](https://api-docs.deepseek.com/api/list-models/)给出 low/high/max、默认 high、1,048,576 上下文和 393,216 输出上限。Flash 支持图片，Pro 只支持文字。配置已对应更新。
- [DeepSeek 更新记录](https://api-docs.deepseek.com/updates/)说明旧 deepseek-v4-flash 已转到 V4.1 Flash；新配置使用正式 ID deepseek-flash。
- [DeepSeek Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion/)支持 thinking.type 和 reasoning_effort；[思考模式](https://api-docs.deepseek.com/guides/thinking_mode/)列出兼容档位映射。
- [Kimi Code 模型配置](https://www.kimi.com/code/docs/kimi-code/models.html)和[更新记录](https://www.kimi.com/code/docs/en/kimi-code/whats-new.html)确认 kimi-for-coding 于 2026-09-11 升级为 K2.8 Preview，默认 max、可关闭/调档，支持 1M 上下文。保留原 32,768 输出限制，这是本地配置上限，非声称的官方最大值。
- [Kimi 思考模型](https://platform.kimi.com/docs/guide/use-thinking-models)区分 Moonshot API 的 K2.6 开关与 K2.7 Code 固定思考。Kimi Code 和 Moonshot API 的规则不能混用。
- [Kimi K2.6 参数表](https://platform.kimi.com/docs/guide/kimi-k2-6-quickstart)规定思考/非思考温度分别为 1/0.6，现有条件参数覆盖继续执行。[K2.5 官方模型说明](https://huggingface.co/moonshotai/Kimi-K2.5)描述 Thinking/Instant 两种模式。

### MiMo 官方 API 核对与迁移

- [模型目录](https://mimo.mi.com/docs/en-US/quick-start/model)列明 V2.6 Pro / Flash 支持多模态、工具、思考、1M 上下文和 128K 输出，配置保留 1,048,576 / 131,072 的限制。
- [下线公告](https://mimo.mi.com/docs/en-US/updates/deprecate)规定 V2.5 Pro / V2.5 于北京时间 2026-10-21 10:00 下线且不会自动替换。经用户确认，本地配置改为 V2.6 Pro / Flash；旧 ID `mimo-v2-5-pro-local` / `mimo-v2-5-local` 和旧展示名称是隐藏别名，**现在请求这些别名也会路由至 V2.6，而不是 V2.5**。
- [Token Plan 文档](https://mimo.mi.com/docs/tokenplan/subscription)包含 V2.6 Pro / Flash；保留原中国区 URL 和 env 密钥引用，不切到按量付费接口，不添加 Token Plan 不包含的 UltraSpeed。
- [Chat Completions 文档](https://mimo.mi.com/docs/en-US/api/chat)仅定义 thinking.type 开/关，默认 enabled。目录只声明 [false, true]，不虚构 low/high/max；直接发送命名档位返回 400。官方 [Responses 文档](https://mimo.mi.com/docs/en-US/api/chat/responses)也明确各非 none 档位目前行为相同；这里不将 Responses 参数混入 Chat Completions。
- [采样参数说明](https://mimo.mi.com/docs/en-US/api/guidance/model-hyperparameters)：思考开启时固定 temperature=1、top_p=0.95；关闭时允许客户端覆盖，未指定仍用 1 / 0.95。
- Chat Completions 的总输出预算是 max_completion_tokens，包含思考与答案。配置 maxTokensField 将 Ollama options.num_predict / OpenAI max_tokens 转成该字段；原生 max_completion_tokens 也受本地上限约束，两种预算同时存在时取较小值，禁止非正整数，不再发送 max_tokens。其他模型的旧行为不变。
- [深度思考说明](https://mimo.mi.com/docs/en-US/quick-start/usage-guide/other/deep-thinking)要求工具调用历史完整回传 reasoning_content，否则可能报 400。保留已有原文和 inject-empty 兼容策略；空字符串不是完整历史，不能保证官方插件的所有多轮工具调用兼容。严格场景仍需会回传思考的客户端。

## VS Code 使用

插件 0.0.12 / 0.0.13 均可在 Settings JSON 中按 `/api/tags` 的 **model ID** 设置：

```json
{
  "ollama.thinkingLevels": {
    "deepseek-flash": "high",
    "deepseek-v4-pro": "max",
    "kimi-for-coding": "low",
    "kimi-k2-6-local": false,
    "mimo-v2-6-pro-local": true,
    "mimo-v2-6-flash-local": false
  }
}
```

下一次请求生效；删除条目恢复服务端默认。布尔值不能写成字符串。设置键不是展示名称。[插件最终实现](https://github.com/ollama/ollama-vscode/pull/41)校验 capability 和 `/api/show.thinking`；未设置/不受支持时省略 think。直接向 mollama 发送不支持的值则返回 400。

**截至本次核对的官方 0.0.13 / d5dd402，聊天框档位下拉框及原生 thinking 显示/历史回传仍未接入。** 单模型方案使用 Settings JSON；其他发行版或客户端界面需要单独核对。更新服务目录后执行 `Ollama: Refresh Models`，选择规范模型 ID。0.0.13 可执行 `Ollama: Diagnose Models` 查看 supported values、server-advertised default 和 effective setting for next request。Kimi 官方建议切换强度时开启新会话，避免反复失效的上下文缓存。

## 配置格式

```json
{
  "id": "deepseek-flash",
  "displayName": "DeepSeek V4.1 Flash",
  "targetModel": "deepseek-flash",
  "contextWindow": 1048576,
  "maxOutputTokens": 393216,
  "supports": { "tools": true, "vision": true, "thinking": true },
  "thinking": {
    "mode": "toggle",
    "values": [false, "low", "high", "max"],
    "default": "high",
    "effortAliases": { "none": false, "medium": "high", "xhigh": "high" }
  },
  "aliases": [
    { "id": "deepseek-v4-flash-default", "thinking": false },
    { "id": "deepseek-v4-flash-thinking-high", "thinking": "high" },
    { "id": "deepseek-v4-flash-thinking-max", "thinking": "max" }
  ],
  "parameters": {},
  "reasoningHistory": { "mode": "inject-empty" }
}
```

thinking 是可选的新字段；旧配置不声明时仍沿用旧转换规则，不自动合并或改写已有文件。

| 字段 | 约束与含义 |
|---|---|
| `mode` | toggle 发送 thinking.type，字符串档位另发送 reasoning_effort；effort 只发送 reasoning_effort（false → none）；fixed 不发送控制参数 |
| `values` | 非空、不重复的布尔值/非空字符串列表。用 false 表示关闭；effort 不接受 true；fixed 必须为 [true] |
| `default` | 必须属于 values；既写入 /api/show，也用于未指定控制的请求 |
| `effortAliases` | 可选兼容值映射，不能重新定义规范值。DeepSeek xhigh → high，Kimi Code xhigh → max，必须按模型配置 |
| `aliases` | 隐藏请求别名，id 是旧 ID/名称，thinking 指定该入口旧默认。不加入 tags/ps；不能与任何模型 ID、名称或别名冲突 |

声明 thinking 后，模型的 parameters、payloadOverrides、条件覆盖中不能再重复设置 think/thinking/reasoning_effort，避免元数据与实际行为不同。可关闭模型不能搭配 reasoningHistory: always。

请求经过已有默认值/Profile 合并后，控制优先级是：显式 think → thinking.type: disabled → reasoning_effort → thinking.type: enabled → 模型默认。原生 reasoning_effort: none 表示关闭。开启但未选档时用模型启用默认档，默认关闭时用 values 中第一个启用档。客户端显式控制也适用于旧别名请求。

/api/show 只公开 thinking.values/default，不公开内部映射或兼容别名。

## 历史消息边界

思考状态在参数映射后统一计算。inject-empty 和条件覆盖也适用于只发送 reasoning_effort 的 Kimi Code；关闭时不补空思考。K2.7 Code 的 always 规则继续生效。已有 reasoning_content 原样保留，历史 thinking 转为 reasoning_content，工具 ID/结果关联保持不变。

官方要求在相应多轮/工具调用中回传原始思考。插件 0.0.12 / 0.0.13 不回传该内容，因此 **补 reasoning_content: "" 只是原有兼容降级，不等于恢复原始思考，也不能保证所有上游版本接受**。本次没有引入跨请求思考缓存。严格场景可用 require-present 并选择会回传思考的客户端；缺少历史时收到明确错误。

## 现有部署迁移

仓库已将 Flash/Pro 的三个预设各合为一个，目录总数由 12 变为 8；旧预设 ID 作为隐藏别名保留 off/high/max 默认。规范 ID 使用已确认的 high 默认。

服务器须逐项迁移，不能用仓库示例直接覆盖：

1. 备份所选实例 models/system 文件，保留 provider URL、密钥、代理、超时和自定义模型。
2. 合并同上游模型的预设，迁移各旧 ID/名称为隐藏别名并保留旧默认。若预设的工具能力、参数、路由有差异，须先核对，不能只按名称删除。
3. 添加 thinking，移除该模型重复的原生控制默认，可切换模型使用 inject-empty，固定模型保留 always。
4. 11444 上次存在大小写不同的 DeepSeek-V4.1-Flash-* ID，部署时以实际配置为准，不能只迁移仓库的小写旧 ID。
5. 验证配置、模型数、show、各档/默认/关闭和旧 ID 请求，再重启选定实例、刷新客户端模型列表。

本轮本地模拟上游及插件契约验证，不代表已做真实付费 API 推理或生产部署。
