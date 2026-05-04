import { badRequest } from '../errors';
import { isRecord } from '../guards';
import type { JsonValue } from '../types';

type JsonObject = Record<string, JsonValue>;

type OllamaMessageRole = 'system' | 'user' | 'assistant' | 'tool';

interface OllamaMessage {
  role: OllamaMessageRole;
  content?: string;
  images?: string[];
  thinking?: string;
  tool_calls?: unknown[];
  tool_name?: string;
  tool_call_id?: string;
}

function ensureObject(value: unknown, fieldName: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw badRequest(`${fieldName} must be an object`, 'invalid_request');
  }
  return value;
}

function ensureModel(payload: Record<string, unknown>): string {
  if (typeof payload.model !== 'string' || payload.model.length === 0) {
    throw badRequest('model is required', 'missing_model');
  }
  return payload.model;
}

function mapOllamaFormatToResponseFormat(format: unknown): JsonValue | undefined {
  if (format === undefined) {
    return undefined;
  }

  if (format === 'json') {
    return { type: 'json_object' };
  }

  if (isRecord(format)) {
    return {
      type: 'json_schema',
      json_schema: {
        name: 'structured_output',
        schema: format,
        strict: false,
      },
    } as JsonValue;
  }

  return undefined;
}

function toImageUrl(image: string): string {
  if (image.startsWith('data:')) {
    return image;
  }
  return `data:image/png;base64,${image}`;
}

function mapToolCallForOpenAI(rawCall: unknown, index: number): Record<string, unknown> | undefined {
  if (!isRecord(rawCall) || !isRecord(rawCall.function)) {
    return undefined;
  }

  const name = typeof rawCall.function.name === 'string' ? rawCall.function.name : undefined;
  if (!name) {
    return undefined;
  }

  const rawArgs = rawCall.function.arguments;
  const argumentsText = typeof rawArgs === 'string'
    ? rawArgs
    : JSON.stringify(rawArgs ?? {});

  return {
    id: `call_${index}_${name}`,
    type: 'function',
    function: {
      name,
      arguments: argumentsText,
    },
  };
}

function mapMessage(message: OllamaMessage, messageIndex: number): Record<string, unknown> {
  const mapped: Record<string, unknown> = {
    role: message.role,
  };

  if (message.role === 'tool') {
    mapped.content = message.content ?? '';
    if (typeof message.tool_call_id === 'string') {
      mapped.tool_call_id = message.tool_call_id;
    } else {
      const toolName = typeof message.tool_name === 'string' ? message.tool_name : `tool_${messageIndex}`;
      mapped.tool_call_id = `call_${toolName}_${messageIndex}`;
    }
    return mapped;
  }

  const hasImages = Array.isArray(message.images) && message.images.length > 0;
  if (hasImages) {
    const parts: Array<Record<string, unknown>> = [];
    if (typeof message.content === 'string' && message.content.length > 0) {
      parts.push({ type: 'text', text: message.content });
    }
    for (const image of message.images ?? []) {
      parts.push({
        type: 'image_url',
        image_url: { url: toImageUrl(image) },
      });
    }
    mapped.content = parts;
  } else {
    mapped.content = message.content ?? '';
  }

  if (typeof message.thinking === 'string' && message.thinking.length > 0) {
    mapped.reasoning_content = message.thinking;
  }

  if (message.role === 'assistant' && Array.isArray(message.tool_calls)) {
    const toolCalls = message.tool_calls
      .map((call, callIndex) => mapToolCallForOpenAI(call, callIndex))
      .filter((entry): entry is Record<string, unknown> => entry !== undefined);

    if (toolCalls.length > 0) {
      mapped.tool_calls = toolCalls;
    }
  }

  return mapped;
}

function mapOptionsToOpenAI(payload: JsonObject, options: Record<string, unknown>): void {
  if (typeof options.temperature === 'number') {
    payload.temperature = options.temperature;
  }
  if (typeof options.top_p === 'number') {
    payload.top_p = options.top_p;
  }
  if (typeof options.seed === 'number') {
    payload.seed = options.seed;
  }
  if (typeof options.stop === 'string' || Array.isArray(options.stop)) {
    payload.stop = options.stop as JsonValue;
  }
  if (typeof options.num_predict === 'number') {
    payload.max_tokens = options.num_predict;
  }
  if (typeof options.repeat_penalty === 'number') {
    payload.frequency_penalty = Math.max(-2, Math.min(2, options.repeat_penalty - 1));
  }
}

