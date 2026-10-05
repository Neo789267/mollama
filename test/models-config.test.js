const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

function loadModelsConfig() {
  return JSON.parse(readFileSync(join(__dirname, '..', 'config', 'models.json'), 'utf8'));
}

test('MiMo V2.6 models keep Token Plan routing and use documented boolean thinking controls', () => {
  const provider = loadModelsConfig().providers.mimo;
  assert.equal(provider.upstream.baseUrl, 'https://token-plan-cn.xiaomimimo.com/v1');
  assert.equal(provider.upstream.apiKey, 'env:MIMO_API_KEY');
  assert.deepEqual(provider.models.map(model => model.targetModel), ['mimo-v2.6-pro', 'mimo-v2.6-flash']);
  for (const model of provider.models) {
    assert.equal(model.contextWindow, 1048576);
    assert.equal(model.maxOutputTokens, 131072);
    assert.equal(model.maxTokensField, 'max_completion_tokens');
    assert.deepEqual(model.supports, { tools: true, vision: true, thinking: true });
    assert.deepEqual(model.thinking, { mode: 'toggle', values: [false, true], default: true });
    assert.deepEqual(model.parameters, { temperature: 1, top_p: 0.95 });
    assert.deepEqual(model.payloadOverridesByThinking.enabled, { temperature: 1, top_p: 0.95 });
    assert.equal(model.payloadOverridesByThinking.disabled, undefined);
    assert.equal(model.reasoningHistory.mode, 'inject-empty');
  }
});

test('Kimi K2.6, K2.7 Code, and K2.5 use the official thinking / reasoning-history settings', () => {
  const config = loadModelsConfig();
  const kimiModels = config.providers.kimi.models;

  const k26 = kimiModels.find((model) => model.id === 'kimi-k2-6-local');
  const k27 = kimiModels.find((model) => model.id === 'kimi-k2-7-code-local');
  const k25 = kimiModels.find((model) => model.id === 'kimi-k2-5-local');

  assert.ok(k26, 'expected Kimi K2.6 model entry');
  assert.ok(k25, 'expected Kimi K2.5 model entry');

  assert.equal(k26.targetModel, 'kimi-k2.6');
  assert.deepEqual(k26.thinking, { mode: 'toggle', values: [false, true], default: true });
  assert.deepEqual(k26.parameters, {});
  assert.deepEqual(k26.payloadOverridesByThinking.enabled, { temperature: 1 });
  assert.equal(k26.payloadOverridesByThinking.disabled.temperature, 0.6);
  assert.equal(k26.reasoningHistory.mode, 'inject-empty');

  assert.equal(k27.targetModel, 'kimi-k2.7-code');
  assert.deepEqual(k27.parameters, {});
  assert.equal(k27.payloadOverrides.temperature, undefined);
  assert.deepEqual(k27.payloadOverridesByThinking.enabled, { temperature: 1 });
  assert.equal(k27.payloadOverridesByThinking.disabled, undefined);
  assert.equal(k27.reasoningHistory.mode, 'always');
  assert.deepEqual(k27.thinking, { mode: 'fixed', values: [true], default: true });

  // Kimi Code upgraded this stable ID to K2.8 Preview on 2026-09-11.
  const kimiForCodingModels = config.providers['kimi-for-coding'].models;
  const kfc = kimiForCodingModels.find((model) => model.id === 'kimi-for-coding');
  assert.ok(kfc, 'expected kimi-for-coding model entry');
  assert.equal(kfc.targetModel, 'kimi-for-coding');
  assert.deepEqual(kfc.parameters, {});
  assert.equal(kfc.payloadOverrides.temperature, undefined);
  assert.equal(kfc.thinking.mode, 'effort');
  assert.deepEqual(kfc.thinking.values, [false, 'low', 'high', 'max']);
  assert.equal(kfc.thinking.default, 'max');
  assert.equal(kfc.contextWindow, 1048576);
  assert.equal(kfc.payloadOverridesByThinking.enabled, undefined);
  assert.equal(kfc.payloadOverridesByThinking.disabled, undefined);
  assert.equal(kfc.reasoningHistory.mode, 'inject-empty');

  assert.equal(k25.targetModel, 'kimi-k2.5');
  assert.deepEqual(k25.thinking, { mode: 'toggle', values: [false, true], default: true });
  assert.deepEqual(k25.payloadOverridesByThinking.enabled, { temperature: 1 });
  assert.equal(k25.payloadOverridesByThinking.disabled.temperature, 0.6);
  assert.equal(k25.reasoningHistory.mode, 'inject-empty');
});
