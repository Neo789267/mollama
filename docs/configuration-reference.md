# Configuration Reference

mollama uses two JSON configuration files:

| File | Purpose |
|------|---------|
| **system.json** | Server, Ollama compatibility, frontend profiles, logging |
| **models.json** | Global proxy, request defaults, provider upstreams, model catalog |

The system config path defaults to `config/system.json` and can be overridden with `--config <path>`. The models config path is resolved relative to the system config directory via `modelsConfigPath`.

---

## Table of Contents

- [Quick Start](#quick-start)
- [system.json — Full Schema](#systemjson--full-schema)
  - [server](#server)
  - [ollama](#ollama)
  - [frontends](#frontends)
  - [modelsConfigPath](#modelsconfigpath)
  - [logging](#logging)
- [models.json — Full Schema](#modelsjson--full-schema)
  - [proxyUrl (Global)](#proxyurl-global)
  - [defaults](#defaults)
  - [providers](#providers)
    - [upstream](#upstream)
    - [models](#models)
- [Parameter Merge Order](#parameter-merge-order)
- [Secret Resolution](#secret-resolution)
- [Proxy Configuration](#proxy-configuration)
- [Frontend Profile Behavior](#frontend-profile-behavior)
- [Thinking Mode & Reasoning History](#thinking-mode--reasoning-history)
- [Complete Examples](#complete-examples)

---

## Quick Start

```bash
# Install
cd mollama
npm install
npm run build

# Generate default config files in ./config/
mollama init

# Validate config without starting the server
mollama validate-config

# Start with default config
mollama start

# Start with a specific config file
mollama start --config /path/to/system.json
```

---

## system.json — Full Schema

```jsonc
{
  "server": { ... },
  "ollama": { ... },
  "frontends": { ... },
  "modelsConfigPath": "./models.json",
  "logging": { ... }
}
```

### server

Controls the local HTTP server.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `host` | `string` | ✅ | Bind address. Use `"127.0.0.1"` for local-only, `"0.0.0.0"` for all interfaces. |
| `port` | `number` | ✅ | Listen port. Default Ollama port is `11434`. |

```json
{
  "server": {
    "host": "127.0.0.1",
    "port": 11434
  }
}
```

### ollama

Controls the compatibility metadata that `mollama` reports on Ollama discovery endpoints.

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `version` | `string` | ❌ | `"0.6.4"` | Version returned by `GET /api/version`. Set this to the Ollama version your client expects. |

```json
{
  "ollama": {
    "version": "0.6.4"
  }
}
```

### frontends

A map of named frontend profiles. Each profile can customize request behavior for different client applications (e.g., GitHub Copilot, OpenCode).

Frontend profile selection is **automatic** — `mollama` matches the incoming request's `User-Agent` header against each profile's `userAgentPattern`. The first match wins.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `userAgentPattern` | `string` | ❌ | Substring to match against the `User-Agent` header. |
| `requestDefaults` | `object` | ❌ | Default request parameters merged before the client payload. |
| `payloadOverrides` | `object` | ❌ | Parameters merged **after** the client payload (force-overrides). |
| `messages` | `array` | ❌ | Prompt messages injected into every request. |
| `toolGuidance` | `array` | ❌ | Description suffixes appended to tool definitions. |

#### requestDefaults vs payloadOverrides

- **`requestDefaults`**: Merged **before** the client's request payload. The client can override these values.
- **`payloadOverrides`**: Merged **after** the client's request payload. These **force-overwrite** client values.

Both accept any valid JSON object with OpenAI-compatible parameters (`stream`, `temperature`, `top_p`, `max_tokens`, etc.).

#### messages

Each message is injected into the request's message array (after existing system messages, before non-system messages). Duplicate content is deduplicated.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `role` | `"system"` \| `"user"` | ✅ | Message role. |
| `content` | `string` | ✅ | Message content. |

#### toolGuidance

Appends description text to matching tool definitions in the request.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `target` | `"all-tools"` \| `"file-tools"` \| `"tool-names"` | ✅ | Which tools to match. |
| `toolNames` | `string[]` | When `target` is `"tool-names"` | Specific tool names to match. |
| `descriptionSuffix` | `string` | ✅ | Text appended to the tool's description. |

**Target values:**

| Target | Matches |
|--------|---------|
| `"all-tools"` | Every tool in the request. |
| `"file-tools"` | Tools whose names suggest file mutation (contain patterns like `create`+`file`, `edit`+`file`, `patch`, etc.). |
| `"tool-names"` | Only tools listed in `toolNames`. |

```json
{
  "frontends": {
    "copilot": {
      "userAgentPattern": "GitHubCopilotChat",
      "payloadOverrides": {
        "max_tokens": 16384
      },
      "messages": [
        {
          "role": "system",
          "content": "This frontend is sensitive to large file-edit tool calls. Prefer one file per tool call."
        }
      ],
      "toolGuidance": [
        {
          "target": "file-tools",
          "descriptionSuffix": "This frontend accepts file updates most reliably when each tool call changes a single file."
        }
      ]
    },
    "opencode": {
      "requestDefaults": {
        "max_tokens": 16384
      },
      "messages": [
        {
          "role": "system",
          "content": "Keep file creation and edit tool calls incremental."
        }
      ]
    }
  }
}
```

### modelsConfigPath

| Type | Required | Description |
|------|----------|-------------|
| `string` | ✅ | Path to the models config file. Resolved relative to the system config directory. |

```json
{
  "modelsConfigPath": "./models.json"
}
```

### logging

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `level` | `"silent"` \| `"error"` \| `"info"` \| `"debug"` | ✅ | — | Log verbosity level. |
| `logRequests` | `boolean` | ❌ | `false` | Whether to log incoming HTTP requests. |
| `redactHeaders` | `string[]` | ❌ | `[]` | Header names whose values are replaced with `[REDACTED]` in request logs. |

```json
{
  "logging": {
    "level": "info",
    "logRequests": false,
    "redactHeaders": ["authorization", "api-key"]
  }
}
```

**Log levels:**

| Level | Description |
|-------|-------------|
| `silent` | No output. |
| `error` | Only errors. |
| `info` | Startup info, request summaries, errors. |
| `debug` | Full request/response details (verbose). |

---

## models.json — Full Schema

```jsonc
{
  "proxyUrl": "...",
  "defaults": { ... },
  "providers": { ... }
}
```

### proxyUrl (Global)

| Type | Required | Default | Description |
|------|----------|---------|-------------|
| `string` | ❌ | — | Global HTTP/HTTPS proxy URL applied to all providers that do not define their own `proxyUrl`. Supports `env:VAR_NAME` syntax. |

This is the **fallback** proxy. If a provider's `upstream.proxyUrl` is set, it takes priority. See [Proxy Configuration](#proxy-configuration) for details.

```json
{
  "proxyUrl": "env:HTTPS_PROXY"
}
```

### defaults

Global default parameters applied to **every** model request before model-specific and frontend-specific values. Accepts any valid OpenAI-compatible JSON parameters.

> **Important:** `defaults` is a **request parameter template** — every field here is merged into the HTTP request body sent to the upstream API. Do not put non-API fields (like `proxyUrl`) here.

| Common Field | Type | Description |
|-------------|------|-------------|
| `stream` | `boolean` | Whether to stream responses. |
| `temperature` | `number` | Sampling temperature (0–2). |
| `top_p` | `number` | Nucleus sampling threshold. |
| `max_tokens` | `number` | Default max output tokens. |
| `frequency_penalty` | `number` | Frequency penalty (-2 to 2). |
| `presence_penalty` | `number` | Presence penalty (-2 to 2). |

```json
{
  "defaults": {
    "stream": true,
    "temperature": 0.2,
    "top_p": 0.95,
    "max_tokens": 4096
  }
}
```

### providers

A map of named upstream providers. Each key is a provider name referenced by models. At least one provider is required.

Each provider contains an `upstream` configuration and a `models` array.

```json
{
  "providers": {
    "deepseek": {
      "upstream": { ... },
      "models": [ ... ]
    },
    "kimi": {
      "upstream": { ... },
      "models": [ ... ]
    }
  }
}
```

#### upstream

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `baseUrl` | `string` | ✅ | Upstream API base URL (no trailing slash). |
| `apiKey` | `string` | ❌ | API key. Supports `env:VAR_NAME` syntax to read from environment variables. |
| `proxyUrl` | `string` | ❌ | HTTP/HTTPS proxy URL for this provider. Supports `env:VAR_NAME` syntax. Overrides the global `proxyUrl`. |
| `timeoutMs` | `number` | ✅ | Request timeout in milliseconds. |
| `retry` | `object` | ❌ | Retry configuration (see below). |
| `headers` | `object` | ❌ | Extra headers sent with every request to this provider. |

##### retry

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `attempts` | `number` | ✅ | `0` | Max retry attempts (non-negative integer). `0` = no retries. |
| `backoffMs` | `number` | ✅ | `0` | Delay between retries in milliseconds. |
| `retryOnStatusCodes` | `number[]` | ❌ | `[429, 500, 502, 503, 504]` | HTTP status codes that trigger a retry. |

```json
{
  "upstream": {
    "baseUrl": "https://api.deepseek.com",
    "apiKey": "env:DEEPSEEK_API_KEY",
    "proxyUrl": "env:HTTPS_PROXY",
    "timeoutMs": 60000,
    "retry": {
      "attempts": 1,
      "backoffMs": 150,
      "retryOnStatusCodes": [429, 500, 502, 503, 504]
    },
    "headers": {}
  }
}
```

> **Note on `headers`**: If you set an `api-key` header in `headers`, the resolved `apiKey` value will be sent via that header name instead of the default `Authorization: Bearer` scheme. This is useful for providers like MiMo that use `api-key` authentication.

#### models

An array of model definitions under each provider. At least one model per provider is required.

##### Model Definition

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | ✅ | Unique model identifier. Used for lookup by clients. |
| `displayName` | `string` | ❌ | Human-readable name shown in Ollama discovery APIs. Defaults to `id`. |
| `targetModel` | `string` | ✅ | The actual model ID sent to the upstream provider. |
| `contextWindow` | `number` | ✅ | Context window size in tokens. |
| `maxOutputTokens` | `number` | ✅ | Maximum output tokens. Used as default `max_tokens` and as a hard cap. |
| `supports` | `object` | ❌ | Capability flags (see below). |
| `parameters` | `object` | ❌ | Per-model parameters merged into every request for this model. |
| `payloadOverrides` | `object` | ❌ | Parameters force-applied after the client payload. |
| `payloadOverridesByThinking` | `object` | ❌ | Conditional overrides based on thinking mode state. |
| `reasoningHistory` | `object` | ❌ | Explicit handling for historical assistant messages that are missing `reasoning_content`. |

##### supports

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `tools` | `boolean` | `false` | Whether the model supports tool/function calling. |
| `vision` | `boolean` | `false` | Whether the model supports image input. |

If a client sends a tool-calling request to a model with `tools: false`, or a vision request to a model with `vision: false`, the server returns a 400 error.

##### payloadOverridesByThinking

Conditional payload overrides that apply based on the `thinking.type` field in the request.

| Field | Type | Description |
|-------|------|-------------|
| `enabled` | `object` | Parameters applied when `thinking.type` is `"enabled"`. |
| `disabled` | `object` | Parameters applied when `thinking.type` is `"disabled"`. |

This is useful for providers like Kimi that require different `temperature` values depending on whether thinking is active.

```json
{
  "payloadOverridesByThinking": {
    "enabled": {
      "temperature": 1
    },
    "disabled": {
      "temperature": 0.6
    }
  }
}
```

##### Full Model Example

```json
{
  "id": "kimi-k2-6-local",
  "displayName": "Kimi K2.6",
  "targetModel": "kimi-k2.6",
  "contextWindow": 262144,
  "maxOutputTokens": 16384,
  "supports": {
    "tools": true,
    "vision": true
  },
  "parameters": {
    "thinking": {
      "type": "enabled"
    }
  },
  "payloadOverrides": {
    "top_p": 0.95,
    "n": 1,
    "presence_penalty": 0,
    "frequency_penalty": 0
  },
  "payloadOverridesByThinking": {
    "enabled": {
      "temperature": 1
    },
    "disabled": {
      "temperature": 0.6
    }
  },
  "reasoningHistory": {
    "mode": "none"
  }
}
```

---

## Parameter Merge Order

When a chat completion request arrives, parameters are merged in this order (later values overwrite earlier ones):

```
1. models.json "defaults"              (global defaults)
2. model "parameters"                  (per-model defaults)
3. frontend "requestDefaults"          (frontend defaults, client can override)
4. Client request payload              (what the client sent)
5. model "payloadOverrides"            (per-model force-overrides)
6. frontend "payloadOverrides"         (frontend force-overrides)
7. model.targetModel                   (always set to the upstream model ID)
```

After merging, if `max_tokens` is not set, it defaults to `model.maxOutputTokens`. Finally, `max_tokens` is clamped to not exceed `model.maxOutputTokens`.

After the merge order above, `mollama` applies the remaining thinking-specific compatibility logic in this order:

1. Normalize top-level `think: true | false` to `thinking.type: "enabled" | "disabled"` for models that support thinking controls.
2. Apply `reasoningHistory` handling to historical assistant messages.
3. Apply `payloadOverridesByThinking` based on the resolved `thinking.type` value.
4. Clamp `max_tokens` to `model.maxOutputTokens`.

---

## Secret Resolution

Any string value in `apiKey` or `proxyUrl` that starts with `env:` is resolved as an environment variable reference.

| Value | Resolution |
|-------|------------|
| `"env:OPENAI_API_KEY"` | Reads `process.env.OPENAI_API_KEY`. Fails if the variable is not set. |
| `"sk-abc123..."` | Used as-is (literal string). |
| `undefined` | Field is omitted. |

```json
{
  "apiKey": "env:DEEPSEEK_API_KEY",
  "proxyUrl": "env:HTTPS_PROXY"
}
```

---

## Proxy Configuration

mollama supports HTTP/HTTPS proxy routing for upstream requests. Proxy configuration operates at two levels with a clear priority rule:

```
provider.upstream.proxyUrl  >  models.proxyUrl (global)  >  no proxy
```

### Global Proxy

Set `proxyUrl` at the top level of `models.json` to apply a proxy to all providers that do not define their own:

```json
{
  "proxyUrl": "env:HTTPS_PROXY",
  "defaults": { "stream": true },
  "providers": {
    "deepseek": {
      "upstream": {
        "baseUrl": "https://api.deepseek.com",
        "apiKey": "env:DEEPSEEK_API_KEY"
      },
      "models": [...]
    }
  }
}
```

In this example, the `deepseek` provider has no `proxyUrl`, so it falls back to the global `env:HTTPS_PROXY`.

### Per-Provider Proxy

Set `proxyUrl` inside a provider's `upstream` to override the global proxy for that specific provider:

```json
{
  "proxyUrl": "env:HTTPS_PROXY",
  "defaults": { "stream": true },
  "providers": {
    "deepseek": {
      "upstream": {
        "baseUrl": "https://api.deepseek.com",
        "apiKey": "env:DEEPSEEK_API_KEY",
        "proxyUrl": "http://127.0.0.1:7890"
      },
      "models": [...]
    },
    "kimi": {
      "upstream": {
        "baseUrl": "https://api.moonshot.cn/v1",
        "apiKey": "env:KIMI_API_KEY"
      },
      "models": [...]
    }
  }
}
```

In this example:
- **deepseek** → uses its own `http://127.0.0.1:7890` (per-provider takes priority)
- **kimi** → no `proxyUrl` set, falls back to global `env:HTTPS_PROXY`

### No Proxy

If neither the global nor the provider-level `proxyUrl` is set, requests go directly to the upstream API without any proxy.

---

## Frontend Profile Behavior

When a request arrives, `mollama` automatically selects a frontend profile by matching the `User-Agent` header against each profile's `userAgentPattern`. The first match wins.

The active profile affects every chat completion request:

1. **`requestDefaults`** — merged as low-priority defaults (step 3 in merge order).
2. **`payloadOverrides`** — merged as high-priority overrides (step 6 in merge order).
3. **`messages`** — injected into the request's message array. Inserted after existing system messages, before non-system messages. Duplicate content is skipped.
4. **`toolGuidance`** — appends `descriptionSuffix` to matching tool definitions. Deduplicated at the paragraph level.

If no profile matches, no frontend-specific behavior is applied.

---

## Thinking Mode & Reasoning History

Some models (e.g., DeepSeek, Kimi, MiMo) support a `thinking` parameter that enables chain-of-thought reasoning.

### Client compatibility aliases

`mollama` preserves provider-native thinking fields while also bridging Ollama-style clients:

- Incoming top-level `think: true | false` is normalized to provider-native `thinking.type`.
- Historical assistant messages that contain `thinking` but not `reasoning_content` are replayed upstream with `reasoning_content` so providers like DeepSeek can keep multi-turn reasoning enabled.
- Upstream chat-completion responses that contain `reasoning_content` are mirrored back as `thinking` in both text and SSE responses so Ollama-oriented clients can display the reasoning trace without losing the original provider field.

### reasoningHistory

When `reasoningHistory` is configured on a model, `mollama` keeps the configured `thinking` mode and applies one of these explicit behaviors if historical assistant messages are missing `reasoning_content`:

- `none` (default): forward the request unchanged.
- `inject-empty`: add `reasoning_content: ""` to historical assistant messages that are missing the field.
- `require-present`: reject the request with a 400 `missing_reasoning_content` error.

This makes provider-specific compatibility handling explicit and avoids silent thinking downgrades.

### payloadOverridesByThinking

Allows different parameter values depending on whether thinking is enabled or disabled in the current request. See [payloadOverridesByThinking](#payloadoverridesbythinking) above.

---

## Complete Examples

### Minimal Single-Provider Setup

**system.json:**
```json
{
  "server": {
    "host": "127.0.0.1",
    "port": 11434
  },
  "ollama": {
    "version": "0.6.4"
  },
  "modelsConfigPath": "./models.json",
  "logging": {
    "level": "info",
    "logRequests": false,
    "redactHeaders": ["authorization"]
  }
}
```

**models.json:**
```json
{
  "defaults": {
    "stream": true,
    "temperature": 0.2,
    "max_tokens": 4096
  },
  "providers": {
    "openai": {
      "upstream": {
        "baseUrl": "https://api.openai.com/v1",
        "apiKey": "env:OPENAI_API_KEY",
        "timeoutMs": 60000,
        "retry": {
          "attempts": 0,
          "backoffMs": 0,
          "retryOnStatusCodes": [429, 500, 502, 503, 504]
        },
        "headers": {}
      },
      "models": [
        {
          "id": "gpt-4.1-local",
          "displayName": "GPT-4.1 Local Proxy",
          "targetModel": "gpt-4.1",
          "contextWindow": 128000,
          "maxOutputTokens": 4096,
          "supports": {
            "tools": true,
            "vision": true
          }
        }
      ]
    }
  }
}
```

### Multi-Provider with Global Proxy

**models.json:**
```json
{
  "proxyUrl": "env:HTTPS_PROXY",
  "defaults": {
    "stream": true
  },
  "providers": {
    "deepseek": {
      "upstream": {
        "baseUrl": "https://api.deepseek.com",
        "apiKey": "env:DEEPSEEK_API_KEY",
        "timeoutMs": 60000,
        "retry": {
          "attempts": 1,
          "backoffMs": 150,
          "retryOnStatusCodes": [429, 500, 502, 503, 504]
        },
        "headers": {}
      },
      "models": [
        {
          "id": "deepseek-v4-flash-local",
          "displayName": "DeepSeek V4 Flash",
          "targetModel": "deepseek-v4-flash",
          "contextWindow": 1000000,
          "maxOutputTokens": 384000,
          "supports": {
            "tools": true,
            "vision": false
          },
          "parameters": {
            "thinking": {
              "type": "enabled"
            },
            "reasoning_effort": "max"
          },
          "reasoningHistory": {
            "mode": "inject-empty"
          },
          "payloadOverrides": {},
          "payloadOverridesByThinking": {}
        }
      ]
    },
    "kimi": {
      "upstream": {
        "baseUrl": "https://api.moonshot.cn/v1",
        "apiKey": "env:KIMI_API_KEY",
        "proxyUrl": "http://127.0.0.1:7890",
        "timeoutMs": 60000,
        "retry": {
          "attempts": 1,
          "backoffMs": 150,
          "retryOnStatusCodes": [429, 500, 502, 503, 504]
        },
        "headers": {}
      },
      "models": [
        {
          "id": "kimi-k2-6-local",
          "displayName": "Kimi K2.6",
          "targetModel": "kimi-k2.6",
          "contextWindow": 262144,
          "maxOutputTokens": 16384,
          "supports": {
            "tools": true,
            "vision": true
          },
          "parameters": {
            "thinking": {
              "type": "enabled"
            }
          },
          "payloadOverrides": {
            "top_p": 0.95,
            "n": 1,
            "presence_penalty": 0,
            "frequency_penalty": 0
          },
          "payloadOverridesByThinking": {
            "enabled": {
              "temperature": 1
            },
            "disabled": {
              "temperature": 0.6
            }
          },
          "reasoningHistory": {
            "mode": "none"
          }
        }
      ]
    }
  }
}
```

In this example:
- **deepseek** → uses the global `env:HTTPS_PROXY` (no per-provider `proxyUrl`)
- **kimi** → uses its own `http://127.0.0.1:7890` (per-provider overrides global)
