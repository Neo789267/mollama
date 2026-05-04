import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import type {
  AppConfig,
  FrontendMap,
  FrontendProfile,
  FrontendPromptMessage,
  FrontendPromptRole,
  FrontendToolGuidance,
  LoggingConfig,
  ModelDefinition,
  ModelDefinitionConfig,
  ModelProviderMap,
  ModelRequestDefaults,
  ModelsConfig,
  OllamaConfig,
  ReasoningHistoryConfig,
  ModelSupportFlags,
  RetryConfig,
  ServerConfig,
  SystemConfig,
  ThinkingStatePayloadOverrides,
  UpstreamConfig,
} from '../types';
import {
  assert,
  asString,
  asNumber,
  asBoolean,
  asStringArray,
  asNumberArray,
  asJsonRecord,
  isRecord,
} from '../guards';
import { validateModelReferences } from '../model-registry';

const DEFAULT_OLLAMA_VERSION = '0.6.4';

function readJsonFile(filePath: string): unknown {
  let content: string;
  try {
    content = readFileSync(filePath, 'utf8');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read config file ${filePath}: ${message}`);
  }

  try {
    return JSON.parse(content) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse JSON in ${filePath}: ${message}`);
  }
}

function loadOptionalArray<T>(value: unknown, fieldName: string, mapEntry: (entry: unknown, index: number) => T): T[] {
  if (value === undefined) {
    return [];
  }

  assert(Array.isArray(value), `${fieldName} must be an array`);
  return value.map(mapEntry);
}

function normalizeHeaders(value: unknown, fieldName: string): Record<string, string> {
  if (value === undefined) {
    return {};
  }

  assert(isRecord(value), `${fieldName} must be an object`);
  return Object.fromEntries(
    Object.entries(value).map(([key, headerValue]) => {
      assert(typeof headerValue === 'string', `${fieldName}.${key} must be a string`);
      return [key, headerValue];
    }),
  );
}

function normalizeProxyUrl(value: string | undefined, fieldName: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const proxyUrl = value.replace(/\/+$/, '');
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(proxyUrl);
  } catch {
    throw new Error(`${fieldName} must be a valid URL`);
  }

  assert(parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:', `${fieldName} must use http or https`);
  return proxyUrl;
}

function loadRetryConfig(value: unknown, fieldName: string): RetryConfig {
  if (value === undefined) {
    return {
      attempts: 0,
      backoffMs: 0,
      retryOnStatusCodes: [429, 500, 502, 503, 504],
    };
  }

  assert(isRecord(value), `${fieldName} must be an object`);
  const attempts = asNumber(value.attempts, `${fieldName}.attempts`);
  const backoffMs = asNumber(value.backoffMs, `${fieldName}.backoffMs`);
  const retryOnStatusCodes = value.retryOnStatusCodes === undefined
    ? [429, 500, 502, 503, 504]
    : asNumberArray(value.retryOnStatusCodes, `${fieldName}.retryOnStatusCodes`);

  assert(Number.isInteger(attempts) && attempts >= 0, `${fieldName}.attempts must be a non-negative integer`);
  assert(Number.isInteger(backoffMs) && backoffMs >= 0, `${fieldName}.backoffMs must be a non-negative integer`);
  assert(
    retryOnStatusCodes.every((statusCode) => Number.isInteger(statusCode) && statusCode >= 100 && statusCode <= 599),
    `${fieldName}.retryOnStatusCodes must contain valid HTTP status codes`,
  );

  return { attempts, backoffMs, retryOnStatusCodes };
}

function loadServerConfig(value: unknown): ServerConfig {
  assert(isRecord(value), 'server must be an object');
  return {
    host: asString(value.host, 'server.host'),
    port: asNumber(value.port, 'server.port'),
  };
}

function loadOllamaConfig(value: unknown): OllamaConfig {
  if (value === undefined) {
    return { version: DEFAULT_OLLAMA_VERSION };
  }

  assert(isRecord(value), 'ollama must be an object');
  return {
    version: asString(value.version, 'ollama.version'),
  };
}

function loadUpstreamConfig(value: unknown, fieldName: string, globalProxyUrl?: string): UpstreamConfig {
  assert(isRecord(value), `${fieldName} must be an object`);
  const apiKey = value.apiKey === undefined ? undefined : asString(value.apiKey, `${fieldName}.apiKey`);
  const proxyUrl = value.proxyUrl === undefined
    ? globalProxyUrl
    : asString(value.proxyUrl, `${fieldName}.proxyUrl`);
  return {
    baseUrl: asString(value.baseUrl, `${fieldName}.baseUrl`).replace(/\/+$/, ''),
    apiKey,
    proxyUrl,
    timeoutMs: asNumber(value.timeoutMs, `${fieldName}.timeoutMs`),
    retry: loadRetryConfig(value.retry, `${fieldName}.retry`),
    headers: normalizeHeaders(value.headers, `${fieldName}.headers`),
  };
}

