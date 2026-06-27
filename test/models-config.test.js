const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

function loadModelsConfig() {
  return JSON.parse(readFileSync(join(__dirname, '..', 'config', 'models.json'), 'utf8'));
}

test('Kimi K2.6, K2.7 Code, and K2.5 use the official thinking / reasoning-history settings', () => {
  const config = loadModelsConfig();
  const kimiModels = config.providers.kimi.models;

  const k26 = kimiModels.find((model) => model.id === 'kimi-k2-6-local');
  const k27 = kimiModels.find((model) => model.id === 'kimi-k2-7-code-local');
  const k25 = kimiModels.find((model) => model.id === 'kimi-k2-5-local');

  assert.ok(k26, 'expected Kimi K2.6 model entry');
  assert.ok(k25, 'expected Kimi K2.5 model entry');

  assert.equal(k26.targetModel, 'kimi-k2.6');
  assert.equal(k26.parameters.thinking.type, 'enabled');
  assert.deepEqual(k26.payloadOverridesByThinking.enabled, { temperature: 1 });
  assert.equal(k26.payloadOverridesByThinking.disabled.temperature, 0.6);
  assert.equal(k26.reasoningHistory.mode, 'inject-empty');

  assert.equal(k27.targetModel, 'kimi-k2.7-code');
  assert.deepEqual(k27.parameters, {});
  assert.equal(k27.payloadOverrides.temperature, undefined);
  assert.deepEqual(k27.payloadOverridesByThinking.enabled, { temperature: 1 });
  assert.equal(k27.payloadOverridesByThinking.disabled, undefined);
  assert.equal(k27.reasoningHistory.mode, 'always');

  // kimi-for-coding is a k2.7 variant and should use the same settings
  const kimiForCodingModels = config.providers['kimi-for-coding'].models;
  const kfc = kimiForCodingModels.find((model) => model.id === 'kimi-for-coding');
  assert.ok(kfc, 'expected kimi-for-coding model entry');
  assert.equal(kfc.targetModel, 'kimi-for-coding');
  assert.deepEqual(kfc.parameters, {});
  assert.equal(kfc.payloadOverrides.temperature, undefined);
  assert.deepEqual(kfc.payloadOverridesByThinking.enabled, { temperature: 1 });
  assert.equal(kfc.payloadOverridesByThinking.disabled, undefined);
  assert.equal(kfc.reasoningHistory.mode, 'always');

  assert.equal(k25.targetModel, 'kimi-k2.5');
  assert.equal(k25.parameters.thinking.type, 'enabled');
  assert.deepEqual(k25.payloadOverridesByThinking.enabled, { temperature: 1 });
  assert.equal(k25.payloadOverridesByThinking.disabled.temperature, 0.6);
  assert.equal(k25.reasoningHistory.mode, 'inject-empty');
});
