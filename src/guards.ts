import type { JsonValue } from './types';
import { badRequest } from './errors';

export type JsonObject = Record<string, JsonValue>;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isJsonObject(value: unknown): value is JsonObject {
  return isRecord(value);
}

export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

export function assertBadRequest(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw badRequest(message);
  }
}

export function asString(value: unknown, fieldName: string): string {
  assert(typeof value === 'string' && value.length > 0, `${fieldName} must be a non-empty string`);
  return value;
}

export function asNumber(value: unknown, fieldName: string): number {
  assert(typeof value === 'number' && Number.isFinite(value), `${fieldName} must be a finite number`);
  return value;
}

export function asBoolean(value: unknown, fieldName: string): boolean {
  assert(typeof value === 'boolean', `${fieldName} must be a boolean`);
  return value;
}

export function asStringArray(value: unknown, fieldName: string): string[] {
  assert(Array.isArray(value), `${fieldName} must be an array of strings`);
  return value.map((entry, index) => asString(entry, `${fieldName}[${index}]`));
}

export function asNumberArray(value: unknown, fieldName: string): number[] {
  assert(Array.isArray(value), `${fieldName} must be an array of numbers`);
  return value.map((entry, index) => asNumber(entry, `${fieldName}[${index}]`));
}

export function asJsonRecord(value: unknown, fieldName: string): Record<string, JsonValue> {
  assert(isRecord(value), `${fieldName} must be an object`);
  return value as Record<string, JsonValue>;
}