function loadLoggingConfig(value: unknown): LoggingConfig {
  assert(isRecord(value), 'logging must be an object');
  const level = asString(value.level, 'logging.level');
  assert(['silent', 'error', 'info', 'debug'].includes(level), 'logging.level must be one of silent, error, info, debug');
  return {
    level: level as LoggingConfig['level'],
    logRequests: value.logRequests === undefined ? false : asBoolean(value.logRequests, 'logging.logRequests'),
    redactHeaders: value.redactHeaders === undefined ? [] : asStringArray(value.redactHeaders, 'logging.redactHeaders'),
  };
}

function loadFrontendPromptMessage(value: unknown, fieldName: string): FrontendPromptMessage {
  assert(isRecord(value), `${fieldName} must be an object`);
  const role = asString(value.role, `${fieldName}.role`);
  assert(role === 'system' || role === 'user', `${fieldName}.role must be one of system or user`);
  return {
    role: role as FrontendPromptRole,
    content: asString(value.content, `${fieldName}.content`),
  };
}

function loadFrontendToolGuidance(value: unknown, fieldName: string): FrontendToolGuidance {
  assert(isRecord(value), `${fieldName} must be an object`);
  const target = asString(value.target, `${fieldName}.target`);
  assert(
    target === 'all-tools' || target === 'file-tools' || target === 'tool-names',
    `${fieldName}.target must be one of all-tools, file-tools, tool-names`,
  );

  const toolNames = value.toolNames === undefined ? undefined : asStringArray(value.toolNames, `${fieldName}.toolNames`);
  if (target === 'tool-names') {
    assert(toolNames !== undefined && toolNames.length > 0, `${fieldName}.toolNames must be provided when target is tool-names`);
  } else {
    assert(toolNames === undefined, `${fieldName}.toolNames is only supported when target is tool-names`);
  }

  return {
    target,
    toolNames,
    descriptionSuffix: asString(value.descriptionSuffix, `${fieldName}.descriptionSuffix`),
  };
}

function loadFrontendProfile(value: unknown, fieldName: string): FrontendProfile {
  assert(isRecord(value), `${fieldName} must be an object`);
  const userAgentPattern = value.userAgentPattern === undefined
    ? undefined
    : asString(value.userAgentPattern, `${fieldName}.userAgentPattern`);
  const requestDefaults = value.requestDefaults === undefined
    ? {}
    : asJsonRecord(value.requestDefaults, `${fieldName}.requestDefaults`);

  const payloadOverrides = value.payloadOverrides === undefined
    ? {}
    : asJsonRecord(value.payloadOverrides, `${fieldName}.payloadOverrides`);

  const messages = loadOptionalArray(
    value.messages,
    `${fieldName}.messages`,
    (message, index) => loadFrontendPromptMessage(message, `${fieldName}.messages[${index}]`),
  );

  const toolGuidance = loadOptionalArray(
    value.toolGuidance,
    `${fieldName}.toolGuidance`,
    (guidance, index) => loadFrontendToolGuidance(guidance, `${fieldName}.toolGuidance[${index}]`),
  );

  return {
    userAgentPattern,
    requestDefaults,
    payloadOverrides,
    messages,
    toolGuidance,
  };
}

function loadFrontendMap(value: unknown, fieldName: string): FrontendMap {
  if (value === undefined) {
    return {};
  }

  assert(isRecord(value), `${fieldName} must be an object`);
  return Object.fromEntries(Object.entries(value).map(([frontendName, frontendValue]) => {
    assert(frontendName.length > 0, `${fieldName} keys must be non-empty strings`);
    return [frontendName, loadFrontendProfile(frontendValue, `${fieldName}.${frontendName}`)];
  }));
}

function loadSystemConfig(value: unknown): SystemConfig {
  assert(isRecord(value), 'system config root must be an object');
  assert(value.upstream === undefined && value.upstreams === undefined, 'Move upstream provider config into models.json providers.*.upstream');
  assert(value.defaultProvider === undefined, 'defaultProvider has been removed; define models under providers in models.json');
  assert(value.activeFrontend === undefined, 'activeFrontend has been removed; frontend is now selected automatically via user-agent header');

  return {
    server: loadServerConfig(value.server),
    ollama: loadOllamaConfig(value.ollama),
    modelsConfigPath: asString(value.modelsConfigPath, 'modelsConfigPath'),
    logging: loadLoggingConfig(value.logging),
    frontends: loadFrontendMap(value.frontends, 'frontends'),
  };
}

