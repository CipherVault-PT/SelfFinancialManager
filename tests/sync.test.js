import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/aurora-worker.js';
import { state, load, save, readUndo, commit } from '../js/store.js';
import { seal, open, deriveKeys, randomSalt } from '../js/sync/crypto.js';
import {
  connect, finishConnect, pull, push, resolveConflict, prime, sync, syncEnabled, disconnect, mergeHistory, userPart, checkWorker, _resetSync,
} from '../js/sync/engine.js';
import { reset, lot, stockPos, memoryStorage, memoryKV } from './helpers.js';

const URL_W = 'https://aurora.exemplo.workers.dev';
const PASS = 'quatro palavras bem longas';

/** Liga o fetch global ao Worker com um KV em memória (a "nuvem"). */
function cloud() {
  const env = { SYNC: memoryKV() };
  globalThis.fetch = async (url, { method, headers, body } = {}) => worker.fetch(new Request(url, { method, headers, body }), env);
  return env;
}

/** Simula dispositivos: cada um tem o seu localStorage; trocar = gravar o estado e carregar o do outro. */
function devices() {
  const stores = {};
  let current = null;
  return async name => {
    if (current) save();
    stores[name] ??= new Map();
    const m = stores[name];
    globalThis.localStorage = {
      getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k),
    };
    current = name;
    reset();
    load();
    _resetSync();
    await prime();
  };
}

const names = () => state.positions.map(p => p.name).sort();

test('cifra: ida e volta, chave errada falha, chaves derivadas estáveis', async () => {
  const salt = randomSalt();
  const a = await deriveKeys(PASS, salt, 100_000), b = await deriveKeys(PASS, salt, 100_000);
  assert.deepEqual(a, b);
  assert.notEqual(a.key, a.auth);
  const other = await deriveKeys('outra frase qualquer', salt, 100_000);
  const text = JSON.stringify({ x: 'á'.repeat(5000) });
  const box = await seal(text, a.key);
  assert.ok(box.ct.length < text.length / 4, 'comprime antes de cifrar');
  assert.equal(await open(box, a.key), text);
  await assert.rejects(open(box, other.key));
  const tampered = { ...box, ct: box.ct.slice(0, -4) + (box.ct.endsWith('AAAA') ? 'BBBB' : 'AAAA') };
  await assert.rejects(open(tampered, a.key), 'deteta alterações');
});

test('ligar: erros claros para endereço, Worker antigo e cofre por ligar', async () => {
  memoryStorage();
  await assert.rejects(checkWorker('http://inseguro.com'), /https/);
  globalThis.fetch = async () => new Response('{"error":"Parâmetro url inválido"}', { status: 400 });
  await assert.rejects(checkWorker(URL_W), /código antigo/);
  globalThis.fetch = async () => { throw new TypeError('rede'); };
  await assert.rejects(checkWorker(URL_W), /Não consegui ligar/);
  globalThis.fetch = async (url, init = {}) => worker.fetch(new Request(url, init), {});
  await assert.rejects(connect(URL_W, PASS), /cofre/);
});

test('sincronizar dois dispositivos: criar, ligar, alterar, conflito e histórico', async () => {
  const env = cloud();
  const use = devices();

  // Telemóvel: tem dados e cria o cofre
  await use('telemovel');
  state.positions = [stockPos({ id: 'a', name: 'Apple', lots: [lot(1, 100)] })];
  state.history = [{ d: '2026-10-01', v: 100 }];
  save();
  const c1 = await connect(URL_W, PASS);
  assert.equal(c1.created, true);
  assert.equal(c1.remote, null);
  await finishConnect(c1, 'local');
  assert.equal(sync.status, 'ok');
  assert.ok(syncEnabled());
  const stored = env.SYNC.m.get('data');
  assert.ok(!stored.includes('Apple'), 'a nuvem só tem dados cifrados');

  // PC: frase-passe errada, depois a certa; usa os dados da nuvem
  await use('pc');
  await assert.rejects(connect(URL_W, 'frase errada qualquer'), /Frase-passe errada/);
  const c2 = await connect(URL_W, PASS);
  assert.equal(c2.created, false);
  assert.deepEqual(c2.remote.data.positions.map(p => p.name), ['Apple']);
  await finishConnect(c2, 'remote');
  assert.deepEqual(names(), ['Apple']);

  // PC acrescenta uma posição e envia
  state.positions.push(stockPos({ id: 'b', name: 'Microsoft', lots: [lot(1, 300)] }));
  state.history = [...state.history, { d: '2026-10-02', v: 400 }];
  await push();
  assert.equal(sync.status, 'ok');

  // Telemóvel recebe sem perguntar (não tinha alterações) e junta o histórico
  await use('telemovel');
  await pull();
  assert.deepEqual(names(), ['Apple', 'Microsoft']);
  assert.deepEqual(state.history.map(h => h.d), ['2026-10-01', '2026-10-02']);

  // Conflito: os dois alteram ao mesmo tempo
  state.positions[0].name = 'Apple (telemóvel)';
  save();
  await use('pc');
  state.positions = state.positions.filter(p => p.id !== 'a');
  await push();
  await use('telemovel');
  await push();
  assert.equal(sync.status, 'conflict');
  assert.ok(sync.conflict);
  await resolveConflict('remote');
  assert.deepEqual(names(), ['Microsoft']);
  assert.equal(readUndo()?.reason, 'sync', 'os dados locais ficam em "Repor os dados de antes"');
  assert.equal(sync.status, 'ok');

  // Sem alterações em lado nenhum: não envia nada
  const v = JSON.parse(env.SYNC.m.get('data')).v;
  await pull();
  assert.equal(JSON.parse(env.SYNC.m.get('data')).v, v);

  // Manter os dados deste dispositivo num conflito
  state.positions.push(stockPos({ id: 'c', name: 'Nvidia', lots: [lot(1, 50)] }));
  save();
  await use('pc');
  state.positions.push(stockPos({ id: 'd', name: 'ASML', lots: [lot(1, 50)] }));
  await push();
  await use('telemovel');
  await pull();
  assert.equal(sync.status, 'conflict');
  await resolveConflict('local');
  await use('pc');
  await pull();
  assert.deepEqual(names(), ['Microsoft', 'Nvidia']);

  disconnect();
  assert.equal(syncEnabled(), false);
  commit();
});

test('o que conta como alteração: histórico e datas de lembretes não', () => {
  const base = { positions: [], closed: [], cash: [], dividends: [], alerts: [], settings: { accent: 'gold', lastBackup: 1 }, history: [] };
  assert.equal(userPart(base), userPart({ ...base, history: [{ d: 'x', v: 1 }], settings: { accent: 'gold', lastBackup: 99 } }));
  assert.notEqual(userPart(base), userPart({ ...base, settings: { accent: 'blue' } }));
  assert.deepEqual(mergeHistory([{ d: '1', v: 1 }, { d: '2', v: 2 }], [{ d: '2', v: 3 }, { d: '3', v: 4 }]), [{ d: '1', v: 1 }, { d: '2', v: 3 }, { d: '3', v: 4 }]);
});
