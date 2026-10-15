import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/aurora-worker.js';
import { memoryKV } from './helpers.js';

const call = url => worker.fetch(new Request(`https://w.dev/?url=${encodeURIComponent(url)}`));
const req = (env, method, path, { auth, body } = {}) => worker.fetch(new Request(`https://w.dev${path}`, {
  method, body: body ? JSON.stringify(body) : undefined,
  headers: { ...(auth ? { Authorization: `Bearer ${auth}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
}), env);

test('worker: cotações só do Yahoo e do BCE, com CORS', async () => {
  assert.equal((await call('https://evil.example.com/x')).status, 403);
  assert.equal((await call('http://query1.finance.yahoo.com/x')).status, 403);
  assert.equal((await worker.fetch(new Request('https://w.dev/?url=nada'))).status, 400);
  const seen = [];
  globalThis.fetch = async u => { seen.push(String(u)); return new Response('{"chart":{}}', { status: 200, headers: { 'Content-Type': 'application/json' } }); };
  const res = await call('https://query1.finance.yahoo.com/v8/finance/chart/AAPL?range=1d');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  assert.deepEqual(await res.json(), { chart: {} });
  assert.equal((await call('https://data-api.ecb.europa.eu/service/data/ICP/M.PT.N.000000.4.INX?format=jsondata')).status, 200);
  assert.deepEqual(seen, ['https://query1.finance.yahoo.com/v8/finance/chart/AAPL?range=1d', 'https://data-api.ecb.europa.eu/service/data/ICP/M.PT.N.000000.4.INX?format=jsondata']);
  const pre = await worker.fetch(new Request('https://w.dev/sync', { method: 'OPTIONS' }));
  assert.match(pre.headers.get('access-control-allow-methods'), /PUT/);
  assert.match(pre.headers.get('access-control-allow-headers'), /Authorization/);
});

test('worker: estado diz se o cofre (KV) está ligado e criado', async () => {
  assert.deepEqual(await (await worker.fetch(new Request('https://w.dev/status'), {})).json(),
    { ok: true, app: 'aurora', version: 3, quotes: true, sync: false, vault: false });
  assert.equal((await req({}, 'GET', '/sync')).status, 501);
  const env = { SYNC: memoryKV() };
  assert.equal((await (await req(env, 'GET', '/status')).json()).vault, false);
  assert.equal((await req(env, 'GET', '/sync/meta')).status, 404);
});

test('worker: cofre com chave, versões, conflitos e limite de tentativas', async () => {
  const env = { SYNC: memoryKV() };
  const init = { salt: 'c2FsdHNhbHQ=', iter: 310000, auth: 'chave-certa_123' };
  assert.equal((await req(env, 'POST', '/sync/init', { body: { ...init, iter: 5 } })).status, 400);
  assert.equal((await req(env, 'POST', '/sync/init', { body: init })).status, 201);
  assert.ok(!env.SYNC.m.get('meta').includes('chave-certa'), 'só guarda o hash da chave');
  assert.deepEqual(await (await req(env, 'GET', '/sync/meta')).json(), { salt: init.salt, iter: init.iter });
  assert.equal((await req(env, 'POST', '/sync/init', { body: { ...init, auth: 'outra' } })).status, 409, 'não deixa substituir o cofre de outra pessoa');
  const auth = init.auth;
  assert.equal((await req(env, 'GET', '/sync', { auth })).status, 404);
  assert.equal((await req(env, 'GET', '/sync', { auth: 'errada' })).status, 401);
  const put1 = await req(env, 'PUT', '/sync', { auth, body: { base: 0, iv: 'aXY=', ct: 'Y3Qx' } });
  assert.equal(put1.status, 200);
  assert.equal((await put1.json()).v, 1);
  assert.equal((await req(env, 'GET', '/sync?since=1', { auth })).status, 204);
  assert.equal((await (await req(env, 'GET', '/sync?since=0', { auth })).json()).ct, 'Y3Qx');
  const stale = await req(env, 'PUT', '/sync', { auth, body: { base: 0, iv: 'aXY=', ct: 'Y3Qy' } });
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).v, 1);
  assert.equal((await req(env, 'PUT', '/sync', { auth, body: { base: 0, force: true, iv: 'aXY=', ct: 'Y3Qy' } })).status, 200);
  assert.equal(JSON.parse(env.SYNC.m.get('prev')).ct, 'Y3Qx', 'guarda a versão anterior');
  assert.equal((await req(env, 'PUT', '/sync', { auth, body: { base: 2, iv: '<script>', ct: 'x' } })).status, 400);
  for (let i = 0; i < 9; i++) await req(env, 'GET', '/sync', { auth: 'errada' });
  assert.equal((await req(env, 'GET', '/sync', { auth })).status, 429, 'bloqueia depois de 10 erros');
  env.SYNC.m.delete('fail:local');
  assert.equal((await req(env, 'DELETE', '/sync', { auth })).status, 204);
  assert.equal(env.SYNC.m.size, 0);
});
