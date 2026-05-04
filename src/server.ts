import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AppConfig, FrontendProfile } from './types';
import { AppError, badGateway, badRequest, isAppError, notImplemented } from './errors';
import { Logger, redactHeaders } from './logging';
import { createModelRegistry, type ModelRegistry } from './model-registry';
import {
  normalizeOllamaChatToOpenAI,
  normalizeOllamaEmbedToOpenAI,
  normalizeOllamaEmbeddingsToOpenAI,
  normalizeOllamaGenerateToOpenAI,
} from './protocol/ollama-to-openai';
import {
  createOpenAIStreamToOllamaNdjson,
  mapOpenAITextToOllamaChat,
  mapOpenAITextToOllamaEmbed,
  mapOpenAITextToOllamaEmbeddings,
  mapOpenAITextToOllamaGenerate,
} from './protocol/openai-to-ollama';
import { forwardOpenAIChatCompletions, forwardOpenAIEmbeddings } from './upstream/client';
import {
  createReasoningCompatStream,
  mapReasoningCompatBody,
} from './protocol/reasoning-compat';

const MAX_BODY_SIZE = 10 * 1024 * 1024;

function sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
}

function sendError(response: ServerResponse, error: AppError): void {
  sendJson(response, error.statusCode, {
    error: error.expose ? error.message : 'Internal Server Error',
    code: error.code,
  });
}

function sendNotImplemented(response: ServerResponse, message: string): void {
  const error = notImplemented(message, 'endpoint_not_supported');
  sendJson(response, error.statusCode, { error: error.message, code: error.code });
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let totalSize = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalSize += buffer.length;
    if (totalSize > MAX_BODY_SIZE) {
      throw badRequest('Request body too large', 'body_too_large');
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function parseJsonBody(rawBody: string): unknown {
  if (!rawBody) {
    return {};
  }

  try {
    return JSON.parse(rawBody) as unknown;
  } catch {
    throw badRequest('Request body must be valid JSON', 'invalid_json');
  }
}

function resolveFrontendProfile(config: AppConfig, request: IncomingMessage): FrontendProfile | undefined {
  const userAgent = request.headers['user-agent'];
  if (typeof userAgent !== 'string' || userAgent.length === 0) {
    return undefined;
  }

  for (const profile of Object.values(config.system.frontends)) {
    if (profile.userAgentPattern && userAgent.includes(profile.userAgentPattern)) {
      return profile;
    }
  }

  return undefined;
}

interface RequestContext {
  config: AppConfig;
  logger: Logger;
  modelRegistry: ModelRegistry;
  request: IncomingMessage;
  response: ServerResponse;
  requestUrl: URL;
  requestId: string;
}

type RouteHandler = (context: RequestContext) => Promise<number>;

type RouteKey = string;
function routeKey(method: string, pathname: string): RouteKey {
  return `${method}:${pathname}`;
}

function buildVersionResponse(config: AppConfig): unknown {
  return { version: config.system.ollama.version };
}

async function handleHealthzRoute(context: RequestContext): Promise<number> {
  sendJson(context.response, 200, { status: 'ok' });
  return 200;
}

async function handleVersionRoute(context: RequestContext): Promise<number> {
  sendJson(context.response, 200, buildVersionResponse(context.config));
  return 200;
}

async function handleTagsRoute(context: RequestContext): Promise<number> {
  sendJson(context.response, 200, context.modelRegistry.buildTagsResponse());
  return 200;
}

async function handlePsRoute(context: RequestContext): Promise<number> {
  sendJson(context.response, 200, context.modelRegistry.buildPsResponse());
  return 200;
}

async function handleShowRoute(context: RequestContext): Promise<number> {
  const rawBody = await readBody(context.request);
  const parsedBody = parseJsonBody(rawBody) as { model?: string };
  const modelId = parsedBody.model;
  if (typeof modelId !== 'string' || modelId.length === 0) {
    throw badRequest('model is required', 'missing_model');
  }

  const model = context.modelRegistry.get(modelId);
  sendJson(context.response, 200, context.modelRegistry.buildShowResponse(model));
  return 200;
}

async function pipeOpenAIStreamAsOllama(
  context: RequestContext,
  streamBody: NodeJS.ReadableStream,
  modelName: string,
  mode: 'chat' | 'generate',
): Promise<number> {
  const outputBody = createOpenAIStreamToOllamaNdjson(streamBody as never, modelName, mode);
  context.response.writeHead(200, {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
  });

  outputBody.on('error', (error) => {
    const message = error instanceof Error ? error.message : String(error);
    context.logger.error('request.stream_error', { requestId: context.requestId, message });
    if (!context.response.headersSent) {
      sendError(context.response, badGateway(message, 'stream_write_failed'));
    } else {
      context.response.destroy();
    }
  });

  outputBody.pipe(context.response);
  return 200;
}

async function handleOllamaChatRoute(context: RequestContext): Promise<number> {
  const rawBody = await readBody(context.request);
  const parsedBody = parseJsonBody(rawBody);
  const frontendProfile = resolveFrontendProfile(context.config, context.request);
  const normalized = normalizeOllamaChatToOpenAI(parsedBody);

  const forwarded = await forwardOpenAIChatCompletions(context.config, context.modelRegistry, normalized.payload, frontendProfile);
  const visibleModel = forwarded.model.displayName;

  if (forwarded.result.kind === 'stream') {
    return pipeOpenAIStreamAsOllama(context, forwarded.result.body, visibleModel, 'chat');
  }

  context.response.writeHead(forwarded.result.statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
  });
  context.response.end(mapOpenAITextToOllamaChat(forwarded.result.body, visibleModel));
  return forwarded.result.statusCode;
}

async function handleOllamaGenerateRoute(context: RequestContext): Promise<number> {
  const rawBody = await readBody(context.request);
  const parsedBody = parseJsonBody(rawBody);
  const frontendProfile = resolveFrontendProfile(context.config, context.request);
  const normalized = normalizeOllamaGenerateToOpenAI(parsedBody);

  const forwarded = await forwardOpenAIChatCompletions(context.config, context.modelRegistry, normalized.payload, frontendProfile);
  const visibleModel = forwarded.model.displayName;

  if (forwarded.result.kind === 'stream') {
    return pipeOpenAIStreamAsOllama(context, forwarded.result.body, visibleModel, 'generate');
  }

  context.response.writeHead(forwarded.result.statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
  });
  context.response.end(mapOpenAITextToOllamaGenerate(forwarded.result.body, visibleModel));
  return forwarded.result.statusCode;
}

