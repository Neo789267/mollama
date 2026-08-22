const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { createServer } = require('node:http');

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        throw new Error('Failed to resolve server address');
      }
      resolve(address.port);
    });
  });
}

function createTestConfig(tempDir, upstreamPort) {
  const systemPath = join(tempDir, 'system.json');
  const modelsPath = join(tempDir, 'models.json');

  writeFileSync(systemPath, JSON.stringify({
    server: { host: '127.0.0.1', port: 0 },
    ollama: { version: '0.8.1' },
    frontends: {
      copilot: {
        userAgentPattern: "GitHubCopilotChat",
        payloadOverrides: {
          max_tokens: 66,
        },
        messages: [],
        toolGuidance: [],
      },
    },
    modelsConfigPath: './models.json',
    logging: { level: 'silent', logRequests: false, redactHeaders: ['authorization'] },
  }, null, 2));

  writeFileSync(modelsPath, JSON.stringify({
    defaults: { stream: false },
    providers: {
      default: {
        upstream: {
          baseUrl: `http://127.0.0.1:${upstreamPort}/v1`,
          apiKey: 'inline-test-key',
          timeoutMs: 5000,
          retry: {
            attempts: 0,
            backoffMs: 0,
            retryOnStatusCodes: [429, 500, 502, 503, 504],
          },
          headers: {},
        },
        models: [
          {
            id: 'demo-model',
            displayName: 'Demo Model',
            targetModel: 'gpt-4.1',
            contextWindow: 64000,
            maxOutputTokens: 2048,
            family: 'demo-family',
            supports: { tools: true, vision: true, thinking: true },
            parameters: {},
            payloadOverrides: {},
            payloadOverridesByThinking: {},
            reasoningHistory: { mode: 'none' },
          },
        ],
      },
    },
  }, null, 2));

  return systemPath;
}

