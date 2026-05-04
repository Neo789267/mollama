import {
  applyFrontendProfile,
  getFrontendPayloadOverrides,
  getFrontendRequestDefaults,
} from './frontend-policy';
import { badRequest } from './errors';
import { isRecord, isJsonObject } from './guards';
import type { FrontendProfile, JsonValue, ModelDefinition, ModelRequestDefaults } from './types';

type JsonObject = Record<string, JsonValue>;

function isAssistantMessage(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && value.role === 'assistant';
}

function assistantMessageHasReasoningField(message: Record<string, unknown>): boolean {
  return typeof message.reasoning_content === 'string';
}

function copyThinkingAliasToReasoningContent(message: Record<string, unknown>): boolean {
  if (typeof message.thinking !== 'string') {
    return false;
  }

  if (!assistantMessageHasReasoningField(message)) {
    message.reasoning_content = message.thinking;
  }
  delete message.thinking;
  return true;
}

function requestUsesTools(payload: JsonObject): boolean {
  return Array.isArray(payload.tools) && payload.tools.length > 0;
}

function requestUsesVision(payload: JsonObject): boolean {
  const messages = payload.messages;
  if (!Array.isArray(messages)) {
    return false;
  }

  return messages.some((message) => {
    if (!isRecord(message)) {
      return false;
    }

    if (Array.isArray(message.images) && message.images.length > 0) {
      return true;
    }

    const content = message.content;
    if (!Array.isArray(content)) {
      return false;
    }

    return content.some((part) => isRecord(part) && (part.type === 'image_url' || part.type === 'input_image'));
  });
}

function ensureModelSupportsRequest(model: ModelDefinition, payload: JsonObject): void {
  if (requestUsesTools(payload) && !model.supports.tools) {
    throw badRequest(`Model ${model.id} does not support tool calling`, 'tools_unsupported');
  }

  if (requestUsesVision(payload) && !model.supports.vision) {
    throw badRequest(`Model ${model.id} does not support vision input`, 'vision_unsupported');
  }
}

function modelSupportsThinkingControls(model: ModelDefinition, payload: JsonObject): boolean {
  return isJsonObject(payload.thinking)
    || isJsonObject(model.parameters.thinking)
    || model.parameters.reasoning_effort !== undefined
    || model.payloadOverridesByThinking.enabled !== undefined
    || model.payloadOverridesByThinking.disabled !== undefined
    || model.reasoningHistory.mode !== 'none';
}

function applyThinkParameterAlias(model: ModelDefinition, payload: JsonObject): void {
  if (typeof payload.think !== 'boolean') {
    return;
  }

  if (!modelSupportsThinkingControls(model, payload)) {
    throw badRequest(`Model ${model.id} does not support think parameter`, 'think_unsupported');
  }

  const thinking = isJsonObject(payload.thinking) ? { ...payload.thinking } : {};
  thinking.type = payload.think ? 'enabled' : 'disabled';
  payload.thinking = thinking;
  delete payload.think;
}

function applyReasoningHistoryMode(model: ModelDefinition, payload: JsonObject): void {
  if (model.reasoningHistory.mode === 'none') {
    return;
  }

  const thinking = payload.thinking;
  if (!isRecord(thinking) || thinking.type !== 'enabled') {
    return;
  }

  const messages = payload.messages;
  if (!Array.isArray(messages)) {
    return;
  }

  const assistantMessagesMissingReasoning: Array<Record<string, unknown>> = [];
  for (const message of messages) {
    if (!isAssistantMessage(message)) {
      continue;
    }

    if (copyThinkingAliasToReasoningContent(message)) {
      continue;
    }

    if (!assistantMessageHasReasoningField(message)) {
      assistantMessagesMissingReasoning.push(message);
    }
  }

  if (assistantMessagesMissingReasoning.length === 0) {
    return;
  }

  if (model.reasoningHistory.mode === 'inject-empty') {
    for (const message of assistantMessagesMissingReasoning) {
      message.reasoning_content = '';
    }
    return;
  }

  throw badRequest(
    `Model ${model.id} requires reasoning_content on every historical assistant message when thinking is enabled`,
    'missing_reasoning_content',
  );
}

function applyThinkingStatePayloadOverrides(model: ModelDefinition, payload: JsonObject): void {
  const thinking = payload.thinking;
  if (!isRecord(thinking)) {
    return;
  }

  const overrides = thinking.type === 'enabled'
    ? model.payloadOverridesByThinking.enabled
    : thinking.type === 'disabled'
      ? model.payloadOverridesByThinking.disabled
      : undefined;

  if (!overrides) {
    return;
  }

  Object.assign(payload, overrides);
}

function clampMaxTokens(model: ModelDefinition, payload: JsonObject): void {
  const maxTokens = payload.max_tokens;
  if (typeof maxTokens !== 'number' || !Number.isFinite(maxTokens)) {
    return;
  }

  payload.max_tokens = Math.min(maxTokens, model.maxOutputTokens);
}

export function buildUpstreamPayload(
  defaults: ModelRequestDefaults,
  model: ModelDefinition,
  requestPayload: JsonObject,
  frontendProfile?: FrontendProfile,
): JsonObject {
  ensureModelSupportsRequest(model, requestPayload);

  const frontendRequestDefaults = getFrontendRequestDefaults(frontendProfile);
  const frontendPayloadOverrides = getFrontendPayloadOverrides(frontendProfile);

  const merged: JsonObject = {
    ...defaults,
    ...model.parameters,
    ...frontendRequestDefaults,
    ...requestPayload,
    ...model.payloadOverrides,
    ...frontendPayloadOverrides,
    model: model.targetModel,
  };

  if (merged.max_tokens === undefined) {
    merged.max_tokens = model.maxOutputTokens;
  }

  applyFrontendProfile(merged, frontendProfile);
  applyThinkParameterAlias(model, merged);
  applyReasoningHistoryMode(model, merged);
  applyThinkingStatePayloadOverrides(model, merged);
  clampMaxTokens(model, merged);

  return merged;
}