async function handleOllamaEmbedRoute(context: RequestContext): Promise<number> {
  const rawBody = await readBody(context.request);
  const parsedBody = parseJsonBody(rawBody);
  const normalized = normalizeOllamaEmbedToOpenAI(parsedBody);

  const forwarded = await forwardOpenAIEmbeddings(context.config, context.modelRegistry, normalized.payload);
  if (forwarded.result.kind === 'stream') {
    throw badGateway('Embedding endpoint must not return stream', 'invalid_upstream_embed_stream');
  }

  context.response.writeHead(forwarded.result.statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
  });
  context.response.end(mapOpenAITextToOllamaEmbed(forwarded.result.body, forwarded.model.displayName));
  return forwarded.result.statusCode;
}

async function handleOllamaEmbeddingsRoute(context: RequestContext): Promise<number> {
  const rawBody = await readBody(context.request);
  const parsedBody = parseJsonBody(rawBody);
  const normalized = normalizeOllamaEmbeddingsToOpenAI(parsedBody);

  const forwarded = await forwardOpenAIEmbeddings(context.config, context.modelRegistry, normalized.payload);
  if (forwarded.result.kind === 'stream') {
    throw badGateway('Embeddings endpoint must not return stream', 'invalid_upstream_embed_stream');
  }

  context.response.writeHead(forwarded.result.statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
  });
  context.response.end(mapOpenAITextToOllamaEmbeddings(forwarded.result.body));
  return forwarded.result.statusCode;
}

