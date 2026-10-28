const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const Module = require('node:module');
const undici = require('undici');

// Compress Undici's inherited five-minute defaults so regressions fail in seconds.
// The configured production dispatcher must explicitly override those defaults.
const inheritedTimeouts = { headersTimeout: 100, bodyTimeout: 100 };
const originalDispatcher = undici.getGlobalDispatcher();
const inheritedDispatcher = new undici.Agent(inheritedTimeouts);
undici.setGlobalDispatcher(inheritedDispatcher);
const originalLoad = Module._load;
Module._load = function (id, parent, isMain) {
  if (id === 'undici') {
    return {
      ...undici,
      Agent: class extends undici.Agent {
        constructor(options) { super({ ...inheritedTimeouts, ...options }); }
      },
      ProxyAgent: class extends undici.ProxyAgent {
        constructor(options) {
          super({ ...inheritedTimeouts, ...(typeof options === 'string' ? { uri: options } : options) });
        }
      },
    };
  }
  return originalLoad.call(this, id, parent, isMain);
};
let sendJsonRequestToUpstream;
try {
  ({ sendJsonRequestToUpstream } = require('../dist/upstream/transport'));
} finally {
  Module._load = originalLoad;
}
test.after(async () => {
  undici.setGlobalDispatcher(originalDispatcher);
  await inheritedDispatcher.destroy();
});

async function serve(t, handler) {
  const server = http.createServer(handler);
  const sockets = new Set();
  server.on('connection', socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => server.close(resolve));
  });
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}

async function proxy(t) {
  const { server, url } = await serve(t);
  server.on('connect', (req, client, head) => {
    const [host, port] = req.url.split(':');
    const remote = net.connect(Number(port), host, () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) remote.write(head);
      client.pipe(remote).pipe(client);
    });
    client.on('close', () => remote.destroy());
    remote.on('close', () => client.destroy());
    client.on('error', () => remote.destroy());
    remote.on('error', () => client.destroy());
  });
  return url;
}

function upstream(baseUrl, overrides = {}) {
  return { baseUrl, timeoutMs: 1000, streamIdleTimeoutMs: 0, headers: {},
    retry: { attempts: 0, backoffMs: 0, retryOnStatusCodes: [503] }, ...overrides };
}

test('already cancelled requests never reach upstream', async t => {
  let requests = 0;
  const { url } = await serve(t, (req, res) => { requests++; res.end('{}'); });
  await assert.rejects(sendJsonRequestToUpstream(upstream(url), '/chat/completions', { stream: true }, AbortSignal.abort()), { name: 'AbortError' });
  assert.equal(requests, 0);
});

test('cancellation interrupts retry backoff without another attempt', { timeout: 5000 }, async t => {
  let requests = 0;
  let notifyResponded;
  const responded = new Promise(resolve => { notifyResponded = resolve; });
  const { url } = await serve(t, (req, res) => {
    requests++;
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end('{}', notifyResponded);
  });
  const controller = new AbortController();
  const pending = sendJsonRequestToUpstream(upstream(url, {
    retry: { attempts: 2, backoffMs: 10000, retryOnStatusCodes: [503] },
  }), '/chat/completions', { stream: true }, controller.signal);
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  await responded;
  await new Promise(resolve => setTimeout(resolve, 50));
  controller.abort();
  await rejected;
  assert.equal(requests, 1);
});

test('cancellation closes an incomplete JSON response', { timeout: 5000 }, async t => {
  let notifyClosed;
  let notifyStarted;
  const closed = new Promise(resolve => { notifyClosed = resolve; });
  const started = new Promise(resolve => { notifyStarted = resolve; });
  const { url } = await serve(t, (req, res) => {
    res.once('close', notifyClosed);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.write('{', notifyStarted);
  });
  const controller = new AbortController();
  const pending = sendJsonRequestToUpstream(upstream(url), '/chat/completions', { stream: true }, controller.signal);
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  await started;
  controller.abort();
  await rejected;
  await closed;
});

async function text(body) {
  let result = '';
  for await (const chunk of body) result += chunk;
  return result;
}

