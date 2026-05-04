#!/usr/bin/env node

import type { Server } from 'node:http';
import { basename } from 'node:path';
import { loadAppConfig, initConfig } from './config/load';
import { createAppServer } from './server';

interface ParsedArgs {
  command: 'start' | 'validate-config' | 'init' | 'help';
  configPath: string;
  targetDirectory: string;
}

export function parseArgs(argv: string[]): ParsedArgs {
  let command: ParsedArgs['command'] = 'start';
  let configPath = 'config/system.json';
  let targetDirectory = '.';

  const positional: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (!current) {
      continue;
    }

    if (current === '--config') {
      const next = argv[index + 1];
      if (!next) {
        throw new Error('--config requires a file path');
      }
      configPath = next;
      index += 1;
      continue;
    }

    positional.push(current);
  }

  if (positional[0] === 'validate-config') {
    command = 'validate-config';
  } else if (positional[0] === 'init') {
    command = 'init';
    if (positional[1]) {
      targetDirectory = positional[1];
    }
  } else if (positional[0] === 'help' || positional[0] === '--help' || positional[0] === '-h') {
    command = 'help';
  }

  return {
    command,
    configPath,
    targetDirectory,
  };
}

function printHelp(): void {
  const scriptName = basename(process.argv[1] ?? 'mollama');
  console.log(`Usage: ${scriptName} [start|validate-config|init] [options]\n`);
  console.log('Commands:');
  console.log('  start                Start the proxy server (default)');
  console.log('  validate-config      Load and validate config files');
  console.log('  init [directory]     Create minimal system.json and models.json');
  console.log('');
  console.log('Options:');
  console.log('  --config <path>      Path to system config (default: config/system.json)');
}

function listenServer(server: Server, host: string, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      server.off('listening', onListening);
      reject(error);
    };

    const onListening = () => {
      server.off('error', onError);
      resolve();
    };

    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

const SHUTDOWN_TIMEOUT_MS = 30_000;

function registerShutdownHandlers(server: Server): void {
  const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
  const handlers = new Map<NodeJS.Signals, () => void>();

  const cleanupHandlers = () => {
    for (const [signal, handler] of handlers) {
      process.off(signal, handler);
    }
    handlers.clear();
  };

  const shutdown = (signal: NodeJS.Signals) => {
    if (!server.listening) {
      return;
    }

    const forceExitTimer = setTimeout(() => {
      console.error(`Server did not shut down within ${SHUTDOWN_TIMEOUT_MS}ms, forcing exit`);
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forceExitTimer.unref();

    void closeServer(server)
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Failed to stop server on ${signal}: ${message}`);
        process.exitCode = 1;
      })
      .finally(cleanupHandlers);
  };

  for (const signal of signals) {
    const handler = () => shutdown(signal);
    handlers.set(signal, handler);
    process.once(signal, handler);
  }

  server.once('close', cleanupHandlers);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.command === 'help') {
    printHelp();
    return;
  }

  if (args.command === 'init') {
    const result = initConfig(args.targetDirectory);
    console.log(`Created ${result.systemConfigPath}`);
    console.log(`Created ${result.modelsConfigPath}`);
    return;
  }

  const config = loadAppConfig(args.configPath);

  if (args.command === 'validate-config') {
    console.log(`Validated ${config.systemConfigPath}`);
    console.log(`Validated ${config.modelsConfigPath}`);
    console.log(`Loaded ${config.models.models.length} model definition(s)`);
    console.log(`Configured frontend profile(s): ${Object.keys(config.system.frontends).length}`);
    for (const model of config.models.models) {
      const flags: string[] = [];
      if (model.reasoningHistory.mode !== 'none') {
        flags.push(`reasoning-history:${model.reasoningHistory.mode}`);
      }
      if (model.supports.tools) {
        flags.push('tools');
      }
      if (model.supports.vision) {
        flags.push('vision');
      }
      const flagSummary = flags.length > 0 ? ` [${flags.join(', ')}]` : '';
      console.log(`  ${model.displayName} -> ${model.targetModel} (provider: ${model.provider})${flagSummary}`);
    }
    return;
  }

  const server = createAppServer(config);
  registerShutdownHandlers(server);
  await listenServer(server, config.system.server.host, config.system.server.port);

  console.log(`mollama listening on http://${config.system.server.host}:${config.system.server.port}`);
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  });
}