async function handleOpenAIChatCompletionsRoute(context: RequestContext): Promise<number> {
  const rawBody = await readBody(context.request);
  const parsedBody = parseJsonBody(rawBody);
  const frontendProfile = resolveFrontendProfile(context.config, context.request);

  const forwarded = await forwardOpenAIChatCompletions(context.config, context.modelRegistry, parsedBody, frontendProfile);
  const provider = context.config.models.providers[forwarded.model.provider];
  const upstreamField = provider?.thinkingField ?? 'reasoning_content';
  const clientField = frontendProfile?.reasoningCompat;

  if (forwarded.result.kind === 'stream') {
    const outputBody = createReasoningCompatStream(forwarded.result.body, upstreamField, clientField);
    context.response.writeHead(forwarded.result.statusCode, {
      'Content-Type': forwarded.result.headers['content-type'] ?? 'text/event-stream; charset=utf-8',
    });
    outputBody.pipe(context.response);
    return forwarded.result.statusCode;
  }

  const responseBody = mapReasoningCompatBody(forwarded.result.body, upstreamField, clientField);
  context.response.writeHead(forwarded.result.statusCode, {
    'Content-Type': forwarded.result.headers['content-type'] ?? 'application/json; charset=utf-8',
  });
  context.response.end(responseBody);
  return forwarded.result.statusCode;
}

async function handleNotImplementedRoute(context: RequestContext): Promise<number> {
  sendNotImplemented(context.response, 'This endpoint is not implemented in remote proxy mode');
  return 501;
}

const routeMap = new Map<RouteKey, RouteHandler>([
  [routeKey('GET', '/healthz'), handleHealthzRoute],
  [routeKey('GET', '/api/version'), handleVersionRoute],
  [routeKey('GET', '/api/tags'), handleTagsRoute],
  [routeKey('GET', '/api/ps'), handlePsRoute],
  [routeKey('POST', '/api/show'), handleShowRoute],
  [routeKey('POST', '/api/chat'), handleOllamaChatRoute],
  [routeKey('POST', '/api/generate'), handleOllamaGenerateRoute],
  [routeKey('POST', '/api/embed'), handleOllamaEmbedRoute],
  [routeKey('POST', '/api/embeddings'), handleOllamaEmbeddingsRoute],
  [routeKey('POST', '/v1/chat/completions'), handleOpenAIChatCompletionsRoute],

  [routeKey('POST', '/api/create'), handleNotImplementedRoute],
  [routeKey('POST', '/api/copy'), handleNotImplementedRoute],
  [routeKey('POST', '/api/pull'), handleNotImplementedRoute],
  [routeKey('POST', '/api/push'), handleNotImplementedRoute],
  [routeKey('DELETE', '/api/delete'), handleNotImplementedRoute],
]);

async function dispatchRoute(context: RequestContext): Promise<number> {
  const handler = routeMap.get(routeKey(context.request.method ?? '', context.requestUrl.pathname));
  if (handler) {
    return handler(context);
  }

  sendJson(context.response, 404, { error: 'Not found' });
  return 404;
}

export function createAppServer(config: AppConfig) {
  const logger = new Logger(config.system.logging);
  const modelRegistry = createModelRegistry(config.models.models);

  return createServer(async (request, response) => {
    const startedAt = Date.now();
    const requestId = typeof request.headers['x-request-id'] === 'string' ? request.headers['x-request-id'] : randomUUID();
    response.setHeader('x-request-id', requestId);

    if (config.system.logging.logRequests) {
      logger.info('request.start', {
        requestId,
        method: request.method,
        path: request.url,
        headers: redactHeaders(request.headers, config.system.logging.redactHeaders),
      });
    }

    let responseStatusCode = 500;
    try {
      const requestUrl = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`);
      responseStatusCode = await dispatchRoute({
        config,
        logger,
        modelRegistry,
        request,
        response,
        requestUrl,
        requestId,
      });
    } catch (error) {
      if (isAppError(error)) {
        responseStatusCode = error.statusCode;
        logger.error('request.error', { requestId, code: error.code, statusCode: error.statusCode, message: error.message });
        sendError(response, error);
      } else {
        const message = error instanceof Error ? error.message : String(error);
        responseStatusCode = 500;
        logger.error('request.error', { requestId, code: 'internal_error', statusCode: 500, message });
        sendError(response, new AppError(500, 'internal_error', message, { expose: false }));
      }
    } finally {
      if (config.system.logging.logRequests) {
        logger.info('request.finish', {
          requestId,
          statusCode: responseStatusCode,
          durationMs: Date.now() - startedAt,
        });
      }
    }
  });
}
