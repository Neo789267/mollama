import { PassThrough, Readable } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import { Agent, ProxyAgent, fetch } from 'undici';
import { badGateway, gatewayTimeout } from '../errors';
import type { JsonValue, UpstreamConfig } from '../types';

type JsonObject = Record<string, JsonValue>;

export interface UpstreamTextResult {
  kind: 'text';
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

export interface UpstreamStreamResult {
  kind: 'stream';
  statusCode: number;
  headers: Record<string, string>;
  body: Readable;
}

export type UpstreamResult = UpstreamTextResult | UpstreamStreamResult;

function buildRequestHeaders(upstream: UpstreamConfig): Headers {
  const headers = new Headers();
  headers.set('Content-Type', 'application/json');

  for (const [key, value] of Object.entries(upstream.headers)) {
    headers.set(key, value);
  }

  if (upstream.apiKey) {
    if (headers.has('api-key')) {
      headers.set('api-key', upstream.apiKey);
    } else if (!headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${upstream.apiKey}`);
    }
  }

  return headers;
}

function copyResponseHeaders(headers: Headers): Record<string, string> {
  const allowedHeaders = ['content-type', 'cache-control', 'x-request-id'];
  const result: Record<string, string> = {};
  for (const headerName of allowedHeaders) {
    const value = headers.get(headerName);
    if (value) {
      result[headerName] = value;
    }
  }
  return result;
}

function shouldRetryStatus(upstream: UpstreamConfig, statusCode: number): boolean {
  return upstream.retry.retryOnStatusCodes.includes(statusCode);
}

async function sleep(delayMs: number, signal?: AbortSignal): Promise<void> {
  await delay(delayMs, undefined, { signal });
}

interface RequestTimeoutHandle {
  signal: AbortSignal;
  cancel: () => void;
  didTimeout: () => boolean;
}

function createResponseTimeoutHandle(timeoutMs: number): RequestTimeoutHandle {
  const controller = new AbortController();
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  return {
    signal: controller.signal,
    cancel: () => clearTimeout(timeoutId),
    didTimeout: () => timedOut,
  };
}

type RequestDispatcher = Agent | ProxyAgent;

function createRequestDispatcher(upstream: UpstreamConfig, expectsStream: boolean): RequestDispatcher | undefined {
  // The explicit response/idle timers own streaming timeouts. Undici otherwise
  // imposes a hidden five-minute header/body timeout, even when configured longer.
  const options = expectsStream ? { headersTimeout: 0, bodyTimeout: 0 } : {};
  if (upstream.proxyUrl) {
    return new ProxyAgent({ uri: upstream.proxyUrl, ...options });
  }
  return expectsStream ? new Agent(options) : undefined;
}

async function closeDispatcher(dispatcher: RequestDispatcher | undefined): Promise<void> {
  if (!dispatcher) {
    return;
  }
  await dispatcher.close();
}

function upstreamRequestError(error: unknown, timeout: RequestTimeoutHandle | undefined, timeoutMs: number): Error {
  if ((timeout?.didTimeout() ?? false) || (error instanceof Error && error.name === 'TimeoutError')) {
    return gatewayTimeout(`Upstream request timed out after ${timeoutMs}ms`, 'upstream_timeout');
  }
  let message = error instanceof Error ? error.message : String(error);
  if (error instanceof Error && error.cause instanceof Error) {
    message += `: ${error.cause.message}`;
  }
  return badGateway(message, 'upstream_request_failed');
}

function attachStreamIdleTimeout(body: Readable, timeoutMs: number): Readable {
  if (timeoutMs <= 0) {
    return body;
  }

  const output = new PassThrough();
  let timeoutId: NodeJS.Timeout | undefined;

  const clearIdleTimeout = () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = undefined;
    }
  };

  const refreshIdleTimeout = () => {
    clearIdleTimeout();
    timeoutId = setTimeout(() => {
      output.destroy(new Error(`Upstream stream timed out after ${timeoutMs}ms without data`));
    }, timeoutMs);
  };

  body.on('data', refreshIdleTimeout);
  body.once('error', (error) => {
    clearIdleTimeout();
    output.destroy(error);
  });
  body.once('end', clearIdleTimeout);
  body.once('close', clearIdleTimeout);
  output.once('close', () => {
    clearIdleTimeout();
    if (!body.destroyed) {
      body.destroy();
    }
  });
  output.once('error', clearIdleTimeout);

  refreshIdleTimeout();
  body.pipe(output);
  return output;
}

function attachDispatcherCleanup(body: Readable, dispatcher: RequestDispatcher | undefined): Readable {
  if (!dispatcher) {
    return body;
  }

  let closed = false;
  const cleanup = () => {
    if (closed) {
      return;
    }

    closed = true;
    void closeDispatcher(dispatcher).catch(() => undefined);
  };

  body.once('end', cleanup);
  body.once('close', cleanup);
  body.once('error', cleanup);
  return body;
}

export async function sendJsonRequestToUpstream(
  upstream: UpstreamConfig,
  path: string,
  payload: JsonObject,
  signal?: AbortSignal,
): Promise<UpstreamResult> {
  signal?.throwIfAborted();
  const expectsStream = payload.stream === true;
  const requestUrl = `${upstream.baseUrl}${path}`;
  const requestBody = JSON.stringify(payload);
  const dispatcher = createRequestDispatcher(upstream, expectsStream);
  let deferDispatcherCleanup = false;

  try {
    for (let attempt = 0; attempt <= upstream.retry.attempts; attempt += 1) {
      signal?.throwIfAborted();
      let response: Response;
      const streamResponseTimeout = expectsStream ? createResponseTimeoutHandle(upstream.timeoutMs) : undefined;
      const timeoutSignal = streamResponseTimeout?.signal ?? AbortSignal.timeout(upstream.timeoutMs);

      try {
        response = await fetch(requestUrl, {
          method: 'POST',
          headers: buildRequestHeaders(upstream),
          body: requestBody,
          dispatcher,
          signal: signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal,
        });
      } catch (error) {
        streamResponseTimeout?.cancel();
        signal?.throwIfAborted();
        if (attempt < upstream.retry.attempts) {
          await sleep(upstream.retry.backoffMs, signal);
          continue;
        }

        throw upstreamRequestError(error, streamResponseTimeout, upstream.timeoutMs);
      }

      if (attempt < upstream.retry.attempts && shouldRetryStatus(upstream, response.status)) {
        await response.arrayBuffer().catch(() => undefined);
        streamResponseTimeout?.cancel();
        signal?.throwIfAborted();
        await sleep(upstream.retry.backoffMs, signal);
        continue;
      }

      const responseHeaders = copyResponseHeaders(response.headers);
      const contentType = response.headers.get('content-type') ?? '';
      const isEventStream = contentType.startsWith('text/event-stream');

      if (isEventStream && response.body) {
        streamResponseTimeout?.cancel();
        deferDispatcherCleanup = true;
        return {
          kind: 'stream',
          statusCode: response.status,
          headers: responseHeaders,
          body: attachDispatcherCleanup(
            attachStreamIdleTimeout(Readable.fromWeb(response.body as globalThis.ReadableStream), upstream.streamIdleTimeoutMs),
            dispatcher,
          ),
        };
      }

      // A stream request may receive JSON (including an error) instead of SSE.
      // Keep its response deadline active until that body has finished reading.
      try {
        return {
          kind: 'text',
          statusCode: response.status,
          headers: responseHeaders,
          body: await response.text(),
        };
      } catch (error) {
        signal?.throwIfAborted();
        throw upstreamRequestError(error, streamResponseTimeout, upstream.timeoutMs);
      } finally {
        streamResponseTimeout?.cancel();
      }
    }

    throw badGateway('Retry policy exhausted without a response', 'upstream_retry_exhausted');
  } finally {
    if (!deferDispatcherCleanup) {
      await closeDispatcher(dispatcher);
    }
  }
}
