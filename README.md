# mollama

[中文文档](README.zh-CN.md)

Current version: `0.2.13`. The final version component tracks the Ollama VS Code extension release covered by this project's compatibility updates (currently `0.0.13`), not the Ollama server version.

Expose remote OpenAI-compatible model APIs as an Ollama service for clients such as the Ollama VS Code extension. Supports multiple providers, streaming, tools, images, and per-model thinking controls. Capabilities depend on the upstream model.

## Quick start

Requires Node.js 20+ and npm. Run commands from the repository root.

```sh
npm ci
npm run build
```

Configure these files before starting:

- `config/system.json`: listening address, port, frontend rules, and logging.
- `config/models.json`: provider endpoints, key references, models, and proxy settings. Remove unused providers and their models.

The example uses `env:` references. In PowerShell, set the keys needed by retained providers:

```powershell
$env:DEEPSEEK_API_KEY = "your-key"
$env:KIMI_FOR_CODING_API_KEY = "your-key"
$env:KIMI_API_KEY = "your-key"
$env:MIMO_API_KEY = "your-key"
# Optional outbound proxy referenced by the example configuration
$env:HTTPS_PROXY = "http://127.0.0.1:7890"
```

On Linux/macOS, use `export NAME="value"`. The service does not automatically load `.env` files. Never commit real keys.

```sh
npm run validate-config
npm start
```

Set your client's Ollama endpoint to `http://127.0.0.1:11434`. Config validation and `/api/tags` discovery do not run inference; chat calls the upstream API.

## start: run the service

```sh
npm start
npm start -- --config config/system.json
node dist/cli.js start --config /absolute/path/system.json
```

| Option / behavior | Details |
| --- | --- |
| `--config <path>` | System config path, default `config/system.json`; relative to the working directory. Quote paths containing spaces |
| `modelsConfigPath` | Model config path in the system config; relative to the system config's directory |
| Address / port | Set `server.host` / `server.port`; there are no `--host` or `--port` flags |
| Build | `npm start` runs `dist/cli.js` without compiling; run `npm run build` after source changes |
| Stop | Press `Ctrl+C` in the foreground; graceful shutdown waits up to 30 seconds |

The npm `--` separator forwards arguments to the program. The example listens on localhost; add access controls and TLS before exposing it publicly.

Other CLI commands:

```sh
node dist/cli.js --help
npm run validate-config -- --config config/system.json
node dist/cli.js init ./my-instance
node dist/cli.js start --config ./my-instance/config/system.json
```

`init` creates minimal configuration that still needs provider details. `validate-config` checks configuration without starting the server or verifying upstream credentials.

## test: automated tests

```sh
npm test
```

Builds the project and runs Node.js tests using local mock servers. No real API keys or model tokens are needed. Local port binding and connections must be allowed.

For individual files or filtered runs, put Node test options before file paths:

```sh
npm run build
# One file
node --test test/upstream-transport.test.js
# Filter test names using a regular expression
node --test --test-name-pattern="DeepSeek" test/thinking-policy.test.js
# Select a reporter
node --test --test-reporter=spec test/integration.test.js
# Explicit full suite, avoiding glob differences in older Node versions / shells
node --test test/integration.test.js test/models-config.test.js test/thinking-policy.test.js test/upstream-transport.test.js
```

| File | Coverage |
| --- | --- |
| `integration.test.js` | Protocol conversion, streaming, tools, and disconnections |
| `models-config.test.js` | Repository model configuration constraints |
| `thinking-policy.test.js` | Thinking levels, defaults, legacy aliases, and output budgets |
| `upstream-transport.test.js` | Direct / proxy connections, response and idle timeouts, retries |

## Real-model test environment

Unlike `npm test`, these scripts copy and run a separate service. Chat requests use real credentials and consume provider quota.

```powershell
# Optional; both scripts default to C:\tmp\mollama
$env:MOLLAMA_TEST_ROOT = "D:\mollama-test"
npm run sync:test-env
# Fill in D:\mollama-test\api-key\keys.txt
npm run sync:test-env
npm run start:test-env
```

- `sync:test-env` builds and copies code and configuration, installs runtime dependencies if the target dependency directory is missing, injects keys, and validates. Initial validation may fail after creating an empty key template; fill it in and rerun.
- **Every sync deletes and recreates the target `dist` and `config` directories. Target configuration edits are not preserved.** `api-key/keys.txt` survives; its keys are written into the target `config/models.json`. Protect both files. Never use the repository or a production directory as the test root.
- Prefer named key entries matching `env:` references, such as `DEEPSEEK_API_KEY=...`.
- `start:test-env` runs copied code with the target `config/system.json`. It does not build, sync, or forward CLI arguments. Both scripts use `MOLLAMA_TEST_ROOT` to select the directory.
- The default port remains `11434`. If occupied, edit the target system config before starting; the next sync overwrites that change. Stop and restart a running test service manually after updates.

## Documentation

- [Configuration reference](docs/configuration-reference.md)
- [API differences](docs/api-difference.md)
- [Ollama VS Code integration](docs/ollama-vscode-integration.md)
- [Thinking levels and migration](docs/thinking-levels.md)
- [Copilot Chat integration](docs/copilot-chat-integration.md)

## License

MIT