export interface NormalizedOllamaRequest {
  model: string;
  payload: JsonObject;
}

export function normalizeOllamaChatToOpenAI(requestBody: unknown): NormalizedOllamaRequest {
  const payload = ensureObject(requestBody, 'request body');
  const model = ensureModel(payload);

  const messagesInput = Array.isArray(payload.messages) ? payload.messages : [];
  const messages: Array<Record<string, unknown>> = messagesInput
    .filter((message): message is OllamaMessage => isRecord(message) && typeof message.role === 'string')
    .map((message, index) => mapMessage(message as OllamaMessage, index));

  if (typeof payload.system === 'string' && payload.system.length > 0) {
    messages.unshift({ role: 'system', content: payload.system });
  }

  const normalized: JsonObject = {
    model,
    messages: messages as unknown as JsonValue,
    stream: payload.stream === undefined ? true : payload.stream === true,
  };

  if (Array.isArray(payload.tools)) {
    normalized.tools = payload.tools as JsonValue;
  }
  if (typeof payload.tool_choice === 'string' || isRecord(payload.tool_choice)) {
    normalized.tool_choice = payload.tool_choice as JsonValue;
  }
  if (typeof payload.think === 'boolean') {
    normalized.think = payload.think;
  }
  if (isRecord(payload.thinking)) {
    normalized.thinking = payload.thinking as JsonValue;
  }

  const responseFormat = mapOllamaFormatToResponseFormat(payload.format);
  if (responseFormat !== undefined) {
    normalized.response_format = responseFormat;
  }

  if (isRecord(payload.options)) {
    mapOptionsToOpenAI(normalized, payload.options);
  }

  return { model, payload: normalized };
}

export function normalizeOllamaGenerateToOpenAI(requestBody: unknown): NormalizedOllamaRequest {
  const payload = ensureObject(requestBody, 'request body');
  const model = ensureModel(payload);

  const prompt = typeof payload.prompt === 'string' ? payload.prompt : '';
  const suffix = typeof payload.suffix === 'string' ? payload.suffix : '';

  const messages: Array<Record<string, unknown>> = [];
  if (typeof payload.system === 'string' && payload.system.length > 0) {
    messages.push({ role: 'system', content: payload.system });
  }

  const userContent = suffix.length > 0 ? `${prompt}\n\n${suffix}` : prompt;
  messages.push({ role: 'user', content: userContent });

  const normalized: JsonObject = {
    model,
    messages: messages as unknown as JsonValue,
    stream: payload.stream === undefined ? true : payload.stream === true,
  };

  const responseFormat = mapOllamaFormatToResponseFormat(payload.format);
  if (responseFormat !== undefined) {
    normalized.response_format = responseFormat;
  }

  if (typeof payload.think === 'boolean') {
    normalized.think = payload.think;
  }
  if (isRecord(payload.thinking)) {
    normalized.thinking = payload.thinking as JsonValue;
  }

  if (isRecord(payload.options)) {
    mapOptionsToOpenAI(normalized, payload.options);
  }

  return { model, payload: normalized };
}

export function normalizeOllamaEmbedToOpenAI(requestBody: unknown): NormalizedOllamaRequest {
  const payload = ensureObject(requestBody, 'request body');
  const model = ensureModel(payload);

  const input = payload.input;
  if (!(typeof input === 'string' || Array.isArray(input))) {
    throw badRequest('input is required for /api/embed', 'missing_input');
  }

  const normalized: JsonObject = {
    model,
    input: input as JsonValue,
  };

  return { model, payload: normalized };
}

export function normalizeOllamaEmbeddingsToOpenAI(requestBody: unknown): NormalizedOllamaRequest {
  const payload = ensureObject(requestBody, 'request body');
  const model = ensureModel(payload);

  if (typeof payload.prompt !== 'string' || payload.prompt.length === 0) {
    throw badRequest('prompt is required for /api/embeddings', 'missing_prompt');
  }

  return {
    model,
    payload: {
      model,
      input: payload.prompt,
    },
  };
}
