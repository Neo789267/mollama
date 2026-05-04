import type { IncomingHttpHeaders } from 'node:http';
import type { LoggingConfig } from './types';

type LogMethod = (...data: unknown[]) => void;

const levelOrder: Record<LoggingConfig['level'], number> = {
  silent: 0,
  error: 1,
  info: 2,
  debug: 3,
};

function shouldLog(config: LoggingConfig, level: Exclude<LoggingConfig['level'], 'silent'>): boolean {
  return levelOrder[config.level] >= levelOrder[level];
}

function redactValue(value: string, enabled: boolean): string {
  return enabled ? '[REDACTED]' : value;
}

export function redactHeaders(headers: IncomingHttpHeaders | Record<string, string>, redactList: string[]): Record<string, string> {
  const redactSet = new Set(redactList.map((entry) => entry.toLowerCase()));
  const result: Record<string, string> = {};

  for (const [key, rawValue] of Object.entries(headers)) {
    if (rawValue === undefined) {
      continue;
    }

    const normalizedKey = key.toLowerCase();
    const stringValue = Array.isArray(rawValue) ? rawValue.join(',') : rawValue;
    result[normalizedKey] = redactValue(stringValue, redactSet.has(normalizedKey));
  }

  return result;
}

export class Logger {
  constructor(private readonly config: LoggingConfig) {}

  canLog(level: Exclude<LoggingConfig['level'], 'silent'>): boolean {
    return shouldLog(this.config, level);
  }

  private write(level: Exclude<LoggingConfig['level'], 'silent'>, method: LogMethod, event: string, fields: Record<string, unknown>): void {
    method(JSON.stringify({ ts: new Date().toISOString(), level, event, ...fields }));
  }

  error(event: string, fields: Record<string, unknown>): void {
    if (!this.canLog('error')) {
      return;
    }
    this.write('error', console.error, event, fields);
  }

  info(event: string, fields: Record<string, unknown>): void {
    if (!this.canLog('info')) {
      return;
    }
    this.write('info', console.log, event, fields);
  }

  debug(event: string, fields: Record<string, unknown>): void {
    if (!this.canLog('debug')) {
      return;
    }
    this.write('debug', console.debug, event, fields);
  }
}
