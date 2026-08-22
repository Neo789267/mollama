const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const targetRootDir = process.env.MOLLAMA_TEST_ROOT || 'C:\\tmp\\mollama';
const targetCliPath = path.join(targetRootDir, 'dist', 'cli.js');

if (!fs.existsSync(targetCliPath)) {
  console.error(`[start:test-env] Test environment not found at ${targetRootDir}. Run "npm run sync:test-env" first.`);
  process.exitCode = 1;
} else {
  const child = spawn(process.execPath, [targetCliPath, 'start', 'config/system.json'], {
    cwd: targetRootDir,
    stdio: 'inherit',
  });

  child.on('exit', (code) => {
    process.exitCode = code ?? 1;
  });
}
