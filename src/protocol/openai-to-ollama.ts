import { Readable, Transform, type TransformCallback } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';
import { isRecord } from '../guards';

type JsonRecord = Record<string, unknown>;

type UsageInfo = {
  prompt_eval_count: number;
  eval_count: number;
};

function asObject(value: unknown): JsonRecord | undefined {
  return isRecord(value) ? value : undefined;
}

function parseArguments(value: unknown): unknown {
  if (isRecord(value)) {
    return value;
  }
  if (typeof value !== 'string') {
    return {};
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed;
  } catch {
    return {};
  }
}

function mapToolCallsToOllama(message: JsonRecord | undefined): unknown[] | undefined {
  if (!message || !Array.isArray(message.tool_calls)) {
    return undefined;
  }

  const mapped = message.tool_calls
    .map((toolCall) => {
      const callObject = asObject(toolCall);
      const functionValue = callObject ? asObject(callObject.function) : undefined;
      const name = functionValue && typeof functionValue.name === 'string' ? functionValue.name : undefined;
      if (!name) {
        return undefined;
      }

      return {
        function: {
          name,
          arguments: parseArguments(functionValue?.arguments),
        },
      };
    })
    .filter((value): value is { function: { name: string; arguments: unknown } } => value !== undefined);

  return mapped.length > 0 ? mapped : undefined;
}

function mapThinking(message: JsonRecord | undefined): string | undefined {
  if (!message) {
    return undefined;
  }

  if (typeof message.thinking === 'string' && message.thinking.length > 0) {
    return message.thinking;
  }

  if (typeof message.reasoning_content === 'string' && message.reasoning_content.length > 0) {
    return message.reasoning_content;
  }

  return undefined;
}

function mapUsage(usage: unknown): UsageInfo {
  const usageObject = asObject(usage);
  const promptTokens = usageObject && typeof usageObject.prompt_tokens === 'number' ? usageObject.prompt_tokens : 0;
  const completionTokens = usageObject && typeof usageObject.completion_tokens === 'number' ? usageObject.completion_tokens : 0;
  return {
    prompt_eval_count: promptTokens,
    eval_count: completionTokens,
  };
}

function chatDonePayload(model: string, createdAt: string, finishReason: unknown, usage: UsageInfo, toolCalls?: unknown[]): JsonRecord {
  const payload: JsonRecord = {
    model,
    created_at: createdAt,
    message: {
      role: 'assistant',
      content: '',
    },
    done: true,
    done_reason: typeof finishReason === 'string' ? finishReason : 'stop',
    total_duration: 0,
    load_duration: 0,
    prompt_eval_count: usage.prompt_eval_count,
    prompt_eval_duration: 0,
    eval_count: usage.eval_count,
    eval_duration: 0,
  };

  if (toolCalls && toolCalls.length > 0) {
    (payload.message as JsonRecord).tool_calls = toolCalls;
  }

  return payload;
}

function generateDonePayload(model: string, createdAt: string, finishReason: unknown, usage: UsageInfo): JsonRecord {
  return {
    model,
    created_at: createdAt,
    response: '',
    done: true,
    done_reason: typeof finishReason === 'string' ? finishReason : 'stop',
    context: [],
    total_duration: 0,
    load_duration: 0,
    prompt_eval_count: usage.prompt_eval_count,
    prompt_eval_duration: 0,
    eval_count: usage.eval_count,
    eval_duration: 0,
  };
}