function loadModelDefaults(value: unknown): ModelRequestDefaults {
  if (value === undefined) {
    return {};
  }
  return asJsonRecord(value, 'defaults');
}

function loadThinkingStatePayloadOverrides(value: unknown, fieldName: string): ThinkingStatePayloadOverrides {
  if (value === undefined) {
    return {};
  }

  assert(isRecord(value), `${fieldName} must be an object`);
  return {
    enabled: value.enabled === undefined ? undefined : asJsonRecord(value.enabled, `${fieldName}.enabled`),
    disabled: value.disabled === undefined ? undefined : asJsonRecord(value.disabled, `${fieldName}.disabled`),
  };
}

function loadReasoningHistory(value: unknown, fieldName: string): ReasoningHistoryConfig {
  if (value === undefined) {
    return { mode: 'none' };
  }

  assert(isRecord(value), `${fieldName} must be an object`);
  const rawMode = value.mode === undefined ? 'none' : asString(value.mode, `${fieldName}.mode`);
  assert(
    rawMode === 'none' || rawMode === 'inject-empty' || rawMode === 'require-present',
    `${fieldName}.mode must be one of: none, inject-empty, require-present`,
  );
  return { mode: rawMode };
}

function loadSupportFlags(value: unknown, fieldName: string): ModelSupportFlags {
  if (value === undefined) {
    return { tools: false, vision: false };
  }

  assert(isRecord(value), `${fieldName} must be an object`);
  return {
    tools: value.tools === undefined ? false : asBoolean(value.tools, `${fieldName}.tools`),
    vision: value.vision === undefined ? false : asBoolean(value.vision, `${fieldName}.vision`),
  };
}

function loadModelDefinitionConfig(value: unknown, fieldName: string): ModelDefinitionConfig {
  assert(isRecord(value), `${fieldName} must be an object`);
  assert(
    value.requiresReasoningReplay === undefined,
    `${fieldName}.requiresReasoningReplay has been removed; use ${fieldName}.reasoningHistory.mode instead`,
  );

  return {
    id: asString(value.id, `${fieldName}.id`),
    displayName: value.displayName === undefined ? asString(value.id, `${fieldName}.id`) : asString(value.displayName, `${fieldName}.displayName`),
    targetModel: asString(value.targetModel, `${fieldName}.targetModel`),
    contextWindow: asNumber(value.contextWindow, `${fieldName}.contextWindow`),
    maxOutputTokens: asNumber(value.maxOutputTokens, `${fieldName}.maxOutputTokens`),
    supports: loadSupportFlags(value.supports, `${fieldName}.supports`),
    parameters: value.parameters === undefined ? {} : asJsonRecord(value.parameters, `${fieldName}.parameters`),
    payloadOverrides: value.payloadOverrides === undefined ? {} : asJsonRecord(value.payloadOverrides, `${fieldName}.payloadOverrides`),
    payloadOverridesByThinking: loadThinkingStatePayloadOverrides(value.payloadOverridesByThinking, `${fieldName}.payloadOverridesByThinking`),
    reasoningHistory: loadReasoningHistory(value.reasoningHistory, `${fieldName}.reasoningHistory`),
  };
}

function loadProviderMap(value: unknown, globalProxyUrl?: string): ModelProviderMap {
  assert(isRecord(value), 'providers must be an object');
  const entries = Object.entries(value);
  assert(entries.length > 0, 'providers must contain at least one provider');

  return Object.fromEntries(entries.map(([providerName, providerValue]) => {
    assert(providerName.length > 0, 'provider name must be non-empty');
    assert(isRecord(providerValue), `providers.${providerName} must be an object`);

    const models = loadOptionalArray(
      providerValue.models,
      `providers.${providerName}.models`,
      (entry, index) => loadModelDefinitionConfig(entry, `providers.${providerName}.models[${index}]`),
    );
    assert(models.length > 0, `providers.${providerName}.models must contain at least one model`);

    return [
      providerName,
      {
        upstream: loadUpstreamConfig(providerValue.upstream, `providers.${providerName}.upstream`, globalProxyUrl),
        models,
      },
    ];
  }));
}

function flattenProviderModels(providers: ModelProviderMap): ModelDefinition[] {
  const flattened: ModelDefinition[] = [];
  for (const [providerName, provider] of Object.entries(providers)) {
    for (const model of provider.models) {
      flattened.push({
        ...model,
        provider: providerName,
      });
    }
  }
  return flattened;
}

