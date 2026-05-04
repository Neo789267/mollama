const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, execSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');
const distSourceDir = path.join(repoRoot, 'dist');
const configSourceDir = path.join(repoRoot, 'config');
const packageJsonSourcePath = path.join(repoRoot, 'package.json');
const packageLockSourcePath = path.join(repoRoot, 'package-lock.json');

const targetRootDir = process.env.MOLLAMA_TEST_ROOT || 'C:\\tmp\\mollama';
const targetDistDir = path.join(targetRootDir, 'dist');
const targetConfigDir = path.join(targetRootDir, 'config');
const targetSystemPath = path.join(targetConfigDir, 'system.json');
const targetModelsPath = path.join(targetConfigDir, 'models.json');
const targetKeysPath = path.join(targetRootDir, 'api-key', 'keys.txt');
const targetCliPath = path.join(targetDistDir, 'cli.js');
const targetPackageJsonPath = path.join(targetRootDir, 'package.json');
const targetPackageLockPath = path.join(targetRootDir, 'package-lock.json');

const providerAliasGroups = new Map([
  ['deepseek', ['deepseek', 'deepseekapikey', 'deepseekkey']],
  ['kimi', ['kimi', 'kimiapikey', 'moonshot', 'moonshotapikey', 'moonshotkey']],
  ['mimo', ['mimo', 'mimoapikey', 'xiaomi', 'xiaomimimo', 'xiaomimimoapikey', 'tokenplan']],
]);

function log(message) {
  console.log(`[sync:test-env] ${message}`);
}

function warn(message) {
  console.warn(`[sync:test-env] ${message}`);
}

function ensureExists(targetPath, label) {
  if (!fs.existsSync(targetPath)) {
    throw new Error(`${label} not found: ${targetPath}`);
  }
}

function stripWrappingQuotes(value) {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === '\'' && last === '\'')) {
      return value.slice(1, -1);
    }
  }

  return value;
}

function normalizeAlias(value) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function resolveProviderName(rawName) {
  const normalized = normalizeAlias(rawName);

  for (const [provider, aliases] of providerAliasGroups) {
    if (aliases.includes(normalized)) {
      return provider;
    }
  }

  return null;
}

function parseKeyFile(rawText, providerOrder) {
  const resolved = new Map();
  const warnings = [];
  const orderedValues = [];
  const namedValues = new Map();
  const trimmed = rawText.trim();

  if (!trimmed) {
    warnings.push(`No API keys found in ${targetKeysPath}; copied placeholders were kept.`);
    return { resolved, warnings };
  }

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        for (const value of parsed) {
          if (typeof value === 'string' && value.trim()) {
            orderedValues.push(stripWrappingQuotes(value.trim()));
          }
        }
      } else if (parsed && typeof parsed === 'object') {
        for (const [key, value] of Object.entries(parsed)) {
          if (value !== null && value !== undefined) {
            namedValues.set(key, String(value).trim());
          }
        }
      }
    } catch (error) {
      warnings.push(`Could not parse ${targetKeysPath} as JSON, falling back to line parsing: ${error.message}`);
    }
  }

  if (namedValues.size === 0 && orderedValues.length === 0) {
    const lines = rawText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && !line.startsWith('//') && !line.startsWith(';'));

    for (const line of lines) {
      const namedMatch = line.match(/^([A-Za-z0-9_.-]+)\s*[:=]\s*(.+)$/);
      if (namedMatch) {
        namedValues.set(namedMatch[1], stripWrappingQuotes(namedMatch[2].trim()));
      } else {
        orderedValues.push(stripWrappingQuotes(line));
      }
    }
  }

  for (const [rawName, rawValue] of namedValues) {
    const providerName = resolveProviderName(rawName);
    if (!providerName) {
      warnings.push(`Ignoring unrecognized key entry "${rawName}" in ${targetKeysPath}.`);
      continue;
    }

    if (rawValue) {
      resolved.set(providerName, rawValue);
    }
  }

  const remainingProviders = providerOrder.filter((provider) => !resolved.has(provider));
  if (orderedValues.length > 0) {
    for (const [index, provider] of remainingProviders.entries()) {
      const value = orderedValues[index];
      if (!value) {
        break;
      }

      resolved.set(provider, value);
    }

    if (orderedValues.length > remainingProviders.length) {
      warnings.push(`Found ${orderedValues.length} unnamed keys in ${targetKeysPath}, but only ${remainingProviders.length} provider slots were available.`);
    } else if (namedValues.size === 0) {
      warnings.push(`Assigned unnamed keys from ${targetKeysPath} by provider order: ${remainingProviders.join(', ')}.`);
    }
  }

  return { resolved, warnings };
}