export function mapOpenAITextToOllamaChat(body: string, visibleModel: string): string {
  const parsed = JSON.parse(body) as unknown;
  const root = asObject(parsed) ?? {};
  const choices = Array.isArray(root.choices) ? root.choices : [];
  const firstChoice = asObject(choices[0]);
  const message = asObject(firstChoice?.message);

  const payload: JsonRecord = {
    model: visibleModel,
    created_at: new Date().toISOString(),
    message: {
      role: 'assistant',
      content: typeof message?.content === 'string' ? message.content : '',
    },
    done: true,
    done_reason: typeof firstChoice?.finish_reason === 'string' ? firstChoice.finish_reason : 'stop',
    total_duration: 0,
    load_duration: 0,
    prompt_eval_count: 0,
    prompt_eval_duration: 0,
    eval_count: 0,
    eval_duration: 0,
  };

  const thinking = mapThinking(message);
  if (thinking) {
    (payload.message as JsonRecord).thinking = thinking;
  }

  const toolCalls = mapToolCallsToOllama(message);
  if (toolCalls) {
    (payload.message as JsonRecord).tool_calls = toolCalls;
  }

  const usage = mapUsage(root.usage);
  payload.prompt_eval_count = usage.prompt_eval_count;
  payload.eval_count = usage.eval_count;

  return JSON.stringify(payload);
}

export function mapOpenAITextToOllamaGenerate(body: string, visibleModel: string): string {
  const parsed = JSON.parse(body) as unknown;
  const root = asObject(parsed) ?? {};
  const choices = Array.isArray(root.choices) ? root.choices : [];
  const firstChoice = asObject(choices[0]);
  const message = asObject(firstChoice?.message);

  const usage = mapUsage(root.usage);

  return JSON.stringify({
    model: visibleModel,
    created_at: new Date().toISOString(),
    response: typeof message?.content === 'string' ? message.content : '',
    done: true,
    done_reason: typeof firstChoice?.finish_reason === 'string' ? firstChoice.finish_reason : 'stop',
    context: [],
    total_duration: 0,
    load_duration: 0,
    prompt_eval_count: usage.prompt_eval_count,
    prompt_eval_duration: 0,
    eval_count: usage.eval_count,
    eval_duration: 0,
  });
}

export function mapOpenAITextToOllamaEmbed(body: string, visibleModel: string): string {
  const parsed = JSON.parse(body) as unknown;
  const root = asObject(parsed) ?? {};
  const data = Array.isArray(root.data) ? root.data : [];

  const embeddings = data
    .map((entry) => asObject(entry))
    .filter((entry): entry is JsonRecord => entry !== undefined)
    .map((entry) => (Array.isArray(entry.embedding) ? entry.embedding : []));

  const usage = mapUsage(root.usage);

  return JSON.stringify({
    model: visibleModel,
    embeddings,
    total_duration: 0,
    load_duration: 0,
    prompt_eval_count: usage.prompt_eval_count,
  });
}

export function mapOpenAITextToOllamaEmbeddings(body: string): string {
  const parsed = JSON.parse(body) as unknown;
  const root = asObject(parsed) ?? {};
  const data = Array.isArray(root.data) ? root.data : [];
  const first = asObject(data[0]);

  return JSON.stringify({
    embedding: Array.isArray(first?.embedding) ? first.embedding : [],
  });
}

type StreamMode = 'chat' | 'generate';

interface ToolCallAccumulator {
  name?: string;
  argumentsText: string;
}

class OpenAIStreamToOllamaNdjson extends Transform {
  private readonly decoder = new StringDecoder('utf8');

  private sseBuffer = '';

  private readonly createdAt = new Date().toISOString();

  private readonly toolCalls = new Map<number, ToolCallAccumulator>();

  constructor(private readonly visibleModel: string, private readonly mode: StreamMode) {
    super();
  }

  _transform(chunk: Buffer | string, _encoding: BufferEncoding, callback: TransformCallback): void {
    const text = typeof chunk === 'string' ? chunk : this.decoder.write(chunk);
    this.sseBuffer += text.replace(/\r\n/g, '\n');

    let separatorIndex = this.sseBuffer.indexOf('\n\n');
    while (separatorIndex !== -1) {
      const rawEvent = this.sseBuffer.slice(0, separatorIndex);
      this.sseBuffer = this.sseBuffer.slice(separatorIndex + 2);
      this.processSseEvent(rawEvent);
      separatorIndex = this.sseBuffer.indexOf('\n\n');
    }

    callback();
  }