for (const useProxy of [false, true]) {
  test(`cancellation before headers closes ${useProxy ? 'proxy' : 'direct'} connection`, { timeout: 5000 }, async t => {
    let notifyStarted;
    let notifyClosed;
    const started = new Promise(resolve => { notifyStarted = resolve; });
    const closed = new Promise(resolve => { notifyClosed = resolve; });
    const { url } = await serve(t, (req, res) => {
      req.resume();
      res.once('close', notifyClosed);
      notifyStarted();
    });
    const proxyUrl = useProxy ? await proxy(t) : undefined;
    const controller = new AbortController();
    const pending = sendJsonRequestToUpstream(upstream(url, { proxyUrl }), '/chat/completions', { stream: true }, controller.signal);
    const rejected = assert.rejects(pending, { name: 'AbortError' });
    await started;
    controller.abort();
    await rejected;
    await closed;
  });

  test(`stream survives inherited body timeout over ${useProxy ? 'HTTP CONNECT proxy' : 'direct connection'}`, { timeout: 10000 }, async t => {
    const { url } = await serve(t, (req, res) => {
      req.resume();
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write('data: first\n\n');
      const timer = setTimeout(() => res.end('data: last\n\n'), 1800);
      res.on('close', () => clearTimeout(timer));
    });
    const proxyUrl = useProxy ? await proxy(t) : undefined;
    const result = await sendJsonRequestToUpstream(upstream(url, { proxyUrl }), '/chat/completions', { stream: true });
    assert.equal(result.kind, 'stream');
    assert.equal(await text(result.body), 'data: first\n\ndata: last\n\n');
  });
}

test('configured stream idle deadline still closes an inactive upstream', { timeout: 5000 }, async t => {
  let closed;
  const closedPromise = new Promise(resolve => { closed = resolve; });
  const { url } = await serve(t, (req, res) => {
    req.resume();
    res.on('close', closed);
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write('data: first\n\n');
  });
  const result = await sendJsonRequestToUpstream(upstream(url, { streamIdleTimeoutMs: 100 }), '/chat/completions', { stream: true });
  await assert.rejects(text(result.body), /100ms without data/);
  await closedPromise;
});

test('active chunks refresh the idle deadline beyond the initial response timeout', { timeout: 5000 }, async t => {
  const { url } = await serve(t, (req, res) => {
    req.resume();
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write('data: first\n\n');
    let count = 0;
    const timer = setInterval(() => {
      res.write('data: tick\n\n');
      if (++count === 8) res.end();
    }, 40);
    res.on('close', () => clearInterval(timer));
  });
  const result = await sendJsonRequestToUpstream(upstream(url, { timeoutMs: 150, streamIdleTimeoutMs: 200 }), '/chat/completions', { stream: true });
  assert.equal((await text(result.body)).match(/tick/g).length, 8);
});

test('stream response headers still obey the configured response deadline', { timeout: 5000 }, async t => {
  const { url } = await serve(t, req => req.resume());
  await assert.rejects(
    sendJsonRequestToUpstream(upstream(url, { timeoutMs: 100 }), '/chat/completions', { stream: true }),
    error => error.statusCode === 504 && error.code === 'upstream_timeout',
  );
});

for (const stream of [true, false]) {
  test(`incomplete JSON body keeps its response deadline (stream=${stream})`, { timeout: 5000 }, async t => {
    const { url } = await serve(t, (req, res) => {
      req.resume();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.write('{');
    });
    await assert.rejects(
      sendJsonRequestToUpstream(upstream(url, { timeoutMs: 100 }), '/chat/completions', { stream }),
      error => error.statusCode === 504 && error.code === 'upstream_timeout',
    );
  });
}

test('retry response body cannot stall forever before the next attempt', { timeout: 5000 }, async t => {
  let requests = 0;
  const { url } = await serve(t, (req, res) => {
    req.resume();
    if (++requests === 1) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.write('{');
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
    }
  });
  const result = await sendJsonRequestToUpstream(upstream(url, {
    timeoutMs: 150, retry: { attempts: 1, backoffMs: 0, retryOnStatusCodes: [503] },
  }), '/chat/completions', { stream: true });
  assert.equal(requests, 2);
  assert.equal(result.statusCode, 200);
  assert.equal(result.body, '{}');
});
