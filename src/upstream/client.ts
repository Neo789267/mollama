import { buildUpstreamPayload } from '../provider-policy';
import { assertBadRequest, isJsonObject } from '../guards';
import type { AppConfig, FrontendProfile, JsonValue, ModelDefinition, UpstreamConfig } from '../types';
import type { ModelRegistry } from '../model-registry';
import { sendJsonRequestToUpstream, type UpstreamResult } from './transport';

type JsonObject = Record<string, JsonValue>;

function getModelUpstream(config: AppConfig, model: ModelDefinition): UpstreamConfig {
  const upstream = config.models.providers[model.provider]?.upstream;
  assertBadRequest(upstream !== undefined, `Model ${model.id} references unknown provider ${model.provider}`);
  return upstream;
}

function pickRequestModel(modelRegistry: ModelRegistry, payload: JsonObject): ModelDefinition {
  const requestModel = payload.model;
  assertBadRequest(typeof requestModel === 'string' && requestModel.length > 0, 'Request body must include a model');
  return modelRegistry.get(requestModel);
}

export interface ForwardedRequest {
  model: ModelDefinition;
  result: UpstreamResult;
}

export async function forwardOpenAIChatCompletions(
  config: AppConfig,
  modelRegistry: ModelRegistry,
  requestPayload: unknown,
  frontendProfile?: FrontendProfile,
): Promise<ForwardedRequest> {
  assertBadRequest(isJsonObject(requestPayload), 'Request body must be a JSON object');

  const model = pickRequestModel(modelRegistry, requestPayload);
  const upstreamPayload = buildUpstreamPayload(config.models.defaults, model, requestPayload, frontendProfile);
  const upstream = getModelUpstream(config, model);
  const result = await sendJsonRequestToUpstream(upstream, '/chat/completions', upstreamPayload);
  return { model, result };
}

export async function forwardOpenAIEmbeddings(
  config: AppConfig,
  modelRegistry: ModelRegistry,
  requestPayload: unknown,
): Promise<ForwardedRequest> {
  assertBadRequest(isJsonObject(requestPayload), 'Request body must be a JSON object');

  const model = pickRequestModel(modelRegistry, requestPayload);
  const upstream = getModelUpstream(config, model);

  const payload: JsonObject = {
    ...requestPayload,
    model: model.targetModel,
  };

  const result = await sendJsonRequestToUpstream(upstream, '/embeddings', payload);
  return { model, result };
}
