import { badRequest } from './errors';
import { isJsonObject } from './guards';
import type { JsonValue, ModelDefinition, ThinkingConfig, ThinkingLevel } from './types';

type JsonObject = Record<string, JsonValue>;

function enabledDefault(config: ThinkingConfig): ThinkingLevel {
  if (config.values.includes(true)) return true;
  if (config.default !== false) return config.default;
  const enabled = config.values.find(value => value !== false);
  if (enabled === undefined) throw badRequest('This model cannot enable thinking', 'think_unsupported');
  return enabled;
}

/** Resolve both Ollama controls and native OpenAI controls using the selected model's contract. */
export function applyConfiguredThinking(model: ModelDefinition, payload: JsonObject): boolean {
  const config = model.thinking!;
  const nativeThinking = payload.thinking;
  if (nativeThinking !== undefined && (!isJsonObject(nativeThinking)
    || (nativeThinking.type !== undefined && nativeThinking.type !== 'enabled' && nativeThinking.type !== 'disabled'))) {
    throw badRequest('thinking must contain type: enabled or disabled', 'invalid_thinking');
  }
  const thinking = isJsonObject(nativeThinking) ? nativeThinking : {};
  let level: unknown;
  if (payload.think !== undefined) {
    level = payload.think;
  } else if (thinking.type === 'disabled') {
    level = false;
  } else if (payload.reasoning_effort !== undefined && payload.reasoning_effort !== null) {
    level = payload.reasoning_effort === 'none' ? false : payload.reasoning_effort;
  } else if (thinking.type === 'enabled') {
    level = enabledDefault(config);
  } else {
    level = config.default;
  }

  if (typeof level === 'string' && Object.hasOwn(config.effortAliases, level)) {
    level = config.effortAliases[level];
  }
  if ((typeof level !== 'boolean' && typeof level !== 'string') || !config.values.includes(level)) {
    throw badRequest(`Model ${model.id} supports think values: ${JSON.stringify(config.values)}`, 'think_unsupported');
  }

  delete payload.think;
  delete payload.reasoning_effort;
  const enabled = level !== false;
  if (config.mode === 'toggle') {
    payload.thinking = { ...thinking, type: enabled ? 'enabled' : 'disabled' };
    if (typeof level === 'string') payload.reasoning_effort = level;
  } else {
    // Kimi Code takes effort only; fixed-thinking models take no control fields.
    delete payload.thinking;
    if (config.mode === 'effort') payload.reasoning_effort = level === false ? 'none' : level;
  }
  return enabled;
}