test('POST /api/chat maps Ollama request/response with non-stream mode', async () => {
  const { loadAppConfig } = require('../dist/config/load.js');
  const { createAppServer } = require('../dist/server.js');

  const tempDir = mkdtempSync(join(tmpdir(), 'mollama-chat-'));
  const upstream = createServer(async (req, res) => {
    let rawBody = '';
    for await (const chunk of req) {
      rawBody += chunk;
    }

    const requestJson = JSON.parse(rawBody);
    assert.equal(req.url, '/v1/chat/completions');
    assert.equal(requestJson.model, 'gpt-4.1');
    assert.equal(requestJson.max_tokens, 66);
    assert.equal(requestJson.messages[0].role, 'system');

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      id: 'chatcmpl_1',
      object: 'chat.completion',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: 'hello from upstream',
            reasoning_content: 'hidden thoughts',
          },
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: 12,
        completion_tokens: 7,
        total_tokens: 19,
      },
    }));
  });

  const upstreamPort = await listen(upstream);
  const systemPath = createTestConfig(tempDir, upstreamPort);

  const appConfig = loadAppConfig(systemPath);
  const app = createAppServer(appConfig);
  const appPort = await listen(app);

  try {
    const response = await fetch(`http://127.0.0.1:${appPort}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'GitHubCopilotChat/0.46.2',
      },
      body: JSON.stringify({
        model: 'Demo Model',
        stream: false,
        system: 'You are concise',
        messages: [{ role: 'user', content: 'hi' }],
        options: { num_predict: 88, temperature: 0.3 },
      }),
    });

    const json = await response.json();
    assert.equal(response.status, 200);
    assert.equal(json.model, 'Demo Model');
    assert.equal(json.message.role, 'assistant');
    assert.equal(json.message.content, 'hello from upstream');
    assert.equal(json.message.thinking, 'hidden thoughts');
    assert.equal(json.done, true);
    assert.equal(json.prompt_eval_count, 12);
    assert.equal(json.eval_count, 7);
  } finally {
    await new Promise((resolve) => app.close(resolve));
    await new Promise((resolve) => upstream.close(resolve));
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('POST /api/embed maps OpenAI embeddings response to Ollama embed format', async () => {
  const { loadAppConfig } = require('../dist/config/load.js');
  const { createAppServer } = require('../dist/server.js');

  const tempDir = mkdtempSync(join(tmpdir(), 'mollama-embed-'));
  const upstream = createServer(async (req, res) => {
    let rawBody = '';
    for await (const chunk of req) {
      rawBody += chunk;
    }

    const requestJson = JSON.parse(rawBody);
    assert.equal(req.url, '/v1/embeddings');
    assert.equal(requestJson.model, 'gpt-4.1');
    assert.deepEqual(requestJson.input, ['abc', 'xyz']);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      object: 'list',
      data: [
        { index: 0, embedding: [0.1, 0.2] },
        { index: 1, embedding: [0.3, 0.4] },
      ],
      usage: { prompt_tokens: 2, total_tokens: 2 },
    }));
  });

  const upstreamPort = await listen(upstream);
  const systemPath = createTestConfig(tempDir, upstreamPort);

  const appConfig = loadAppConfig(systemPath);
  const app = createAppServer(appConfig);
  const appPort = await listen(app);

  try {
    const response = await fetch(`http://127.0.0.1:${appPort}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'Demo Model',
        input: ['abc', 'xyz'],
      }),
    });

    const json = await response.json();
    assert.equal(response.status, 200);
    assert.equal(json.model, 'Demo Model');
    assert.deepEqual(json.embeddings, [[0.1, 0.2], [0.3, 0.4]]);
    assert.equal(json.prompt_eval_count, 2);
  } finally {
    await new Promise((resolve) => app.close(resolve));
    await new Promise((resolve) => upstream.close(resolve));
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('GET /api/tags exposes capabilities, context_length and family', async () => {
  const { loadAppConfig } = require('../dist/config/load.js');
  const { createAppServer } = require('../dist/server.js');

  const tempDir = mkdtempSync(join(tmpdir(), 'mollama-tags-'));
  const upstream = createServer((req, res) => {
    res.writeHead(500).end();
  });

  const upstreamPort = await listen(upstream);
  const systemPath = createTestConfig(tempDir, upstreamPort);

  const appConfig = loadAppConfig(systemPath);
  const app = createAppServer(appConfig);
  const appPort = await listen(app);

  try {
    const response = await fetch(`http://127.0.0.1:${appPort}/api/tags`);
    const json = await response.json();

    assert.equal(response.status, 200);
    assert.equal(json.models.length, 1);
    const model = json.models[0];
    assert.equal(model.name, 'Demo Model');
    assert.deepEqual(model.capabilities, ['completion', 'tools', 'vision', 'thinking']);
    assert.equal(model.context_length, 64000);
    assert.equal(model.details.family, 'demo-family');
    assert.deepEqual(model.details.families, ['demo-family']);
  } finally {
    await new Promise((resolve) => app.close(resolve));
    await new Promise((resolve) => upstream.close(resolve));
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('GET /api/experimental/model-recommendations returns empty list', async () => {
  const { loadAppConfig } = require('../dist/config/load.js');
  const { createAppServer } = require('../dist/server.js');

  const tempDir = mkdtempSync(join(tmpdir(), 'mollama-reco-'));
  const upstream = createServer((req, res) => {
    res.writeHead(500).end();
  });

  const upstreamPort = await listen(upstream);
  const systemPath = createTestConfig(tempDir, upstreamPort);

  const appConfig = loadAppConfig(systemPath);
  const app = createAppServer(appConfig);
  const appPort = await listen(app);

  try {
    const response = await fetch(`http://127.0.0.1:${appPort}/api/experimental/model-recommendations`);
    const json = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(json, { recommendations: [] });
  } finally {
    await new Promise((resolve) => app.close(resolve));
    await new Promise((resolve) => upstream.close(resolve));
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('POST /api/chat stream always terminates with done:true even without upstream finish_reason', async () => {
  const { loadAppConfig } = require('../dist/config/load.js');
  const { createAppServer } = require('../dist/server.js');

  const tempDir = mkdtempSync(join(tmpdir(), 'mollama-stream-done-'));
  const upstream = createServer(async (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    // Two content chunks, then straight to [DONE] with no finish_reason.
    res.write('data: {"choices":[{"index":0,"delta":{"role":"assistant","content":"hel"}}]}\n\n');
    res.write('data: {"choices":[{"index":0,"delta":{"content":"lo"}}]}\n\n');
    res.end('data: [DONE]\n\n');
  });

  const upstreamPort = await listen(upstream);
  const systemPath = createTestConfig(tempDir, upstreamPort);

  const appConfig = loadAppConfig(systemPath);
  const app = createAppServer(appConfig);
  const appPort = await listen(app);

  try {
    const response = await fetch(`http://127.0.0.1:${appPort}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'Demo Model',
        stream: true,
        messages: [{ role: 'user', content: 'hi' }],
      }),
    });

    assert.equal(response.status, 200);
    const text = await response.text();
    const chunks = text.trim().split('\n').map((line) => JSON.parse(line));

    assert.equal(chunks.length, 3);
    assert.equal(chunks[0].message.content, 'hel');
    assert.equal(chunks[0].done, false);
    assert.equal(chunks[1].message.content, 'lo');
    assert.equal(chunks[1].done, false);
    const last = chunks[chunks.length - 1];
    assert.equal(last.done, true);
    assert.equal(last.model, 'Demo Model');
  } finally {
    await new Promise((resolve) => app.close(resolve));
    await new Promise((resolve) => upstream.close(resolve));
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('POST /api/chat preserves tool_call id and maps tool result messages', async () => {
  const { loadAppConfig } = require('../dist/config/load.js');
  const { createAppServer } = require('../dist/server.js');

  const tempDir = mkdtempSync(join(tmpdir(), 'mollama-tools-'));
  const upstream = createServer(async (req, res) => {
    let rawBody = '';
    for await (const chunk of req) {
      rawBody += chunk;
    }

    const requestJson = JSON.parse(rawBody);
    const assistantMessage = requestJson.messages[0];
    assert.equal(assistantMessage.role, 'assistant');
    assert.equal(assistantMessage.tool_calls[0].id, 'call_ext_42');
    assert.equal(assistantMessage.tool_calls[0].function.name, 'get_weather');
    assert.equal(typeof assistantMessage.tool_calls[0].function.arguments, 'string');
    assert.deepEqual(JSON.parse(assistantMessage.tool_calls[0].function.arguments), { city: 'Paris' });

    const toolMessage = requestJson.messages[1];
    assert.equal(toolMessage.role, 'tool');
    assert.equal(toolMessage.tool_call_id, 'call_ext_42');
    assert.equal(toolMessage.content, 'sunny');

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'It is sunny.' },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
    }));
  });

  const upstreamPort = await listen(upstream);
  const systemPath = createTestConfig(tempDir, upstreamPort);

  const appConfig = loadAppConfig(systemPath);
  const app = createAppServer(appConfig);
  const appPort = await listen(app);

  try {
    const response = await fetch(`http://127.0.0.1:${appPort}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'Demo Model',
        stream: false,
        messages: [
          {
            role: 'assistant',
            content: '',
            tool_calls: [
              { id: 'call_ext_42', function: { name: 'get_weather', arguments: { city: 'Paris' } } },
            ],
          },
          { role: 'tool', tool_call_id: 'call_ext_42', content: 'sunny' },
        ],
      }),
    });

    const json = await response.json();
    assert.equal(response.status, 200);
    assert.equal(json.message.content, 'It is sunny.');
    assert.equal(json.done, true);
  } finally {
    await new Promise((resolve) => app.close(resolve));
    await new Promise((resolve) => upstream.close(resolve));
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('POST /api/chat maps think string level and boolean to thinking payload', async () => {
  const { loadAppConfig } = require('../dist/config/load.js');
  const { createAppServer } = require('../dist/server.js');

  const tempDir = mkdtempSync(join(tmpdir(), 'mollama-think-'));
  const seenThinking = [];
  const seenEffort = [];
  const upstream = createServer(async (req, res) => {
    let rawBody = '';
    for await (const chunk of req) {
      rawBody += chunk;
    }

    const requestJson = JSON.parse(rawBody);
    assert.equal(requestJson.think, undefined);
    seenThinking.push(requestJson.thinking);
    seenEffort.push(requestJson.reasoning_effort);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'ok' },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }));
  });

  const upstreamPort = await listen(upstream);
  const systemPath = createTestConfig(tempDir, upstreamPort);

  const appConfig = loadAppConfig(systemPath);
  const app = createAppServer(appConfig);
  const appPort = await listen(app);

  try {
    for (const think of ['high', false]) {
      const response = await fetch(`http://127.0.0.1:${appPort}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'Demo Model',
          stream: false,
          think,
          messages: [{ role: 'user', content: 'hi' }],
        }),
      });
      assert.equal(response.status, 200);
      await response.json();
    }

    assert.deepEqual(seenThinking[0], { type: 'enabled' });
    assert.equal(seenEffort[0], 'high');
    assert.deepEqual(seenThinking[1], { type: 'disabled' });
    assert.equal(seenEffort[1], undefined);
  } finally {
    await new Promise((resolve) => app.close(resolve));
    await new Promise((resolve) => upstream.close(resolve));
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('POST /api/chat forwards assistant history thinking as reasoning_content', async () => {
  const { loadAppConfig } = require('../dist/config/load.js');
  const { createAppServer } = require('../dist/server.js');

  const tempDir = mkdtempSync(join(tmpdir(), 'mollama-think-history-'));
  const upstream = createServer(async (req, res) => {
    let rawBody = '';
    for await (const chunk of req) {
      rawBody += chunk;
    }

    const requestJson = JSON.parse(rawBody);
    const assistantMessage = requestJson.messages[0];
    assert.equal(assistantMessage.role, 'assistant');
    assert.equal(assistantMessage.reasoning_content, 'previous thoughts');
    assert.equal(assistantMessage.thinking, undefined);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'answer' },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }));
  });

  const upstreamPort = await listen(upstream);
  const systemPath = createTestConfig(tempDir, upstreamPort);

  const appConfig = loadAppConfig(systemPath);
  const app = createAppServer(appConfig);
  const appPort = await listen(app);

  try {
    const response = await fetch(`http://127.0.0.1:${appPort}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'Demo Model',
        stream: false,
        messages: [
          { role: 'assistant', content: 'previous answer', thinking: 'previous thoughts' },
          { role: 'user', content: 'and now?' },
        ],
      }),
    });

    const json = await response.json();
    assert.equal(response.status, 200);
    assert.equal(json.message.content, 'answer');
  } finally {
    await new Promise((resolve) => app.close(resolve));
    await new Promise((resolve) => upstream.close(resolve));
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('POST /api/chat surfaces upstream error body instead of a fake success payload', async () => {
  const { loadAppConfig } = require('../dist/config/load.js');
  const { createAppServer } = require('../dist/server.js');

  const tempDir = mkdtempSync(join(tmpdir(), 'mollama-upstream-error-'));
  const upstream = createServer(async (req, res) => {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: { message: 'Invalid request: max_tokens exceeds limit', type: 'invalid_request_error' },
    }));
  });

  const upstreamPort = await listen(upstream);
  const systemPath = createTestConfig(tempDir, upstreamPort);

  const appConfig = loadAppConfig(systemPath);
  const app = createAppServer(appConfig);
  const appPort = await listen(app);

  try {
    const response = await fetch(`http://127.0.0.1:${appPort}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'Demo Model',
        stream: false,
        messages: [{ role: 'user', content: 'hi' }],
      }),
    });

    const json = await response.json();
    assert.equal(response.status, 400);
    assert.equal(json.error, 'Invalid request: max_tokens exceeds limit');
    assert.equal(json.done, undefined);
  } finally {
    await new Promise((resolve) => app.close(resolve));
    await new Promise((resolve) => upstream.close(resolve));
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('POST /api/chat sanitizes tool schemas without type: "object"', async () => {
  const { loadAppConfig } = require('../dist/config/load.js');
  const { createAppServer } = require('../dist/server.js');

  const tempDir = mkdtempSync(join(tmpdir(), 'mollama-tool-schema-'));
  const upstream = createServer(async (req, res) => {
    let rawBody = '';
    for await (const chunk of req) {
      rawBody += chunk;
    }

    const requestJson = JSON.parse(rawBody);
    assert.equal(requestJson.tools.length, 3);
    // type: null → coerced to object
    assert.deepEqual(requestJson.tools[0].function.parameters, { type: 'object', properties: {} });
    // missing parameters → synthesized
    assert.deepEqual(requestJson.tools[1].function.parameters, { type: 'object' });
    // valid schema → untouched
    assert.deepEqual(requestJson.tools[2].function.parameters, {
      type: 'object',
      properties: { city: { type: 'string' } },
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'ok' },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }));
  });

  const upstreamPort = await listen(upstream);
  const systemPath = createTestConfig(tempDir, upstreamPort);

  const appConfig = loadAppConfig(systemPath);
  const app = createAppServer(appConfig);
  const appPort = await listen(app);

  try {
    const response = await fetch(`http://127.0.0.1:${appPort}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'Demo Model',
        stream: false,
        messages: [{ role: 'user', content: 'run ls' }],
        tools: [
          { type: 'function', function: { name: 'terminal_last_command', description: 'd', parameters: { type: null, properties: {} } } },
          { type: 'function', function: { name: 'noop', description: 'd' } },
          { type: 'function', function: { name: 'get_weather', description: 'd', parameters: { type: 'object', properties: { city: { type: 'string' } } } } },
        ],
      }),
    });

    const json = await response.json();
    assert.equal(response.status, 200);
    assert.equal(json.message.content, 'ok');
  } finally {
    await new Promise((resolve) => app.close(resolve));
    await new Promise((resolve) => upstream.close(resolve));
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('POST /api/chat stream sends an error chunk when the upstream stream breaks mid-way', async () => {
  const { loadAppConfig } = require('../dist/config/load.js');
  const { createAppServer } = require('../dist/server.js');

  const tempDir = mkdtempSync(join(tmpdir(), 'mollama-stream-break-'));
  const upstream = createServer(async (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write('data: {"choices":[{"index":0,"delta":{"content":"hel"}}]}\n\n', () => {
      // Simulate a mid-stream connection failure: destroy the socket after
      // the first chunk has been flushed.
      res.socket.destroy();
    });
  });

  const upstreamPort = await listen(upstream);
  const systemPath = createTestConfig(tempDir, upstreamPort);

  const appConfig = loadAppConfig(systemPath);
  const app = createAppServer(appConfig);
  const appPort = await listen(app);

  try {
    const response = await fetch(`http://127.0.0.1:${appPort}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'Demo Model',
        stream: true,
        messages: [{ role: 'user', content: 'hi' }],
      }),
    });

    assert.equal(response.status, 200);
    const text = await response.text();
    const chunks = text.trim().split('\n').map((line) => JSON.parse(line));

    assert.equal(chunks[0].message.content, 'hel');
    const last = chunks[chunks.length - 1];
    assert.equal(typeof last.error, 'string');
    assert.ok(last.error.length > 0);
  } finally {
    await new Promise((resolve) => app.close(resolve));
    await new Promise((resolve) => upstream.close(resolve));
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('POST /api/chat aborts the upstream stream when the client disconnects', async () => {
  const { loadAppConfig } = require('../dist/config/load.js');
  const { createAppServer } = require('../dist/server.js');

  const tempDir = mkdtempSync(join(tmpdir(), 'mollama-client-abort-'));
  let resolveUpstreamClosed;
  const upstreamClosed = new Promise((resolve) => {
    resolveUpstreamClosed = resolve;
  });
  const upstream = createServer(async (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write('data: {"choices":[{"index":0,"delta":{"content":"hel"}}]}\n\n');
    res.on('close', () => {
      resolveUpstreamClosed(true);
    });
    // Never end the stream on our own.
  });

  const upstreamPort = await listen(upstream);
  const systemPath = createTestConfig(tempDir, upstreamPort);

  const appConfig = loadAppConfig(systemPath);
  const app = createAppServer(appConfig);
  const appPort = await listen(app);

  try {
    const controller = new AbortController();
    const response = await fetch(`http://127.0.0.1:${appPort}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: 'Demo Model',
        stream: true,
        messages: [{ role: 'user', content: 'hi' }],
      }),
    });

    assert.equal(response.status, 200);
    const reader = response.body.getReader();
    await reader.read();
    controller.abort();
    await reader.cancel().catch(() => {});

    const closed = await Promise.race([
      upstreamClosed,
      new Promise((resolve) => setTimeout(() => resolve(false), 3000)),
    ]);
    assert.equal(closed, true, 'upstream stream should be aborted after client disconnect');
  } finally {
    await new Promise((resolve) => app.close(resolve));
    await new Promise((resolve) => upstream.close(resolve));
    rmSync(tempDir, { recursive: true, force: true });
  }
});
