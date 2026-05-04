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
            supports: { tools: true, vision: true },
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
