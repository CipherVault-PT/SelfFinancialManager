import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/yahoo-proxy.js';

const call = url => worker.fetch(new Request(`https://w.dev/?url=${encodeURIComponent(url)}`));

test('worker: recusa domínios fora do Yahoo e URLs inválidos', async () => {
  assert.equal((await call('https://evil.example.com/x')).status, 403);
  assert.equal((await call('http://query1.finance.yahoo.com/x')).status, 403);
  assert.equal((await worker.fetch(new Request('https://w.dev/?url=nada'))).status, 400);
});

test('worker: reencaminha o Yahoo com cabeçalhos CORS', async () => {
  globalThis.fetch = async u => {
    assert.equal(String(u), 'https://query1.finance.yahoo.com/v8/finance/chart/AAPL?range=1d');
    return new Response('{"chart":{}}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const res = await call('https://query1.finance.yahoo.com/v8/finance/chart/AAPL?range=1d');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  assert.deepEqual(await res.json(), { chart: {} });
  const pre = await worker.fetch(new Request('https://w.dev/', { method: 'OPTIONS' }));
  assert.equal(pre.headers.get('access-control-allow-methods'), 'GET, OPTIONS');
});
