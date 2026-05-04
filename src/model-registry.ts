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

function buildModelCapabilities(model: ModelDefinition): string[] {
  const capabilities = ['completion'];
  if (model.supports.tools) {
    capabilities.push('tools');
  }
  if (model.supports.vision) {
    capabilities.push('vision');
  }
  return capabilities;
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
        modified_at: new Date(0).toISOString(),
        size: 0,
        digest: buildModelDigest(model.id),
        details: {
          parent_model: '',
          format: 'proxy',
          family: 'proxy',
          families: ['proxy'],
          parameter_size: 'unknown',
          quantization_level: 'unknown',
        },
      })),
    }),
    buildShowResponse: (model) => ({
      license: '',
      modelfile: `FROM ${model.targetModel}`,
      parameters: '',
      template: '',
      details: {
        parent_model: '',
        format: 'proxy',
        family: 'proxy',
        families: ['proxy'],
        parameter_size: 'unknown',
        quantization_level: 'unknown',
      },
      model_info: {
        'general.basename': model.displayName,
        'general.architecture': 'proxy',
        'proxy.context_length': model.contextWindow,
      },
      capabilities: buildModelCapabilities(model),
      remote_model: model.targetModel,
    }),
    buildPsResponse: () => ({
      models: [],
    }),
  };
}