function copyDirectory(sourceDir, targetDir) {
  fs.cpSync(sourceDir, targetDir, { recursive: true });
}

function copyFile(sourcePath, targetPath) {
  fs.copyFileSync(sourcePath, targetPath);
}

function replaceApiKeys() {
  ensureExists(targetModelsPath, 'Target models config');

  const modelsConfig = JSON.parse(fs.readFileSync(targetModelsPath, 'utf8'));
  const providers = modelsConfig.providers || {};
  const providerOrder = Object.keys(providers);

  if (providerOrder.length === 0) {
    warn(`No providers found in ${targetModelsPath}; skipping API key replacement.`);
    return [];
  }

  let rawKeysText = '';
  if (fs.existsSync(targetKeysPath)) {
    rawKeysText = fs.readFileSync(targetKeysPath, 'utf8');
  } else {
    warn(`Key file not found at ${targetKeysPath}; copied placeholders were kept.`);
  }

  const { resolved, warnings } = parseKeyFile(rawKeysText, providerOrder);
  for (const message of warnings) {
    warn(message);
  }

  const updatedProviders = [];
  for (const provider of providerOrder) {
    const key = resolved.get(provider);
    if (!key) {
      continue;
    }

    providers[provider].upstream.apiKey = key;
    updatedProviders.push(provider);
  }

  fs.writeFileSync(targetModelsPath, `${JSON.stringify(modelsConfig, null, 2)}\n`, 'utf8');
  return updatedProviders;
}

function validateCopiedConfig() {
  ensureExists(targetCliPath, 'Target CLI');
  log(`Validating copied config with ${targetCliPath}`);
  execFileSync(process.execPath, [targetCliPath, 'validate-config', '--config', targetSystemPath], {
    cwd: targetRootDir,
    stdio: 'inherit',
  });
}

function main() {
  ensureExists(distSourceDir, 'Built dist directory');
  ensureExists(configSourceDir, 'Config directory');
  ensureExists(packageJsonSourcePath, 'Source package.json');

  fs.mkdirSync(targetRootDir, { recursive: true });

  log(`Removing ${targetDistDir}`);
  fs.rmSync(targetDistDir, { recursive: true, force: true });
  log(`Removing ${targetConfigDir}`);
  fs.rmSync(targetConfigDir, { recursive: true, force: true });

  log(`Copying ${distSourceDir} -> ${targetDistDir}`);
  copyDirectory(distSourceDir, targetDistDir);
  log(`Copying ${configSourceDir} -> ${targetConfigDir}`);
  copyDirectory(configSourceDir, targetConfigDir);
  log(`Copying ${packageJsonSourcePath} -> ${targetPackageJsonPath}`);
  copyFile(packageJsonSourcePath, targetPackageJsonPath);
  if (fs.existsSync(packageLockSourcePath)) {
    log(`Copying ${packageLockSourcePath} -> ${targetPackageLockPath}`);
    copyFile(packageLockSourcePath, targetPackageLockPath);
  }

  const targetNodeModules = path.join(targetRootDir, 'node_modules');
  if (fs.existsSync(targetNodeModules)) {
    log(`Dependencies already installed in ${targetRootDir}; skipping install`);
  } else {
    log(`Installing dependencies in ${targetRootDir}`);
    execSync('npx npm install --omit=dev', {
      cwd: targetRootDir,
      stdio: 'inherit',
    });
  }

  const updatedProviders = replaceApiKeys();
  if (updatedProviders.length > 0) {
    log(`Replaced apiKey values for: ${updatedProviders.join(', ')}`);
  } else {
    warn('No apiKey values were replaced.');
  }

  validateCopiedConfig();
  log(`Test environment is ready at ${targetRootDir}`);
}

try {
  main();
} catch (error) {
  console.error(`[sync:test-env] ${error.message}`);
  process.exitCode = 1;
}
