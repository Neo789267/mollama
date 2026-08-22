# ollama-vscode 插件与 mollama 集成研究报告

本文档记录 [ollama-vscode](https://github.com/ollama/ollama-vscode)（Ollama 官方 VS Code 扩展）与 Ollama 的集成机制、mollama 的适配方案，以及与 GitHub Copilot Chat BYOK 方式的异同对比。

> **研究日期**: 2026-08-22
> **插件版本**: main 分支 0.0.8（当前市场版本）+ PR #41「Support thinking models」（open 未合并，官方维护者已认可并接手）
> **ollama-js 版本**: 0.6.3（插件 lockfile 锁定）

---

## 一、与 BYOK（Copilot Chat）方式的异同对比

| 阶段 | BYOK（Copilot Chat） | ollama-vscode 插件 |
|------|----------------------|--------------------|
| 接入方式 | Copilot 内置 Ollama provider（Manage Models） | `vscode.lm.registerLanguageModelChatProvider('ollama-models', ...)`，模型出现在 Copilot Chat 模型选择器的 "Ollama" 分组 |
| 连接实现 | VS Code 内置 fetch | `ollama` npm JS 库（ollama-js 0.6.3）+ undici（headersTimeout 10 分钟），**纯 HTTP，绝不调用 ollama CLI** |
| 版本检查 | `GET /api/version`，**硬门槛 ≥ 0.6.4** | `GET /api/version`，仅记日志，**失败容忍** |
| 模型列表 | `GET /api/tags`（只读 `model` 字段） | `GET /api/tags`（读 `name`、`capabilities`、`context_length`、`details.family` 等） |
| 模型详情 | `POST /api/show`（必需，解析 `model_info`/`capabilities`） | `POST /api/show`（**失败容忍**，能力/上下文长度探测） |
| **推理请求** | **`POST /v1/chat/completions`（OpenAI SSE）** | **`POST /api/chat`（Ollama 原生 NDJSON 流）——最大差异** |
| 上下文检查 | 不用 | `GET /api/ps`（仅对 `local` 模型：chat 开始时轮询 `context_length`；远程模型跳过） |
| 模型推荐 | 不用 | `GET /api/experimental/model-recommendations`（唯一不走 ollama-js 的裸 fetch，**失败容忍**） |
| embeddings | 不用（Copilot 自带 embedding 服务） | **不用**（无任何 embed 调用，无 RAG/代码库索引） |
| thinking | 支持（`/v1` 路径需 `reasoning_content → thinking` 转换） | main(0.0.8) 完全不处理；PR #41 加入完整支持（见第四节） |
| 其他 | 不用 keep_alive | 从不发送 `keep_alive`/`format`/`suffix`，无 FIM、无卸载语义；无 CORS 问题（Node 侧 fetch） |

**关键结论**：BYOK 是"发现走原生 API、推理走 OpenAI 兼容 API"的混合模式；ollama-vscode 插件**全部走 Ollama 原生 API**，推理只打 `/api/chat`。

---

## 二、插件调用的端点清单

| 端点 | 方法 | 触发时机 | 失败容忍 |
|------|------|----------|:--------:|
| `/api/version` | GET | 每次模型发现时 | ✅ |
| `/api/tags` | GET | 模型列表发现 | ❌（必须 200 + 合法 JSON，否则模型全部消失） |
| `/api/show` | POST | 每个模型 hydrate 一次，请求体固定 `{"model": "<name>", "verbose": false}` | ✅ |
| `/api/chat` | POST | 聊天请求（永远 `stream: true`） | ❌ |
| `/api/ps` | GET | 本地模型 chat 开始时轮询已分配上下文长度 | ✅ |
| `/api/experimental/model-recommendations` | GET | tags 之后（2 秒超时），期望 `{"recommendations": [{"model": "..."}]}` | ✅ |

不调用：`/api/generate`（含 suffix/FIM）、`/api/embed*`、`/api/pull`、`/api/create`、`/api/delete`、`/api/copy`、`/api/blobs`，以及**所有 `/v1/*` OpenAI 兼容端点**（ollama-js 0.6.3 整个库没有任何 `/v1` 路径）。

### 模型过滤规则

- 不要求模型真的被 pull，不检查文件/size。
- `/api/tags` 条目中 `remote_host` 非空，或名称 tag 为 `cloud`/以 `-cloud` 结尾 → 标记为远程模型（`local: false`）。mollama 的条目带 `remote_host`（上游 origin）与 `remote_model`，与真实 Ollama 云模型一致，因此全部视为远程模型——插件跳过 chat 前的机器上下文检查（见第五节），流在响应头到达后立即开始消费。
- 能力标记：tags 条目与 show 响应的 `capabilities` 合并后小写匹配——含 `tools`/`tool` → 工具调用；含 `vision`/`image` → 图片输入。
- 上下文窗口探测顺序（`sharedContextWindow()`）：先从 show 的 `parameters`/`modelfile` 文本正则解析 `num_ctx`，再查顶层/`details`/`model_info` 中以 `.context_length` 结尾的键（mollama tags 顶层的 `context_length` 与 show 的 `proxy.context_length` 均可命中），都没有则回退 32768。远程模型在 tags 已含 `capabilities` + `context_length` 时不再发起 show 请求。
- `/api/ps` 中若匹配模型的 `context_length < 65536` 会弹"上下文窗口太小"警告；mollama 返回全部已配置模型且 `context_length` 保底 64K → 不警告。

---

## 三、`/api/chat` 请求/响应细节

### 请求（插件 → mollama）

```json
{
  "model": "<name>",
  "messages": [ ... ],
  "stream": true,
  "tools": [ ... ],
  "options": { ... }
}
```

- 固定只有 `model`/`messages`/`stream`/`tools`/`options` 五个键；**不发送** `keep_alive`、`format`、`raw`、`suffix`；`think` 仅 PR #41 合并后出现（见第四节）。
- `messages` 转换规则（`src/convert.ts`）：
  - role：`user`/`assistant`/`system`/`tool`；
  - 图片 part → `images: ["<base64>"]`；
  - assistant 历史中的工具调用 → `tool_calls: [{id, function: {name, arguments(对象)}}]`；
  - 工具结果 → `{role: "tool", content, images?, tool_call_id}`。

### 响应（mollama → 插件，NDJSON 流）

插件按 `\n` 行解析 JSON，每块读取：

| 字段 | 用途 |
|------|------|
| `message.content` | 文本增量 → `LanguageModelTextPart` |
| `message.tool_calls[]` | `function.name` + `function.arguments`（**必须是对象**）→ `LanguageModelToolCallPart` |
| `message.thinking` | 仅 PR #41：→ `LanguageModelThinkingPart` |
| `prompt_eval_count` / `eval_count` | 汇集成 usage part |

**硬性要求**：
- 流必须以含 `"done": true` 的块结束，否则 ollama-js 的 `AbortableAsyncIterator` 抛 `"Did not receive done or success response in stream."`。
- 流中任何含 `"error"` 字段的块会抛错。
- 非 2xx 错误响应需为 JSON `{"error": "..."}`（HTTP 401 会触发 "Run ollama signin" 提示，mollama 不应返回 401）。

### 请求头

由 ollama-js 添加：`Content-Type: application/json`、`Accept: application/json`、`User-Agent: ollama-js/<version> (<arch> <platform> Node.js/<version>)`，以及用户在 `ollama.headers` 设置里的自定义头。

---

## 四、PR #41「Support thinking models」机制

> 状态：**open 未合并**（2026-08-11 维护者留言认可并接手完善）。main 分支 0.0.8 完全忽略 thinking。以下机制在 PR 合并后生效。

### 4.1 能力识别与 Thinking Effort 选择器

- 从 tags/show 合并的 `capabilities` 中匹配 `"thinking"` 或 `"reasoning"`；
- **且**模型名（去 tag）或 `details.family` 须命中 `src/thinking.ts` 的硬编码策略表：
  - `gpt-oss` → 档位 `['low','medium','high']`，默认 `medium`
  - `deepseek-v4-flash` / `deepseek-v4-pro` → `['none','high','max']`，默认 `none`
  - `glm-5.2` → `['high','max']`，默认 `high`
- 两个条件都满足，VS Code 模型卡上才显示 "Thinking Effort" 下拉。

### 4.2 请求侧：`think` 字段

- `'none'` → `"think": false`；`'low'/'medium'/'high'/'max'` → **字符串原样发送**（如 `"think": "high"`）；
- 有策略的模型每次请求都带 `think`（至少带默认值）；无策略的模型永远不带。

### 4.3 响应侧与历史回传（思考链闭环）

- 响应：NDJSON 块的 `message.thinking` → proposed API `LanguageModelThinkingPart` 上报，UI 渲染为思考区；
- **历史回传**：VS Code 会话历史中的 thinking part 被 convert.ts 拼回 assistant 消息的 **`thinking` 字段**（多段 `\n` join），下一轮请求原样回传——Ollama 原生协议的思考链完整闭环。纯 thinking 无 content 的历史消息也会回传。
- 不做：thinking 预算、redacted/encrypted thinking、signature 校验——纯文本往返。

---

## 五、mollama 适配点（已实现）

| 适配项 | 实现 |
|--------|------|
| `/api/tags` 增强 | 条目新增 `capabilities`（含 `thinking`）、顶层 `context_length` 与 `remote_host`/`remote_model`；`details.family`/`families` 支持按模型配置（`family` 字段，默认 `"proxy"`） |
| `/api/show` | 已有 `capabilities`（新增 `thinking`）、`model_info["proxy.context_length"]` 与 `remote_host`/`remote_model`，可被插件探测逻辑命中 |
| 远程模型标记 | `/api/tags`、`/api/show`、`/api/ps` 均返回 `remote_host`（provider 上游 origin，无法解析时回退 `https://ollama.com:443`）与 `remote_model`，与真实 Ollama 云模型一致。插件据此把模型视为远程（`local: false`），**跳过 chat 前的 `/api/ps` 机器上下文检查**，消除响应流延迟消费窗口（背景与定位过程见第六节） |
| 保底 `done:true` | 上游 SSE 缺少 `finish_reason` 就结束时，流尾部自动补发终止块（`openai-to-ollama.ts`），避免 ollama-js 抛错 |
| tool_call id 保留 | assistant 历史 `tool_calls[].id` 原样透传上游，保证与 `role:"tool"` 消息的 `tool_call_id` 一致（`ollama-to-openai.ts`） |
| tools schema 规范化 | 上游 OpenAI 兼容接口严格校验 JSON Schema（如 DeepSeek 要求 `type: "object"`），而插件可能发出 `type: null` 或缺失的 `parameters`；转换层统一兜底为 `type: "object"`（`ollama-to-openai.ts`） |
| 上游错误透传 | 上游 ≥400 时返回 Ollama 标准错误 `{"error": "<上游真实消息>"}`，不再映射成假成功负载（`server.ts`） |
| `think` 字符串档位 | `/api/chat` 接受 boolean 或字符串 `think`；字符串档位（如 `"high"`/`"max"`）映射为 `thinking: {type: "enabled"}` + `reasoning_effort: "<level>"` 发往上游（`provider-policy.ts`），与 DeepSeek 上游实际接受的字段一致；`think: false` → `thinking.type: "disabled"` 并清除继承的 `reasoning_effort` |
| 思考链连续性 | assistant 历史 `thinking` 字段 → 上游 `reasoning_content`（已有逻辑），配合 `reasoningHistory` 模式，PR #41 回传的 thinking 历史可完整透传 |
| `/api/experimental/model-recommendations` | 返回 200 `{"recommendations": []}` |
| `/api/ps` | 返回全部已配置模型（视为已加载），含 `remote_host`/`remote_model`，`context_length` 保底 64K（无上下文警告） |

### 配置建议

> 注意：PR #41 尚未合并进市场版本（当前 0.0.8）。0.0.8 下插件不发送 `think`、不显示档位选择器，因此**现阶段仍需按 reasoning effort 拆分成多个模型**（如 `DeepSeek V4 Flash` / `DeepSeek V4 Flash High` / `DeepSeek V4 Flash Max`），用静态 `parameters.reasoning_effort` 区分。

拆分模型的同时建议保留以下两个字段，PR #41 合并后可无缝切换到单模型 + UI 选档位：

```json
{
  "id": "deepseek-v4-pro-thinking-high",
  "displayName": "DeepSeek V4 Pro High",
  "targetModel": "deepseek-v4-pro",
  "family": "deepseek-v4-pro",
  "supports": { "tools": true, "vision": false, "thinking": true },
  "parameters": {
    "thinking": { "type": "enabled" },
    "reasoning_effort": "high"
  },
  "reasoningHistory": { "mode": "inject-empty" }
}
```

- `supports.thinking: true` → capabilities 含 `thinking`；
- `family` 命中插件硬编码策略表（或把 `displayName` 直接命名为 `deepseek-v4-pro` 等插件认识的名字）；
- PR #41 合并后：把每个 targetModel 的多个档位模型合并为一个（`parameters.thinking.type` 作为默认状态），插件发送 `think: false / "high" / "max"`，mollama 动态映射为 `thinking.type` + `reasoning_effort`，覆盖静态默认值；
- `reasoningHistory: inject-empty` 仅在 thinking enabled 时生效，disabled 时不注入，两种状态都正确。

### 无需 frontend profile / thinking 转换

- profile 机制（按 User-Agent 注入 system 消息、覆盖参数、`reasoningCompat` 转换）是为修正 Copilot 等前端的请求形态而设；ollama-vscode 的请求是标准 VS Code LM 消息流，无需注入或覆盖。
- `reasoningCompat` 只作用于 `/v1/chat/completions` 路径；插件走 `/api/chat`，mollama 本就在 NDJSON 中原生输出 `message.thinking` 字段，无需转换。
- 注意：插件把 `message.content` 原样显示，reasoning 内容必须隔离在 `thinking` 字段（mollama 现状正是如此），否则思考文本会混进聊天回复。

---

## 六、已踩坑：插件模式下流式响应被 GC 掐断

> 2026-08-22 定位。这是适配过程中最隐蔽的一个坑，完整记录以备后续参考。

### 现象

插件模式下 chat 请求高频失败（约 1/10 ~ 1/30，扩展宿主繁忙时更频繁），报错：

```
Did not receive done or success response in stream.
  at [Symbol.asyncIterator] (ollama/dist/browser.cjs:52:11)
  at OllamaLanguageModelProvider.provideLanguageModelChatResponse (out/provider.js)
```

失败时 mollama 服务端日志只有 `request.client_disconnected`（无 stream_error / upstream_error），且断开前数据正在正常流动——看起来"毫无道理"。同一 mollama 实例走 BYOK 方式则从不失败。

### 根因链

1. 插件对 `local` 模型（无 `remote_host`）在 `provideLanguageModelChatResponse` 里**先发 chat 请求、再做 `/api/ps` 机器上下文检查**，检查完成后才开始 `for await` 消费响应流（`provider.js`）。窗口 = 响应头到达 → 开始消费，实测 34ms ~ 1s。
2. ollama-js 0.6.3 的 `processStreamableRequest` 中，fetch 返回的 `Response` 在生成器首次 `next()` 之前**只被弱引用持有**；窗口期内扩展宿主发生 GC，undici 随即拆毁响应体与 socket。
3. socket 断了 → `AbortableAsyncIterator` 的内部迭代器无 `done` 结束 → 抛出上面的错误。该报错具有强迷惑性：它对"上游真没发 done"和"客户端侧连接被 GC 拆掉"给出完全相同的文案。

### 为什么 BYOK 不受影响

Copilot 内置 BYOK 走 `/v1/chat/completions` 的 `chatMLFetcher`，拿到响应**立即消费**，且没有 ps 检查，不存在未消费窗口。

### 诊断方法（可复用）

- 插件侧：给已安装插件的 `out/provider.js` 打临时埋点（chat start / streamRequest settled / consume start/end / error），与 mollama 日志按毫秒级时间线对齐 → 发现 settle 后 1ms 即报错、服务端同时刻看到连接断开。
- 复现：用插件**同款依赖**（其 `node_modules` 下的 undici 7.28 + ollama-js 0.6.3）写本地 replica，完整复刻"chat + ps 轮询 + 延迟消费"流程。
- 二分（每轮 20~60 次）：完整流程偶发失败（1/30）；窗口期强制 GC（`node --expose-gc`）→ **19/20 失败**；强引用钉住 `Response` + 强制 GC → **0/20**；无 ps 检查（远程模型路径）+ 强制 GC → **0/20**。

### 修复

mollama 在 `/api/tags`、`/api/show`、`/api/ps` 中返回 `remote_host`（provider 上游 origin）与 `remote_model`——这正是真实 Ollama 对云模型的标准标记。插件据此把模型视为远程（`local: false`），**整体跳过** ps 上下文检查，响应头到达后 1~2ms 即开始消费，窗口归零。修复后实测 56/56 成功、ps 轮询消失。

### 排查启示

- 服务端日志干净 ≠ 问题在服务端；但也**不能**仅凭"断开时数据在流动"断定是客户端 bug——需要用同栈 replica 把间歇故障变成确定性故障（强制 GC）再二分。
- 凡"以流式 fetch 响应先放着、过会儿再读"的客户端模式，在 Node/undici 下都有此隐患。

---

## 七、验证清单

```
1. GET /api/version                          → {"version":"0.6.4"}          ✅
2. GET /api/tags                             → capabilities/context_length/remote_host ✅
3. POST /api/show                            → model_info + capabilities   ✅
4. GET /api/ps                               → 全部模型 + context_length   ✅
5. GET /api/experimental/model-recommendations → {"recommendations":[]}    ✅
6. POST /api/chat (stream)                   → NDJSON，末块 done:true      ✅
7. POST /api/chat (tools)                    → tool_call id 一致           ✅
8. POST /api/chat (think: "high")            → thinking.effort 透传        ✅
9. POST /api/chat (thinking 历史)             → reasoning_content 透传      ✅
```

对应集成测试见 `test/integration.test.js`。

**使用方式**：启动 mollama 后，ollama-vscode 插件默认端点 `http://127.0.0.1:11434` 即直接可用，无需任何配置。
