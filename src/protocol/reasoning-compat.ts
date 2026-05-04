import { Readable, Transform, type TransformCallback } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';
import { isRecord } from '../guards';
import type { ReasoningFieldName } from '../types';

/**
 * Reasoning field compatibility layer for the /v1/chat/completions pass-through.
 *
 * Different providers return reasoning content under different field names
 * (e.g. DeepSeek → `reasoning_content`, Anthropic → `thinking`), and different
 * clients expect different field names (e.g. Copilot → `thinking`,
 * Cursor/Continue → `reasoning_content`).
 *
 * This module adds an **alias** of the client-expected field when the upstream
 * field differs from what the client expects.  The original upstream field is
 * always preserved.
 */

// ── Core mirror logic ──────────────────────────────────────────────────

function mirrorField(
  value: Record<string, unknown>,
  from: ReasoningFieldName,
  to: ReasoningFieldName,
): boolean {
  if (typeof value[from] !== 'string' || typeof value[to] === 'string') {
    return false;
  }

  value[to] = value[from];
  return true;
}

type MirrorFn = (value: Record<string, unknown>) => boolean;

function buildMirrorFn(from: ReasoningFieldName, to: ReasoningFieldName): MirrorFn {
  return (value) => mirrorField(value, from, to);
}

// ── OpenAI choices traversal ───────────────────────────────────────────

function mapChoices(payload: unknown, mirrorFn: MirrorFn): boolean {
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
      changed = mirrorFn(choice.delta) || changed;
    }
    if (isRecord(choice.message)) {
      changed = mirrorFn(choice.message) || changed;
    }
  }

  return changed;
}

// ── SSE rewriting ──────────────────────────────────────────────────────

function rewriteSseEvent(rawEvent: string, mirrorFn: MirrorFn): string {
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
    if (!mapChoices(parsed, mirrorFn)) {
      return `${rawEvent}\n\n`;
    }

    const rewrittenLines = [...passthroughLines, `data: ${JSON.stringify(parsed)}`];
    return `${rewrittenLines.join('\n')}\n\n`;
  } catch {
    return `${rawEvent}\n\n`;
  }
}

// ── Stream transform ───────────────────────────────────────────────────

class ReasoningCompatStream extends Transform {
  private readonly decoder = new StringDecoder('utf8');
  private readonly mirrorFn: MirrorFn;
  private sseBuffer = '';

  constructor(mirrorFn: MirrorFn) {
    super();
    this.mirrorFn = mirrorFn;
  }

  _transform(chunk: Buffer | string, _encoding: BufferEncoding, callback: TransformCallback): void {
    const text = typeof chunk === 'string' ? chunk : this.decoder.write(chunk);
    this.sseBuffer += text.replace(/\r\n/g, '\n');

    let separatorIndex = this.sseBuffer.indexOf('\n\n');
    while (separatorIndex !== -1) {
      const rawEvent = this.sseBuffer.slice(0, separatorIndex);
      this.sseBuffer = this.sseBuffer.slice(separatorIndex + 2);
      this.push(rewriteSseEvent(rawEvent, this.mirrorFn));
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
      this.push(rewriteSseEvent(this.sseBuffer, this.mirrorFn));
      this.sseBuffer = '';
    }

    callback();
  }
}

// ── Public API ─────────────────────────────────────────────────────────

/**
 * Determines whether a reasoning field alias is needed and, if so, returns
 * the mirror function.  Returns `undefined` when no transformation is required.
 */
function resolveMirror(
  upstreamField: ReasoningFieldName,
  clientField: ReasoningFieldName | undefined,
): MirrorFn | undefined {
  if (!clientField || upstreamField === clientField) {
    return undefined;
  }
  return buildMirrorFn(upstreamField, clientField);
}

/**
 * Creates a stream transform that adds a client-expected reasoning field
 * alias when the upstream field name differs.  Returns the original stream
 * unchanged when no transformation is needed.
 */
export function createReasoningCompatStream(
  body: Readable,
  upstreamField: ReasoningFieldName,
  clientField: ReasoningFieldName | undefined,
): Readable {
  const mirrorFn = resolveMirror(upstreamField, clientField);
  if (!mirrorFn) {
    return body;
  }

  const transform = new ReasoningCompatStream(mirrorFn);

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

/**
 * Adds a client-expected reasoning field alias in a non-streaming JSON body
 * when the upstream field name differs.  Returns the original body unchanged
 * when no transformation is needed.
 */
export function mapReasoningCompatBody(
  body: string,
  upstreamField: ReasoningFieldName,
  clientField: ReasoningFieldName | undefined,
): string {
  const mirrorFn = resolveMirror(upstreamField, clientField);
  if (!mirrorFn) {
    return body;
  }

  const trimmed = body.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    return body;
  }

  try {
    const parsed = JSON.parse(body) as unknown;
    if (!mapChoices(parsed, mirrorFn)) {
      return body;
    }

    return JSON.stringify(parsed);
  } catch {
    return body;
  }
}