  _flush(callback: TransformCallback): void {
    const trailingText = this.decoder.end();
    if (trailingText) {
      this.sseBuffer += trailingText.replace(/\r\n/g, '\n');
    }

    if (this.sseBuffer.trim().length > 0) {
      this.processSseEvent(this.sseBuffer);
    }

    callback();
  }

  private processSseEvent(rawEvent: string): void {
    const dataLines = rawEvent
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart());

    if (dataLines.length === 0) {
      return;
    }

    const eventPayload = dataLines.join('\n');
    if (eventPayload === '[DONE]') {
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(eventPayload) as unknown;
    } catch {
      return;
    }

    const root = asObject(parsed);
    if (!root) {
      return;
    }

    const choice = Array.isArray(root.choices) ? asObject(root.choices[0]) : undefined;
    const delta = asObject(choice?.delta);
    const finishReason = choice?.finish_reason;

    const toolCallsFromDelta = Array.isArray(delta?.tool_calls) ? delta.tool_calls : [];
    for (const rawToolCall of toolCallsFromDelta) {
      const call = asObject(rawToolCall);
      const callIndex = call && typeof call.index === 'number' ? call.index : 0;
      const functionValue = call ? asObject(call.function) : undefined;
      const current = this.toolCalls.get(callIndex) ?? { argumentsText: '' };

      if (functionValue && typeof functionValue.name === 'string') {
        current.name = functionValue.name;
      }
      if (functionValue && typeof functionValue.arguments === 'string') {
        current.argumentsText += functionValue.arguments;
      }

      this.toolCalls.set(callIndex, current);
    }

    const content = typeof delta?.content === 'string' ? delta.content : '';
    const thinking = typeof delta?.reasoning_content === 'string'
      ? delta.reasoning_content
      : typeof delta?.thinking === 'string'
        ? delta.thinking
        : '';

    if (finishReason !== null && finishReason !== undefined) {
      const usage = mapUsage(root.usage);
      const toolCalls = this.getFinalToolCalls();
      const donePayload = this.mode === 'chat'
        ? chatDonePayload(this.visibleModel, this.createdAt, finishReason, usage, toolCalls)
        : generateDonePayload(this.visibleModel, this.createdAt, finishReason, usage);
      this.push(`${JSON.stringify(donePayload)}\n`);
      return;
    }

    if (this.mode === 'chat') {
      if (content.length === 0 && thinking.length === 0) {
        return;
      }

      const payload: JsonRecord = {
        model: this.visibleModel,
        created_at: this.createdAt,
        message: {
          role: 'assistant',
          content,
        },
        done: false,
      };

      if (thinking.length > 0) {
        (payload.message as JsonRecord).thinking = thinking;
      }

      this.push(`${JSON.stringify(payload)}\n`);
      return;
    }

    if (content.length === 0) {
      return;
    }

    const payload: JsonRecord = {
      model: this.visibleModel,
      created_at: this.createdAt,
      response: content,
      done: false,
    };

    this.push(`${JSON.stringify(payload)}\n`);
  }

  private getFinalToolCalls(): unknown[] | undefined {
    if (this.toolCalls.size === 0) {
      return undefined;
    }

    const result: unknown[] = [];
    const sortedEntries = [...this.toolCalls.entries()].sort((a, b) => a[0] - b[0]);
    for (const [, value] of sortedEntries) {
      if (!value.name) {
        continue;
      }

      result.push({
        function: {
          name: value.name,
          arguments: parseArguments(value.argumentsText),
        },
      });
    }

    return result.length > 0 ? result : undefined;
  }
}

export function createOpenAIStreamToOllamaNdjson(body: Readable, visibleModel: string, mode: StreamMode): Readable {
  const transform = new OpenAIStreamToOllamaNdjson(visibleModel, mode);

  body.once('error', (error) => {
    transform.destroy(error);
  });
  transform.once('close', () => {
    if (!body.destroyed) {
      body.destroy();
    }
  });

  body.pipe(transform);
  return transform;
}
