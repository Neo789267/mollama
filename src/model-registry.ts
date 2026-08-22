import { createHash } from 'node:crypto';
import { notFound } from './errors';
import type { ModelDefinition } from './types';

function registerModelReference(references: Map<string, ModelDefinition>, reference: string, model: ModelDefinition): void {
  const existing = references.get(reference);
  if (!existing) {
    references.set(reference, model);
    return;
  }

  throw new Error(`Model reference \"${reference}\" is ambiguous between \"${existing.id}\" and \"${model.id}\"`);
}

function buildModelReferences(models: ModelDefinition[]): Map<string, ModelDefinition> {
  const references = new Map<string, ModelDefinition>();
  for (const model of models) {
    registerModelReference(references, model.id, model);
    if (model.displayName !== model.id) {
      registerModelReference(references, model.displayName, model);
    }
  }

  return references;
}

function buildModelDigest(modelId: string): string {
  return `sha256:${createHash('sha256').update(modelId).digest('hex')}`;
}

// Matches what real Ollama reports for its cloud models; only used when a
// provider's upstream baseUrl cannot be parsed into an origin.
const FALLBACK_REMOTE_HOST = 'https://ollama.com:443';

function remoteHostOf(model: ModelDefinition): string {
  return model.remoteHost ?? FALLBACK_REMOTE_HOST;
}

function buildModelCapabilities(model: ModelDefinition): string[] {
  const capabilities = ['completion'];
  if (model.supports.tools) {
    capabilities.push('tools');
  }
  if (model.supports.vision) {
    capabilities.push('vision');
  }
  if (model.supports.thinking) {
    capabilities.push('thinking');
  }
  return capabilities;
}

function buildModelDetails(model: ModelDefinition): unknown {
  const family = model.family ?? 'proxy';
  return {
    parent_model: '',
    format: 'proxy',
    family,
    families: [family],
    parameter_size: 'unknown',
    quantization_level: 'unknown',
  };
}

export interface ModelRegistry {
  list(): readonly ModelDefinition[];
  find(modelReference: string): ModelDefinition | undefined;
  get(modelReference: string): ModelDefinition;
  buildTagsResponse(): unknown;
  buildShowResponse(model: ModelDefinition): unknown;
  buildPsResponse(): unknown;
}

export function validateModelReferences(models: ModelDefinition[]): void {
  buildModelReferences(models);
}

export function createModelRegistry(models: ModelDefinition[]): ModelRegistry {
  const modelReferences = buildModelReferences(models);
  const modelList = models.slice();

  return {
    list: () => modelList,
    find: (modelReference) => modelReferences.get(modelReference),
    get: (modelReference) => {
      const model = modelReferences.get(modelReference);
      if (!model) {
        throw notFound(`Unknown model: ${modelReference}`, 'unknown_model');
      }
      return model;
    },
    buildTagsResponse: () => ({
      models: modelList.map((model) => ({
        name: model.displayName,
        model: model.displayName,
        // Mark every model as remote-served, mirroring real Ollama cloud
        // entries. ollama-vscode treats such models as non-local and skips
        // its machine-context check, which would otherwise delay consumption
        // of the chat response stream — an unread fetch body can be torn down
        // by Node's GC, surfacing as "Did not receive done or success
        // response in stream.".
        remote_host: remoteHostOf(model),
        remote_model: model.targetModel,
        modified_at: new Date(0).toISOString(),
        size: 0,
        digest: buildModelDigest(model.id),
        capabilities: buildModelCapabilities(model),
        context_length: model.contextWindow,
        details: buildModelDetails(model),
      })),
    }),
    buildShowResponse: (model) => ({
      license: '',
      modelfile: `FROM ${model.targetModel}`,
      parameters: '',
      template: '',
      details: buildModelDetails(model),
      model_info: {
        'general.basename': model.displayName,
        'general.architecture': 'proxy',
        'proxy.context_length': model.contextWindow,
      },
      capabilities: buildModelCapabilities(model),
      remote_host: remoteHostOf(model),
      remote_model: model.targetModel,
    }),
    // Report every configured model as loaded, mirroring tags. context_length
    // feeds the client's context-window heuristics (the plugin warns below
    // 64K), not the upstream request; report at least that.
    buildPsResponse: () => ({
      models: modelList.map((model) => ({
        name: model.displayName,
        model: model.displayName,
        remote_host: remoteHostOf(model),
        remote_model: model.targetModel,
        modified_at: new Date(0).toISOString(),
        size: 0,
        digest: buildModelDigest(model.id),
        details: buildModelDetails(model),
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        size_vram: 0,
        context_length: Math.max(model.contextWindow, 64 * 1024),
      })),
    }),
  };
}
