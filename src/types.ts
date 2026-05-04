export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface ServerConfig {
  host: string;
  port: number;
}

export interface OllamaConfig {
  version: string;
}

export interface UpstreamConfig {
  baseUrl: string;
  apiKey?: string;
  proxyUrl?: string;
  timeoutMs: number;
  retry: RetryConfig;
  headers: Record<string, string>;
}

export type UpstreamMap = Record<string, UpstreamConfig>;

export interface RetryConfig {
  attempts: number;
  backoffMs: number;
  retryOnStatusCodes: number[];
}

export type LogLevel = 'silent' | 'error' | 'info' | 'debug';

export interface LoggingConfig {
  level: LogLevel;
  logRequests: boolean;
  redactHeaders: string[];
}

export type FrontendPromptRole = 'system' | 'user';

export interface FrontendPromptMessage {
  role: FrontendPromptRole;
  content: string;
}

export type FrontendToolGuidanceTarget = 'all-tools' | 'file-tools' | 'tool-names';

export interface FrontendToolGuidance {
  target: FrontendToolGuidanceTarget;
  toolNames?: string[];
  descriptionSuffix: string;
}

export interface FrontendProfile {
  userAgentPattern?: string;
  requestDefaults: ModelRequestDefaults;
  payloadOverrides: ModelRequestDefaults;
  messages: FrontendPromptMessage[];
  toolGuidance: FrontendToolGuidance[];
}

export type FrontendMap = Record<string, FrontendProfile>;

export interface SystemConfig {
  server: ServerConfig;
  ollama: OllamaConfig;
  modelsConfigPath: string;
  logging: LoggingConfig;
  frontends: FrontendMap;
}

export interface ModelRequestDefaults {
  stream?: boolean;
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  [key: string]: JsonValue | undefined;
}

export interface ModelSupportFlags {
  tools: boolean;
  vision: boolean;
}

export interface ThinkingStatePayloadOverrides {
  enabled?: ModelRequestDefaults;
  disabled?: ModelRequestDefaults;
}

export type ReasoningHistoryMode = 'none' | 'inject-empty' | 'require-present';

export interface ReasoningHistoryConfig {
  mode: ReasoningHistoryMode;
}

export interface ModelDefinition {
  id: string;
  displayName: string;
  provider: string;
  targetModel: string;
  contextWindow: number;
  maxOutputTokens: number;
  supports: ModelSupportFlags;
  parameters: ModelRequestDefaults;
  payloadOverrides: ModelRequestDefaults;
  payloadOverridesByThinking: ThinkingStatePayloadOverrides;
  reasoningHistory: ReasoningHistoryConfig;
}

export interface ModelDefinitionConfig {
  id: string;
  displayName: string;
  targetModel: string;
  contextWindow: number;
  maxOutputTokens: number;
  supports: ModelSupportFlags;
  parameters: ModelRequestDefaults;
  payloadOverrides: ModelRequestDefaults;
  payloadOverridesByThinking: ThinkingStatePayloadOverrides;
  reasoningHistory: ReasoningHistoryConfig;
}

export interface ModelProviderConfig {
  upstream: UpstreamConfig;
  models: ModelDefinitionConfig[];
}

export type ModelProviderMap = Record<string, ModelProviderConfig>;

export interface ModelsConfig {
  proxyUrl?: string;
  defaults: ModelRequestDefaults;
  providers: ModelProviderMap;
  models: ModelDefinition[];
}

export interface AppConfig {
  system: SystemConfig;
  models: ModelsConfig;
  systemConfigPath: string;
  modelsConfigPath: string;
}

export interface UpstreamRequestContext {
  readonly routeHint: 'chat' | 'generate' | 'embed' | 'chat-completions';
  readonly visibleModel: string;
}
