import { PassThrough, Readable } from 'node:stream';
import { ProxyAgent, fetch } from 'undici';
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

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
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

function createProxyAgent(upstream: UpstreamConfig): ProxyAgent | undefined {
  return upstream.proxyUrl ? new ProxyAgent(upstream.proxyUrl) : undefined;
}

async function closeProxyAgent(proxyAgent: ProxyAgent | undefined): Promise<void> {
  if (!proxyAgent) {
    return;
  }
  await proxyAgent.close();
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

function attachProxyCleanup(body: Readable, proxyAgent: ProxyAgent | undefined): Readable {
  if (!proxyAgent) {
    return body;
  }

  let closed = false;
  const cleanup = () => {
    if (closed) {
      return;
    }

    closed = true;
    void closeProxyAgent(proxyAgent).catch(() => undefined);
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
): Promise<UpstreamResult> {
  const expectsStream = payload.stream === true;
  const requestUrl = `${upstream.baseUrl}${path}`;
  const requestBody = JSON.stringify(payload);
  const proxyAgent = createProxyAgent(upstream);
  let deferProxyAgentCleanup = false;

  try {
    for (let attempt = 0; attempt <= upstream.retry.attempts; attempt += 1) {
      let response: Response;
      const streamResponseTimeout = expectsStream ? createResponseTimeoutHandle(upstream.timeoutMs) : undefined;

      try {
        response = await fetch(requestUrl, {
          method: 'POST',
          headers: buildRequestHeaders(upstream),
          body: requestBody,
          dispatcher: proxyAgent,
          signal: streamResponseTimeout?.signal ?? AbortSignal.timeout(upstream.timeoutMs),
        });
      } catch (error) {
        streamResponseTimeout?.cancel();
        if (attempt < upstream.retry.attempts) {
          await sleep(upstream.retry.backoffMs);
          continue;
        }

        if ((streamResponseTimeout?.didTimeout() ?? false) || (error instanceof Error && error.name === 'TimeoutError')) {
          throw gatewayTimeout(`Upstream request timed out after ${upstream.timeoutMs}ms`, 'upstream_timeout');
        }

        throw badGateway(error instanceof Error ? error.message : String(error), 'upstream_request_failed');
      }

      streamResponseTimeout?.cancel();

      if (attempt < upstream.retry.attempts && shouldRetryStatus(upstream, response.status)) {
        await response.arrayBuffer().catch(() => undefined);
        await sleep(upstream.retry.backoffMs);
        continue;
      }

      const responseHeaders = copyResponseHeaders(response.headers);
      const contentType = response.headers.get('content-type') ?? '';
      const isEventStream = contentType.startsWith('text/event-stream');

      if (isEventStream && response.body) {
        deferProxyAgentCleanup = true;
        return {
          kind: 'stream',
          statusCode: response.status,
          headers: responseHeaders,
          body: attachProxyCleanup(
            attachStreamIdleTimeout(Readable.fromWeb(response.body as globalThis.ReadableStream), upstream.streamIdleTimeoutMs),
            proxyAgent,
          ),
        };
      }

      return {
        kind: 'text',
        statusCode: response.status,
        headers: responseHeaders,
        body: await response.text(),
      };
    }

    throw badGateway('Retry policy exhausted without a response', 'upstream_retry_exhausted');
  } finally {
    if (!deferProxyAgentCleanup) {
      await closeProxyAgent(proxyAgent);
    }
  }
}
