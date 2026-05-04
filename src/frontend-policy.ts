import type {
  FrontendProfile,
  FrontendToolGuidance,
  JsonValue,
  ModelRequestDefaults,
} from './types';
import { isRecord } from './guards';

type JsonObject = Record<string, JsonValue>;

export function getFrontendRequestDefaults(profile: FrontendProfile | undefined): ModelRequestDefaults {
  return profile?.requestDefaults ?? {};
}

export function getFrontendPayloadOverrides(profile: FrontendProfile | undefined): ModelRequestDefaults {
  return profile?.payloadOverrides ?? {};
}

function injectFrontendMessages(payload: JsonObject, profile: FrontendProfile): void {
  if (profile.messages.length === 0) {
    return;
  }

  const existingMessages = payload.messages;
  if (!Array.isArray(existingMessages)) {
    return;
  }

  const existingContents = new Set<string>();
  for (const message of existingMessages) {
    if (isRecord(message) && typeof message.content === 'string') {
      existingContents.add(message.content);
    }
  }

  const injectedMessages = profile.messages
    .filter((message) => !existingContents.has(message.content))
    .map((message) => ({
      role: message.role,
      content: message.content,
    }));

  if (injectedMessages.length === 0) {
    return;
  }

  let insertAt = 0;
  while (insertAt < existingMessages.length) {
    const candidate = existingMessages[insertAt];
    if (!isRecord(candidate) || candidate.role !== 'system') {
      break;
    }
    insertAt += 1;
  }

  payload.messages = [
    ...existingMessages.slice(0, insertAt),
    ...injectedMessages,
    ...existingMessages.slice(insertAt),
  ];
}

function tokenizeToolName(toolName: string): string[] {
  return toolName.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 0);
}

function isFileMutationToolName(toolName: string): boolean {
  const normalizedName = toolName.toLowerCase();
  const tokens = new Set(tokenizeToolName(toolName));
  const mutationVerbs = ['create', 'write', 'edit', 'update', 'replace', 'append', 'patch', 'apply'];
  const fileNouns = ['file', 'files', 'document', 'documents', 'artifact', 'artifacts'];
  const hasMutationVerb = mutationVerbs.some((token) => tokens.has(token));
  const hasFileNoun = fileNouns.some((token) => tokens.has(token));
  return normalizedName.includes('patch') || (hasMutationVerb && hasFileNoun);
}

function toolMatchesGuidance(toolName: string, guidance: FrontendToolGuidance): boolean {
  if (guidance.target === 'all-tools') {
    return true;
  }

  if (guidance.target === 'file-tools') {
    return isFileMutationToolName(toolName);
  }

  return guidance.toolNames?.includes(toolName) ?? false;
}

function appendToolDescription(existingDescription: string | undefined, additions: string[]): string | undefined {
  if (additions.length === 0) {
    return existingDescription;
  }

  const description = existingDescription?.trim() ?? '';
  const existingParagraphs = new Set(
    description
      .split(/\n{2,}/)
      .map((paragraph) => paragraph.trim())
      .filter((paragraph) => paragraph.length > 0),
  );

  const uniqueAdditions = additions.filter(
    (addition) => addition.length > 0 && !existingParagraphs.has(addition),
  );

  if (uniqueAdditions.length === 0) {
    return existingDescription;
  }

  return description.length > 0
    ? `${description}\n\n${uniqueAdditions.join('\n\n')}`
    : uniqueAdditions.join('\n\n');
}

function applyToolGuidance(payload: JsonObject, profile: FrontendProfile): void {
  if (profile.toolGuidance.length === 0) {
    return;
  }

  const tools = payload.tools;
  if (!Array.isArray(tools)) {
    return;
  }

  payload.tools = tools.map((tool) => {
    if (!isRecord(tool) || tool.type !== 'function' || !isRecord(tool.function)) {
      return tool;
    }

    const toolName = typeof tool.function.name === 'string' ? tool.function.name : undefined;
    if (!toolName) {
      return tool;
    }

    const additions = profile.toolGuidance
      .filter((guidance) => toolMatchesGuidance(toolName, guidance))
      .map((guidance) => guidance.descriptionSuffix.trim());

    const updatedDescription = appendToolDescription(
      typeof tool.function.description === 'string' ? tool.function.description : undefined,
      additions,
    );

    if (updatedDescription === tool.function.description) {
      return tool;
    }

    const updatedFunction: Record<string, JsonValue> = {
      ...tool.function,
    };

    if (updatedDescription === undefined) {
      delete updatedFunction.description;
    } else {
      updatedFunction.description = updatedDescription;
    }

    return {
      ...tool,
      function: updatedFunction,
    };
  });
}

export function applyFrontendProfile(payload: JsonObject, profile: FrontendProfile | undefined): void {
  if (!profile) {
    return;
  }

  injectFrontendMessages(payload, profile);
  applyToolGuidance(payload, profile);
}
