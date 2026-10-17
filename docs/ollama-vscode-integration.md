# ollama-vscode 与 mollama 集成

核对日期：2026-10-17。官方插件版本：0.0.13；main：`d5dd402`。上次同步基线：0.0.12 / `527f6dc`。

## 调用路径

官方插件使用原生 `/api/chat`（NDJSON）；Copilot 内置 Ollama BYOK 使用 `/v1/chat/completions`（OpenAI SSE），mollama 支持两条路径。

| 端点 | 触发与用途 |
|---|---|
| GET /api/version | 发现时读取版本，仅日志、失败容忍；无新增硬版本门槛 |
| GET /api/tags | 必需。name 展示、model 稳定请求 ID；读取能力、上下文、输出上限 |
| POST /api/show | 详情与 thinking 策略；0.0.12 会补查远程思考模型，即使 tags token 元数据完整 |
| POST /api/chat | model/messages/stream/tools/options，以及可选 think；总是流式 |
| GET /api/ps | 本地模型上下文探测；mollama 返回 remote_host，因此跳过 |
| GET /api/experimental/model-recommendations | 可选，失败容忍；mollama 返回空列表 |

插件不调用 /v1/*、embeddings、pull/create/delete。ollama-js 依赖仍为 0.6.3；推理首包超时默认 10 分钟，由 ollama.inferenceTimeoutMinutes 调整。

## 单模型、多 thinking level

PR [#41](https://github.com/ollama/ollama-vscode/pull/41)已合并，0.0.12 和本次核对的 0.0.13 均使用稳定 Settings API：

```json
{
  "ollama.thinkingLevels": {
    "deepseek-flash": "high",
    "deepseek-v4-pro": "max",
    "kimi-for-coding": "low"
  }
}
```

键必须匹配 /api/tags.models[].model，变化在下次请求生效。插件要求 thinking/reasoning capability，并优先读取 /api/show 顶层：

```json
{
  "thinking": {
    "values": [false, "low", "high", "max"],
    "default": "high"
  }
}
```

至少有两个不同值、且 default 属于 values 时才接受控制设置。元数据缺失时回退少数已知模型规则（旧规则不含 DeepSeek low）；非法元数据不会回退。未设置或不受支持时省略 think，保留服务默认。

**在本次拉取的官方 0.0.13 / d5dd402 中，聊天框原生思考显示、历史回传和档位下拉框仍未实现。** 设置页的 Thinking Levels 与聊天框下拉框是不同入口；如果安装版本或发行渠道提供其他界面，应按它实际发送的请求验证，不能仅根据界面推断参数。官方参数核对、模型配置与迁移步骤见 [单模型思考档位方案](thinking-levels.md)。

0.0.13 的 `Ollama: Diagnose Models` 会展示各模型支持的值、服务端默认值、已配置的覆盖值和下次请求生效值。mollama 的 `/api/show.thinking` 已满足此功能，无需新增字段。K2.7 Code 的 `[true]` 是固定模式，诊断会显示没有可配置档位，这是预期行为。

## mollama 的适配

- tags/ps 返回稳定 model.id，名称用于展示及兼容请求；tags/show 返回 max_output_tokens。
- 所有代理模型标记 remote_host/remote_model；show 提供上下文、能力和 thinking.values/default。
- 每个模型声明 thinking 控制策略并按上游协议映射。Flash、Pro 各只展示一次，旧预设作为隐藏别名接受请求。
- 工具 schema 规范化为对象；保留 tool-call ID 和工具结果的关联。
- SSE 转 NDJSON，分别输出 message.content、message.thinking 和对象形式 tool_calls；无上游 finish_reason 时补 done:true。
- 上游错误使用 Ollama JSON 错误；流中断尽可能发送 error 块，客户端断开时销毁上游流。
- 插件不回传思考历史，inject-empty 是兼容降级，不是完整原始思考恢复；详见方案中的历史消息边界。

## 0.0.12 → 0.0.13 核对与同步

完整比较范围：[527f6dc...d5dd402](https://github.com/ollama/ollama-vscode/compare/527f6dc...d5dd402)。

| 官方更新 | 对 mollama 的影响与处理 |
|---|---|
| [#91 thinking 诊断](https://github.com/ollama/ollama-vscode/pull/91) | 已提供准确 values/default、capabilities 和稳定 ID；保持现有协议，验证了官方实际诊断函数 |
| [#95 流式五分钟超时和网络错误](https://github.com/ollama/ollama-vscode/pull/95) | 代理上游也使用 Undici，需要同步消除隐藏超时；直连和代理的流式 dispatcher 显式关闭 headers/body 默认计时器，由现有 timeoutMs / streamIdleTimeoutMs 管理，网络请求错误带上底层 cause 信息 |
| [#96 本地上下文扩容](https://github.com/ollama/ollama-vscode/pull/96) | 只对 local 模型自动重试 num_ctx；mollama 的 remote_host 标记会跳过此逻辑，继续保持真实远程身份，不伪造本地内存分配或上下文扩容 |
| 发布版本与 VSIX | 客户端更新，无服务器端点变化；思考控制仍使用 /api/chat 顶层 think |

流式连接建立后取消响应头等待计时器，后续停顿受 `streamIdleTimeoutMs` 管理。若请求流式却收到 JSON，响应计时器保持到完整读取 JSON，避免错误响应或重试响应卡住。完成、错误和客户端中断都会释放本次创建的 dispatcher。

**现有示例配置的 streamIdleTimeoutMs 仍是 300000（五分钟），这是显式策略。** 如需容忍更长的上游静默，应调整对应 provider 的这个值；设为 0 可关闭代理的流式空闲超时。插件的 Inference Timeout Minutes 管理客户端开始推理的等待，不能覆盖服务器自己的限制。此次没有改写已有 provider 超时、模型默认值或密钥。

验证：TypeScript 构建、完整测试套件；模拟直连及 HTTP CONNECT 代理的隐藏超时、空闲超时、持续输出、JSON 响应超时、重试和断开清理。用官方 0.0.13 的 thinking.ts / diagnostics.ts 直接校验 8 个模型、20 个可选档位、默认值与无效配置回退。未调用真实付费推理；未将真实聊天框 UI 当作已验证。

## 历史：0.0.11 → 0.0.12 差异

上次基线 63cc20e 与 527f6dc 的运行时代码差异是 provider 接入 thinking 设置和新增 thinking.ts。工具/媒体导致 token 估算偏大的修复已存在于上次基线，不需要服务器改协议。版本及 VSIX 流程仅影响官方发布。

## 历史故障：未消费流被提前关闭

早期插件在 chat 响应到达后先执行本地 /api/ps 检查，再消费响应体；ollama-js 对未读取 body 的引用不足可能使 GC 关闭连接，最终抛出 Did not receive done or success response in stream。官方客户端后来已修复响应生命周期。

mollama 的代理模型本来就是远程服务，继续返回 remote_host，避免本地机器上下文检查。流必须以 done 块结束，但不能把所有缺少 done 的错误都归因于服务器漏发终止块，也不能用假成功吞掉真实上游错误。
