const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, writeFileSync, mkdtempSync, rmSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { createServer } = require('node:http');
const { loadAppConfig } = require('../dist/config/load');
const { createModelRegistry } = require('../dist/model-registry');
const { buildUpstreamPayload } = require('../dist/provider-policy');
const { createAppServer } = require('../dist/server');

function fixture(t, edit = () => {}, upstreamPort = 1) {
  const directory = mkdtempSync(join(tmpdir(), 'mollama-thinking-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const models = JSON.parse(readFileSync(join(__dirname, '../config/models.json'), 'utf8'));
  delete models.proxyUrl;
  for (const provider of Object.values(models.providers)) {
    provider.upstream = { baseUrl: `http://127.0.0.1:${upstreamPort}/v1`, timeoutMs: 2000 };
  }
  edit(models);
  writeFileSync(join(directory, 'models.json'), JSON.stringify(models));
  const systemPath = join(directory, 'system.json');
  writeFileSync(systemPath, JSON.stringify({
    server: { host: '127.0.0.1', port: 0 }, modelsConfigPath: './models.json',
    frontends: {}, logging: { level: 'silent', logRequests: false, redactHeaders: [] },
  }));
  const config = loadAppConfig(systemPath);
  const registry = createModelRegistry(config.models.models);
  const payload = (id, request = {}) => buildUpstreamPayload(config.models.defaults, registry.get(id), {
    model: id, messages: [
      { role: 'user', content: 'previous question' },
      { role: 'assistant', content: 'previous answer' },
      { role: 'user', content: 'follow up' },
    ], ...request,
  });
  return { config, registry, payload };
}

test('single-model discovery advertises the full exact thinking contract, not hidden presets', t => {
  const { registry } = fixture(t);
  const tags = registry.buildTagsResponse().models;
  assert.equal(tags.length, 8);
  assert.equal(tags.filter(model => model.model.startsWith('deepseek')).length, 2);
  assert.ok(!tags.some(model => /thinking-high|thinking-max|-default$/.test(model.model)));
  for (const [id, values, defaultLevel] of [
    ['deepseek-flash', [false, 'low', 'high', 'max'], 'high'],
    ['deepseek-v4-pro', [false, 'low', 'high', 'max'], 'high'],
    ['kimi-for-coding', [false, 'low', 'high', 'max'], 'max'],
    ['kimi-k2-6-local', [false, true], true],
    ['kimi-k2-5-local', [false, true], true],
    ['kimi-k2-7-code-local', [true], true],
    ['mimo-v2-6-pro-local', [false, true], true],
    ['mimo-v2-6-flash-local', [false, true], true],
  ]) {
    assert.deepEqual(registry.buildShowResponse(registry.get(id)).thinking, { values, default: defaultLevel });
  }
});

test('DeepSeek levels switch requests and history without sticking between calls', t => {
  const { payload } = fixture(t);
  for (const level of ['low', 'high', 'max', false, 'high', undefined]) {
    const request = payload('deepseek-flash', level === undefined ? {} : { think: level });
    assert.equal(request.model, 'deepseek-flash');
    assert.equal(request.think, undefined);
    assert.equal(request.thinking.type, level === false ? 'disabled' : 'enabled');
    assert.equal(request.reasoning_effort, level === false ? undefined : level ?? 'high');
    assert.equal(request.messages[1].reasoning_content, level === false ? undefined : '');
  }
});

test('Kimi Code effort-only controls support off and do not emit the old thinking parameter', t => {
  const { payload } = fixture(t);
  for (const level of [undefined, 'low', false, 'high', 'max']) {
    const request = payload('kimi-for-coding', level === undefined ? {} : { think: level });
    assert.equal(request.thinking, undefined);
    assert.equal(request.reasoning_effort, level === false ? 'none' : level ?? 'max');
    assert.equal(request.messages[1].reasoning_content, level === false ? undefined : '');
  }
});

test('native OpenAI controls and provider-specific aliases take precedence over defaults', t => {
  const { payload } = fixture(t);
  assert.equal(payload('deepseek-flash', { reasoning_effort: 'xhigh' }).reasoning_effort, 'high');
  assert.equal(payload('kimi-for-coding', { reasoning_effort: 'xhigh' }).reasoning_effort, 'max');
  assert.equal(payload('deepseek-flash', { reasoning_effort: 'none' }).thinking.type, 'disabled');
  assert.equal(payload('kimi-for-coding', { thinking: { type: 'disabled' } }).reasoning_effort, 'none');
  assert.equal(payload('deepseek-flash', { think: false, reasoning_effort: 'max' }).reasoning_effort, undefined);
  assert.equal(payload('deepseek-flash', { thinking: { type: 'enabled' } }).reasoning_effort, 'high');
  assert.equal(payload('kimi-for-coding', { reasoning_effort: null }).reasoning_effort, 'max');
});

test('Kimi toggles use mode-dependent sampling; fixed-thinking K2.7 rejects unsupported controls', t => {
  const { payload } = fixture(t);
  for (const level of [true, false, true]) {
    const request = payload('kimi-k2-6-local', { think: level, temperature: 0.3 });
    assert.equal(request.thinking.type, level ? 'enabled' : 'disabled');
    assert.equal(request.temperature, level ? 1 : 0.6);
    assert.equal(request.reasoning_effort, undefined);
  }
  const fixed = payload('kimi-k2-7-code-local', { think: true });
  assert.equal(fixed.thinking, undefined);
  assert.equal(fixed.reasoning_effort, undefined);
  assert.equal(fixed.messages[1].reasoning_content, '');
  assert.equal(fixed.temperature, 1);
  for (const request of [{ think: false }, { think: 'high' }, { reasoning_effort: 'none' }, { reasoning_effort: 'max' }]) {
    assert.throws(() => payload('kimi-k2-7-code-local', request), /supports think values/);
  }
  assert.throws(() => payload('kimi-k2-6-local', { think: 'high' }), /supports think values/);
});

test('hidden legacy IDs keep preset defaults, accept explicit overrides, and never mutate canonical defaults', t => {
  const { registry, payload } = fixture(t);
  assert.equal(payload('deepseek-v4-flash-default').thinking.type, 'disabled');
  assert.equal(payload('deepseek-v4-flash-thinking-max').reasoning_effort, 'max');
  assert.equal(payload('DeepSeek V4 Flash High').reasoning_effort, 'high');
  assert.equal(payload('deepseek-v4-flash-thinking-max', { think: 'low' }).reasoning_effort, 'low');
  assert.equal(payload('deepseek-flash').reasoning_effort, 'high');
  assert.equal(registry.buildShowResponse(registry.get('deepseek-v4-flash-default')).thinking.default, false);
  assert.equal(registry.buildShowResponse(registry.get('deepseek-flash')).thinking.default, 'high');
});

test('preserves supplied reasoning and tool IDs, and strict history mode rejects missing reasoning', t => {
  const { payload } = fixture(t);
  const request = payload('deepseek-flash', { messages: [
    { role: 'assistant', content: '', reasoning_content: 'real reasoning', tool_calls: [{ id: 'tool-1', type: 'function', function: { name: 'lookup', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: 'tool-1', content: 'result' },
  ] });
  assert.equal(request.messages[0].reasoning_content, 'real reasoning');
  assert.equal(request.messages[0].tool_calls[0].id, request.messages[1].tool_call_id);
  const strict = fixture(t, models => { models.providers.deepseek.models[0].reasoningHistory.mode = 'require-present'; });
  assert.throws(() => strict.payload('deepseek-flash'), /requires reasoning_content/);
  assert.doesNotThrow(() => strict.payload('deepseek-flash', { think: false }));
});

test('invalid policies and ambiguous aliases fail during config loading', t => {
  for (const edit of [
    model => { model.thinking.default = 'medium'; },
    model => { model.maxTokensField = 'invalid'; },
    model => { model.thinking.values = []; },
    model => { model.thinking.values.push('high'); },
    model => { model.thinking.effortAliases.medium = 'unsupported'; },
    model => { model.thinking.values.push(''); },
    model => { model.thinking.mode = 'fixed'; },
    model => { model.parameters.thinking = { type: 'disabled' }; },
    model => { model.supports.thinking = false; },
    model => { model.reasoningHistory.mode = 'always'; },
    model => { model.aliases.push({ id: 'deepseek-v4-pro' }); },
    model => { model.aliases[0].thinking = 'unsupported'; },
    model => { model.payloadOverridesByThinking.enabled = { reasoning_effort: 'max' }; },
  ]) {
    assert.throws(() => fixture(t, models => edit(models.providers.deepseek.models[0])));
  }
});

test('MiMo boolean thinking, sampling, output budgets and legacy aliases follow the V2.6 contract', t => {
  const { payload } = fixture(t);
  for (const id of ['mimo-v2-6-pro-local', 'mimo-v2-6-flash-local']) {
    for (const think of [undefined, true, false, true]) {
      const request = payload(id, { ...(think === undefined ? {} : { think }), temperature: 0.2, top_p: 0.8, max_tokens: 32 });
      assert.equal(request.thinking.type, think === false ? 'disabled' : 'enabled');
      assert.equal(request.temperature, think === false ? 0.2 : 1);
      assert.equal(request.top_p, think === false ? 0.8 : 0.95);
      assert.equal(request.reasoning_effort, undefined);
      assert.equal(request.max_tokens, undefined);
      assert.equal(request.max_completion_tokens, 32);
      assert.equal(request.messages[1].reasoning_content, think === false ? undefined : '');
    }
    assert.equal(payload(id).max_completion_tokens, 131072);
    assert.equal(payload(id, { max_tokens: 999999 }).max_completion_tokens, 131072);
    assert.equal(payload(id, { max_completion_tokens: 16 }).max_completion_tokens, 16);
    assert.equal(payload(id, { max_tokens: 8, max_completion_tokens: 16 }).max_completion_tokens, 8);
    assert.equal(payload(id, { max_tokens: null, max_completion_tokens: null }).max_completion_tokens, 131072);
    for (const limit of [0, -1, 1.5, '32']) {
      assert.throws(() => payload(id, { max_completion_tokens: limit }), /positive integers/);
    }
    for (const think of ['low', 'high', 'max']) {
      assert.throws(() => payload(id, { think }), /supports think values/);
    }
    const history = payload(id, { messages: [{ role: 'assistant', content: '', reasoning_content: 'original reasoning', tool_calls: [] }] });
    assert.equal(history.messages[0].reasoning_content, 'original reasoning');
  }
  assert.equal(payload('mimo-v2-5-pro-local').model, 'mimo-v2.6-pro');
  assert.equal(payload('MiMo V2.5').model, 'mimo-v2.6-flash');
  assert.equal(payload('deepseek-flash', { max_tokens: 32 }).max_tokens, 32);
  assert.equal(payload('deepseek-flash').max_completion_tokens, undefined);
});

async function listen(server) {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return server.address().port;
}

test('HTTP discovery and Ollama/OpenAI requests honor one model with multiple thinking levels', async t => {
  const seen = [];
  const upstream = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    seen.push(JSON.parse(body));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }] }));
  });
  const upstreamPort = await listen(upstream);
  const { config } = fixture(t, undefined, upstreamPort);
  const app = createAppServer(config);
  const port = await listen(app);
  try {
    const tags = await (await fetch(`http://127.0.0.1:${port}/api/tags`)).json();
    assert.equal(tags.models.filter(model => model.model === 'deepseek-flash').length, 1);
    const post = (path, body) => fetch(`http://127.0.0.1:${port}${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const show = await (await post('/api/show', { model: 'deepseek-flash' })).json();
    assert.deepEqual(show.thinking, { values: [false, 'low', 'high', 'max'], default: 'high' });
    for (const think of show.thinking.values) {
      const response = await post('/api/chat', { model: 'deepseek-flash', think, stream: false, messages: [{ role: 'user', content: 'hello' }] });
      assert.equal(response.status, 200);
      await response.json();
      assert.equal(seen.at(-1).thinking.type, think === false ? 'disabled' : 'enabled');
      assert.equal(seen.at(-1).reasoning_effort, think === false ? undefined : think);
    }
    const native = await post('/v1/chat/completions', { model: 'kimi-for-coding', reasoning_effort: 'low', stream: false, messages: [] });
    assert.equal(native.status, 200);
    await native.json();
    assert.equal(seen.at(-1).reasoning_effort, 'low');
    assert.equal(seen.at(-1).thinking, undefined);
    for (const think of [true, false]) {
      const mimo = await post('/api/chat', { model: 'mimo-v2-6-pro-local', think, stream: false,
        options: { num_predict: 8, temperature: 0.2, top_p: 0.8 }, messages: [{ role: 'user', content: 'hello' }] });
      assert.equal(mimo.status, 200);
      await mimo.json();
      assert.equal(seen.at(-1).model, 'mimo-v2.6-pro');
      assert.equal(seen.at(-1).max_completion_tokens, 8);
      assert.equal(seen.at(-1).max_tokens, undefined);
      assert.equal(seen.at(-1).thinking.type, think ? 'enabled' : 'disabled');
    }
    const generate = await post('/api/generate', { model: 'mimo-v2-6-flash-local', think: false, stream: false,
      options: { num_predict: 4 }, prompt: 'hello' });
    assert.equal(generate.status, 200);
    await generate.json();
    assert.equal(seen.at(-1).max_completion_tokens, 4);
    assert.equal(seen.at(-1).thinking.type, 'disabled');
    const count = seen.length;
    for (const think of ['invalid', null, {}, 1, '']) {
      const response = await post('/api/chat', { model: 'deepseek-flash', think, stream: false, messages: [] });
      assert.equal(response.status, 400);
      await response.json();
    }
    assert.equal(seen.length, count);
  } finally {
    await new Promise(resolve => app.close(resolve));
    await new Promise(resolve => upstream.close(resolve));
  }
});