function loadModelsConfig(value: unknown): ModelsConfig {
  assert(isRecord(value), 'models config root must be an object');
  assert(value.models === undefined, 'Top-level models array has been replaced by providers.*.models');

  const globalProxyUrl = value.proxyUrl === undefined ? undefined : asString(value.proxyUrl, 'proxyUrl');
  const providers = loadProviderMap(value.providers, globalProxyUrl);
  const models = flattenProviderModels(providers);

  return {
    proxyUrl: globalProxyUrl,
    defaults: loadModelDefaults(value.defaults),
    providers,
    models,
  };
}

function resolveSecret(value: string | undefined): string | undefined {
  if (!value || !value.startsWith('env:')) {
    return value;
  }

  const envKey = value.slice(4);
  const envValue = process.env[envKey];
  assert(envValue, `Environment variable ${envKey} is not set`);
  return envValue;
}

export function resolveConfigPath(inputPath: string): string {
  return resolve(process.cwd(), inputPath);
}

export function loadAppConfig(systemConfigPathInput: string): AppConfig {
  const systemConfigPath = resolveConfigPath(systemConfigPathInput);
  const systemConfig = loadSystemConfig(readJsonFile(systemConfigPath));
  const systemDir = dirname(systemConfigPath);
  const modelsConfigPath = isAbsolute(systemConfig.modelsConfigPath)
    ? systemConfig.modelsConfigPath
    : resolve(systemDir, systemConfig.modelsConfigPath);

  const modelsConfig = loadModelsConfig(readJsonFile(modelsConfigPath));

  const resolvedProviders: ModelProviderMap = Object.fromEntries(Object.entries(modelsConfig.providers).map(([providerName, provider]) => [
    providerName,
    {
      ...provider,
      upstream: {
        ...provider.upstream,
        apiKey: resolveSecret(provider.upstream.apiKey),
        proxyUrl: normalizeProxyUrl(resolveSecret(provider.upstream.proxyUrl), `providers.${providerName}.upstream.proxyUrl`),
      },
    },
  ]));

  const normalizedModels = flattenProviderModels(resolvedProviders);
  validateModelReferences(normalizedModels);

  const resolvedGlobalProxyUrl = normalizeProxyUrl(resolveSecret(modelsConfig.proxyUrl), 'proxyUrl');

  return {
    system: systemConfig,
    models: {
      ...modelsConfig,
      proxyUrl: resolvedGlobalProxyUrl,
      providers: resolvedProviders,
      models: normalizedModels,
    },
    systemConfigPath,
    modelsConfigPath,
  };
}

export function initConfig(targetDirectoryInput: string): { systemConfigPath: string; modelsConfigPath: string } {
  const targetDirectory = resolve(process.cwd(), targetDirectoryInput);
  const configDirectory = join(targetDirectory, 'config');
  mkdirSync(configDirectory, { recursive: true });

  const systemTarget = join(configDirectory, 'system.json');
  const modelsTarget = join(configDirectory, 'models.json');

  assert(!existsSync(systemTarget), `${systemTarget} already exists`);
  assert(!existsSync(modelsTarget), `${modelsTarget} already exists`);

  const systemConfig: SystemConfig = {
    server: {
      host: '127.0.0.1',
      port: 11434,
    },
    ollama: {
      version: DEFAULT_OLLAMA_VERSION,
    },
    modelsConfigPath: './models.json',
    logging: {
      level: 'info',
      logRequests: false,
      redactHeaders: ['authorization'],
    },
    frontends: {},
  };

  const modelsConfig = {
    defaults: {
      stream: true,
      temperature: 0.2,
      max_tokens: 4096,
    },
    providers: {
      default: {
        upstream: {
          baseUrl: 'https://api.openai.com/v1',
          apiKey: 'REPLACE_WITH_OPENAI_API_KEY',
          timeoutMs: 60000,
          retry: {
            attempts: 0,
            backoffMs: 0,
            retryOnStatusCodes: [429, 500, 502, 503, 504],
          },
          headers: {},
        },
        models: [
          {
            id: 'gpt-4.1-local',
            displayName: 'GPT-4.1 Local Proxy',
            targetModel: 'gpt-4.1',
            contextWindow: 128000,
            maxOutputTokens: 4096,
            supports: {
              tools: true,
              vision: true,
            },
            parameters: {},
            payloadOverrides: {},
            payloadOverridesByThinking: {},
            reasoningHistory: {
              mode: 'none',
            },
          },
        ],
      },
    },
  };

  writeFileSync(systemTarget, `${JSON.stringify(systemConfig, null, 2)}\n`, 'utf8');
  writeFileSync(modelsTarget, `${JSON.stringify(modelsConfig, null, 2)}\n`, 'utf8');

  return { systemConfigPath: systemTarget, modelsConfigPath: modelsTarget };
}
