import { Readable, Transform, type TransformCallback } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';
import { isRecord } from '../guards';

/**
 * Mirrors `reasoning_content` as `thinking` in OpenAI-format responses.
 * This is needed for the /v1/chat/completions pass-through path where
 * upstream providers (DeepSeek, etc.) return `reasoning_content` but
 * Ollama-speaking clients expect `thinking`.
 */

function mirrorReasoningContentAsThinking(value: Record<string, unknown>): boolean {
  if (typeof value.reasoning_content !== 'string' || typeof value.thinking === 'string') {
    return false;
  }

  value.thinking = value.reasoning_content;
  return true;
}

function mapChoicesReasoningContentToThinking(payload: unknown): boolean {
  if (!isRecord(payload) || !Array.isArray((payload as Record<string, unknown>).choices)) {
    return false;
  }

  const choices = (payload as Record<string, unknown>).choices as unknown[];
  let changed = false;
  for (const choice of choices) {
    if (!isRecord(choice)) {
      continue;
    }

    if (isRecord(choice.delta)) {
      changed = mirrorReasoningContentAsThinking(choice.delta) || changed;
    }
    if (isRecord(choice.message)) {
      changed = mirrorReasoningContentAsThinking(choice.message) || changed;
    }
  }

  return changed;
}

function rewriteSseEvent(rawEvent: string): string {
  const lines = rawEvent.split('\n');
  const dataLines: string[] = [];
  const passthroughLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart());
      continue;
    }

    passthroughLines.push(line);
  }

  if (dataLines.length === 0) {
    return `${rawEvent}\n\n`;
  }

  const eventPayload = dataLines.join('\n');
  if (eventPayload === '[DONE]') {
    return `${rawEvent}\n\n`;
  }

  try {
    const parsed = JSON.parse(eventPayload) as unknown;
    if (!mapChoicesReasoningContentToThinking(parsed)) {
      return `${rawEvent}\n\n`;
    }

    const rewrittenLines = [...passthroughLines, `data: ${JSON.stringify(parsed)}`];
    return `${rewrittenLines.join('\n')}\n\n`;
  } catch {
    return `${rawEvent}\n\n`;
  }
}

class ReasoningContentToThinkingStream extends Transform {
  private readonly decoder = new StringDecoder('utf8');

  private sseBuffer = '';

  _transform(chunk: Buffer | string, _encoding: BufferEncoding, callback: TransformCallback): void {
    const text = typeof chunk === 'string' ? chunk : this.decoder.write(chunk);
    this.sseBuffer += text.replace(/\r\n/g, '\n');

    let separatorIndex = this.sseBuffer.indexOf('\n\n');
    while (separatorIndex !== -1) {
      const rawEvent = this.sseBuffer.slice(0, separatorIndex);
      this.sseBuffer = this.sseBuffer.slice(separatorIndex + 2);
      this.push(rewriteSseEvent(rawEvent));
      separatorIndex = this.sseBuffer.indexOf('\n\n');
    }

    callback();
  }

  _flush(callback: TransformCallback): void {
    const trailingText = this.decoder.end();
    if (trailingText) {
      this.sseBuffer += trailingText.replace(/\r\n/g, '\n');
    }

    if (this.sseBuffer.length > 0) {
      this.push(rewriteSseEvent(this.sseBuffer));
      this.sseBuffer = '';
    }

    callback();
  }
}

export function createReasoningContentToThinkingStream(body: Readable): Readable {
  const transform = new ReasoningContentToThinkingStream();

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

export function mapReasoningContentToThinkingTextBody(body: string): string {
  const trimmed = body.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    return body;
  }

  try {
    const parsed = JSON.parse(body) as unknown;
    if (!mapChoicesReasoningContentToThinking(parsed)) {
      return body;
    }

    return JSON.stringify(parsed);
  } catch {
    return body;
  }
}
