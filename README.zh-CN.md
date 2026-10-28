# mollama

[English](README.md)

当前版本：`0.2.14`。末段版本号与已同步适配的 Ollama VS Code 插件保持一致（当前为 `0.0.14`），不代表 Ollama 服务端版本。

将远程 OpenAI 兼容模型接口转换为 Ollama 服务，供 Ollama VS Code 插件等客户端使用。支持多提供商、流式响应、工具、图片和按模型配置的思考档位，具体能力取决于上游模型。

## 快速开始

需要 Node.js 20+ 和 npm。以下命令在仓库根目录执行。

```sh
npm ci
npm run build
```

启动前编辑配置：

- `config/system.json`：监听地址、端口、前端规则和日志。
- `config/models.json`：提供商地址、密钥引用、模型和代理。按需删去不用的提供商及关联模型。

示例配置通过 `env:` 引用环境变量。在 PowerShell 中设置保留的提供商所需的密钥：

```powershell
$env:DEEPSEEK_API_KEY = "你的密钥"
$env:KIMI_FOR_CODING_API_KEY = "你的密钥"
$env:KIMI_API_KEY = "你的密钥"
$env:MIMO_API_KEY = "你的密钥"
# 可选：示例配置通过此变量设置出站代理
$env:HTTPS_PROXY = "http://127.0.0.1:7890"
```

Linux/macOS 使用 `export 变量名="值"`。服务不会自动加载 `.env` 文件；不要将真实密钥提交到仓库。

```sh
npm run validate-config
npm start
```

将客户端的 Ollama 地址设为 `http://127.0.0.1:11434`。配置验证和查询 `/api/tags` 不发起推理，实际聊天会调用上游 API。

## start：启动服务

```sh
npm start
npm start -- --config config/system.json
node dist/cli.js start --config /absolute/path/system.json
```

| 参数 / 行为 | 说明 |
| --- | --- |
| `--config <path>` | 系统配置路径，默认 `config/system.json`；相对路径以工作目录为基准，含空格时加引号 |
| `modelsConfigPath` | 系统配置中的模型配置路径，相对路径以系统配置文件所在目录为基准 |
| 地址 / 端口 | 修改 `server.host` / `server.port`；没有 `--host`、`--port` 参数 |
| 构建 | `npm start` 直接运行 `dist/cli.js`，不会自动编译；修改源码后先运行 `npm run build` |
| 停止 | 前台运行时按 `Ctrl+C`，优雅关闭最长等待 30 秒 |

npm 的 `--` 用于将参数传给启动程序。示例仅监听本机，向外网开放前应配置访问控制和 TLS。

其他 CLI 命令：

```sh
node dist/cli.js --help
npm run validate-config -- --config config/system.json
node dist/cli.js init ./my-instance
node dist/cli.js start --config ./my-instance/config/system.json
```

`init` 创建最小配置，仍需填写提供商信息；`validate-config` 只检查配置，不启动服务，也不验证上游密钥是否有效。

## test：自动化测试

```sh
npm test
```

先编译，再运行 Node.js 测试。测试使用本地模拟服务，不需要真实密钥，不消耗模型 token，但需要允许监听和连接本机端口。

指定文件或筛选用例时，直接使用 Node 测试参数，放在文件路径之前：

```sh
npm run build
# 单个文件
node --test test/upstream-transport.test.js
# 按测试名称筛选，支持正则表达式
node --test --test-name-pattern="DeepSeek" test/thinking-policy.test.js
# 指定输出格式
node --test --test-reporter=spec test/integration.test.js
# 显式列出全部文件，避免旧 Node / shell 的通配符兼容问题
node --test test/integration.test.js test/models-config.test.js test/thinking-policy.test.js test/upstream-transport.test.js
```

| 文件 | 覆盖内容 |
| --- | --- |
| `integration.test.js` | 协议转换、流式响应、工具和断连 |
| `models-config.test.js` | 仓库模型配置约束 |
| `thinking-policy.test.js` | 思考档位、默认值、旧别名和输出预算 |
| `upstream-transport.test.js` | 直连 / 代理、响应及空闲超时、重试 |

## 真实模型测试环境

这与 `npm test` 不同：复制并启动独立服务，客户端发起聊天时会使用真实密钥并消耗额度。

```powershell
# 可选；两个脚本默认使用 C:\tmp\mollama
$env:MOLLAMA_TEST_ROOT = "D:\mollama-test"
npm run sync:test-env
# 编辑 D:\mollama-test\api-key\keys.txt，填写生成的密钥条目
npm run sync:test-env
npm run start:test-env
```

- `sync:test-env`：编译、复制代码和配置，缺少目标依赖目录时安装运行依赖，再注入密钥并验证。首次生成空密钥模板后验证可能失败，填写后重跑即可。
- **每次同步都会删除并重建目标 `dist` 和 `config`，不保留目标配置修改。** `api-key/keys.txt` 会保留，密钥会写入目标 `config/models.json`，请保护这两个文件。不要将测试根目录设为仓库或生产目录。
- 密钥推荐使用 `DEEPSEEK_API_KEY=...` 等与 `env:` 引用一致的名称。
- `start:test-env` 启动已复制的代码，使用目标 `config/system.json`；不构建、不同步、不透传命令行参数。两个脚本均通过 `MOLLAMA_TEST_ROOT` 选择目录。
- 默认端口仍为 `11434`。冲突时修改目标系统配置后启动，再次同步会覆盖该修改。更新运行中的测试服务需手动停止并重启。

## 详细文档

- [配置参考](docs/configuration-reference.md)
- [API 差异](docs/api-difference.md)
- [Ollama VS Code 插件接入](docs/ollama-vscode-integration.md)
- [思考档位与迁移](docs/thinking-levels.md)
- [Copilot Chat 接入](docs/copilot-chat-integration.md)

## 许可证

MIT
