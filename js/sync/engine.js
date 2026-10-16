import { STORAGE_KEY } from '../config.js';
import { state, hydrate, exportJSON, snapshotForUndo, subscribe, commit } from '../store.js';
import { seal, open, deriveKeys, randomSalt, sha256, ITERATIONS } from './crypto.js';

/**
 * Sincronização entre dispositivos através do Worker da Cloudflare do utilizador.
 * Cada dispositivo guarda a última versão que conhece; ao gravar, o Worker só aceita se ninguém
 * tiver gravado entretanto (senão responde 409 e a app junta ou pergunta qual manter).
 * O histórico diário do património junta-se sozinho; o resto, se mudou nos dois lados, é perguntado.
 */
export const SYNC_KEY = `${STORAGE_KEY}_sync`;
const VOLATILE = ['lastBackup', 'backupSnoozeUntil', 'createdAt'];
const PUSH_DELAY = 3000;
const PULL_EVERY = 3 * 60_000;
const KEEPALIVE_MAX = 60_000;

export class SyncError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function readCfg() {
  try {
    const c = JSON.parse(localStorage.getItem(SYNC_KEY));
    return c && typeof c.url === 'string' && c.key && c.auth ? c : null;
  } catch { return null; }
}

function writeCfg(c) {
  try {
    if (c) localStorage.setItem(SYNC_KEY, JSON.stringify(c));
    else localStorage.removeItem(SYNC_KEY);
  } catch { /* armazenamento indisponível */ }
}

export const syncConfig = () => readCfg();
export const syncEnabled = () => !!readCfg();

/** O que conta como alteração do utilizador (o histórico e as datas de lembretes não contam). */
export function userPart(d) {
  const settings = { ...d.settings };
  for (const k of VOLATILE) delete settings[k];
  return JSON.stringify({ positions: d.positions, closed: d.closed, cash: d.cash, dividends: d.dividends, alerts: d.alerts, watchlist: d.watchlist ?? [], settings });
}

/** Junta dois históricos diários (por data; em caso de repetição fica o de `b`). */
export function mergeHistory(a = [], b = []) {
  const m = new Map(a.map(h => [h.d, h]));
  for (const h of b) m.set(h.d, h);
  return [...m.values()].sort((x, y) => x.d.localeCompare(y.d));
}

const lastDay = () => state.history.at(-1)?.d ?? '';

/* ---------- estado da sincronização (para a interface) ---------- */

export const sync = { status: 'off', error: '', conflict: null };
let hooks = { onApplied() {}, onConflict() {}, onStatus() {} };
let lastUser = null, lastDate = '', ready = false, timer = null, chain = Promise.resolve(), pending = 0;

function setStatus(status, error = '') {
  sync.status = status;
  sync.error = error;
  hooks.onStatus(sync);
}

/* ---------- pedidos ao Worker ---------- */

export const normalizeUrl = s => {
  try {
    const u = new URL(String(s).trim());
    if (u.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(u.hostname)) return null;
    return `${u.origin}${u.pathname.replace(/\/+$/, '')}`;
  } catch { return null; }
};

const timeout = ms => (typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(ms) : undefined);

async function call(cfg, method, path, body, { keepalive = false } = {}) {
  const payload = body ? JSON.stringify(body) : undefined;
  try {
    return await fetch(cfg.url + path, {
      method,
      headers: { Authorization: `Bearer ${cfg.auth}`, ...(payload ? { 'Content-Type': 'application/json' } : {}) },
      body: payload,
      keepalive: keepalive && (payload?.length ?? 0) < KEEPALIVE_MAX,
      signal: keepalive ? undefined : timeout(20_000),
    });
  } catch {
    throw new SyncError('offline', 'Sem ligação ao Worker');
  }
}

async function failure(res) {
  let msg = '';
  try { msg = (await res.json()).error || ''; } catch { /* sem corpo */ }
  if (res.status === 401) return new SyncError('auth', 'A frase-passe já não é válida (foi mudada noutro dispositivo?). Volta a ligar a sincronização.');
  if (res.status === 429) return new SyncError('error', msg || 'Demasiadas tentativas — espera 15 minutos');
  if (res.status === 501) return new SyncError('setup', msg || 'Falta ligar o cofre (KV) ao Worker');
  return new SyncError('error', msg || `Erro do Worker (${res.status})`);
}

/** Verifica o Worker: { url, quotes, sync, vault }. */
export async function checkWorker(url) {
  const u = normalizeUrl(url);
  if (!u) throw new SyncError('setup', 'Endereço inválido — tem de começar por https://');
  let res;
  try { res = await fetch(`${u}/status`, { signal: timeout(10_000) }); } catch {
    throw new SyncError('offline', 'Não consegui ligar ao Worker. Confirma o endereço e a ligação à internet.');
  }
  let st = null;
  try { st = await res.json(); } catch { /* não é JSON */ }
  if (!res.ok || st?.app !== 'aurora') {
    throw new SyncError('setup', 'Este endereço não tem o Worker da Aurora (ou ainda tem o código antigo). Cola o código novo no Worker e faz Deploy.');
  }
  return { ...st, url: u };
}

async function fetchRemote(cfg, since = null) {
  const res = await call(cfg, 'GET', since != null ? `/sync?since=${since}` : '/sync');
  if (res.status === 204) return 'same';
  if (res.status === 404) return null;
  if (!res.ok) throw await failure(res);
  const box = await res.json();
  let data;
  try { data = JSON.parse(await open(box, cfg.key)); } catch {
    throw new SyncError('auth', 'Não consegui decifrar os dados da nuvem — a frase-passe é a mesma do outro dispositivo?');
  }
  return { v: box.v, ts: box.ts, data };
}

/* ---------- ligar / desligar ---------- */

/**
 * Liga a um Worker com uma frase-passe. Se o cofre não existir, cria-o.
 * Devolve { cfg, remote, created } sem gravar nada — a interface decide o que fazer com os dados.
 */
export async function connect(url, passphrase) {
  const st = await checkWorker(url);
  if (!st.sync) throw new SyncError('setup', 'Falta ligar o cofre (KV, com o nome SYNC) ao Worker — vê o passo 5 do guia.');
  let salt, iter, created = false;
  if (st.vault) {
    const res = await fetch(`${st.url}/sync/meta`).catch(() => null);
    if (!res?.ok) throw new SyncError('offline', 'Não consegui ler o cofre');
    ({ salt, iter } = await res.json());
  } else {
    salt = randomSalt();
    iter = ITERATIONS;
    created = true;
  }
  const { key, auth } = await deriveKeys(passphrase, salt, iter);
  const cfg = { url: st.url, salt, iter, key, auth, v: 0, h: '', at: null };
  if (created) {
    const res = await call(cfg, 'POST', '/sync/init', { salt, iter, auth });
    if (res.status === 409) throw new SyncError('setup', 'Outro dispositivo acabou de criar o cofre — tenta outra vez com a mesma frase-passe.');
    if (!res.ok) throw await failure(res);
  }
  let remote = null;
  if (!created) {
    try { remote = await fetchRemote(cfg); } catch (e) {
      throw e.code === 'auth' ? new SyncError('auth', 'Frase-passe errada — tem de ser a mesma que usaste no primeiro dispositivo.') : e;
    }
  }
  return { cfg, remote, created };
}

/**
 * Termina a ligação: 'remote' usa os dados da nuvem (os locais ficam em "Repor os dados de antes");
 * 'local' envia os deste dispositivo.
 */
export async function finishConnect({ cfg, remote }, choice) {
  writeCfg(cfg);
  if (remote && choice === 'remote') {
    await applyRemote(remote, { backup: true });
  } else {
    if (remote) state.history = mergeHistory(remote.data.history, state.history);
    await push({ force: true, base: remote?.v ?? 0 });
  }
  return sync.status;
}

export function disconnect() {
  clearTimeout(timer);
  writeCfg(null);
  lastUser = null;
  sync.conflict = null;
  setStatus('off');
}

/** Apaga a cópia na nuvem (o cofre fica por criar) e desliga este dispositivo. */
export async function deleteCloud() {
  const cfg = readCfg();
  if (!cfg) return;
  const res = await call(cfg, 'DELETE', '/sync');
  if (!res.ok && res.status !== 404) throw await failure(res);
  disconnect();
}

/* ---------- aplicar / enviar ---------- */

async function remember(cfg, v) {
  lastUser = userPart(state);
  lastDate = lastDay();
  writeCfg({ ...cfg, v, h: await sha256(lastUser), at: Date.now() });
}

const itemCount = d => ['positions', 'closed', 'cash', 'dividends', 'watchlist'].reduce((s, k) => s + (d[k]?.length || 0), 0);

async function applyRemote(remote, { backup = false } = {}) {
  const local = JSON.parse(exportJSON());
  if (backup || itemCount(remote.data) < itemCount(local)) snapshotForUndo('sync');
  const d = remote.data, ls = local.settings ?? {}, rs = d.settings ?? {};
  hydrate({
    ...d,
    history: mergeHistory(local.history, d.history),
    settings: {
      ...rs,
      lastBackup: Math.max(ls.lastBackup || 0, rs.lastBackup || 0) || null,
      backupSnoozeUntil: ls.backupSnoozeUntil || 0,
      createdAt: Math.min(...[ls.createdAt, rs.createdAt].filter(Boolean)) || ls.createdAt || rs.createdAt || null,
    },
  }, { keepCache: true });
  await remember(readCfg(), remote.v);
  sync.conflict = null;
  setStatus('ok');
  commit();
  hooks.onApplied();
}

const dirty = () => lastUser === null || userPart(state) !== lastUser;

/** Envia os dados deste dispositivo. Com `force`, substitui a nuvem mesmo que tenha mudado. */
export async function push({ force = false, base = null, keepalive = false } = {}) {
  const cfg = readCfg();
  if (!cfg) return;
  setStatus('busy');
  const box = await seal(exportJSON(), cfg.key);
  const res = await call(cfg, 'PUT', '/sync', { base: base ?? cfg.v, force, ...box }, { keepalive });
  if (res.status === 409) {
    const remote = await fetchRemote(cfg);
    if (!remote || remote === 'same') return push({ force: true });
    if (!dirty() || userPart(remote.data) === userPart(state)) return applyRemote(remote);
    return conflict(remote);
  }
  if (!res.ok) throw await failure(res);
  const { v } = await res.json();
  await remember(cfg, v);
  setStatus('ok');
}

/** Vai buscar alterações de outros dispositivos (e envia as deste, se houver). */
export async function pull() {
  const cfg = readCfg();
  if (!cfg || sync.conflict) return;
  setStatus('busy');
  const remote = await fetchRemote(cfg, cfg.v);
  if (remote === 'same' || remote === null) {
    if (dirty() || lastDay() !== lastDate || remote === null) return push({ base: remote === null ? 0 : cfg.v });
    return setStatus('ok');
  }
  if (!dirty() || userPart(remote.data) === userPart(state)) return applyRemote(remote);
  return conflict(remote);
}

function conflict(remote) {
  sync.conflict = remote;
  setStatus('conflict', 'Os dados mudaram neste e noutro dispositivo');
  hooks.onConflict(remote);
}

/** Resolve um conflito: 'remote' (usa a nuvem; os locais ficam para repor) ou 'local' (envia estes). */
export async function resolveConflict(choice) {
  const remote = sync.conflict;
  if (!remote) return;
  sync.conflict = null;
  if (choice === 'remote') return applyRemote(remote, { backup: true });
  state.history = mergeHistory(remote.data.history, state.history);
  return push({ force: true });
}

/**
 * Corre as operações uma de cada vez e regista erros no estado (sem lançar).
 * `skipIfBusy`: para pedidos automáticos, não se acumulam se já houver um a decorrer.
 */
export function run(fn, { skipIfBusy = false } = {}) {
  if (skipIfBusy && pending) return chain;
  pending++;
  chain = chain
    .then(fn)
    .catch(e => setStatus(e.code === 'offline' ? 'offline' : e.code === 'auth' ? 'auth' : 'error', e.message))
    .finally(() => { pending--; });
  return chain;
}

export const syncNow = () => run(pull);

function onCommit() {
  if (!ready || !syncEnabled() || sync.conflict) return;
  if (!dirty() && lastDay() === lastDate) return;
  clearTimeout(timer);
  timer = setTimeout(() => run(push), PUSH_DELAY);
}

/** Arranque: liga os eventos e faz a primeira sincronização. */
export async function initSync(h = {}) {
  hooks = { ...hooks, ...h };
  subscribe(onCommit);
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (!ready || !syncEnabled() || sync.conflict) return;
      if (document.hidden) {
        if (dirty()) { clearTimeout(timer); run(() => push({ keepalive: true }), { skipIfBusy: true }); }
      } else run(pull, { skipIfBusy: true });
    });
    setInterval(() => { if (ready && !document.hidden && syncEnabled()) run(pull, { skipIfBusy: true }); }, PULL_EVERY);
  }
  if (!(await prime())) return;
  await run(pull);
}

/** Lê o ponto de partida: se os dados locais são os da última sincronização, não há nada por enviar. */
export async function prime() {
  const cfg = readCfg();
  ready = true;
  if (!cfg) { setStatus('off'); return false; }
  const now = userPart(state);
  lastUser = cfg.h && (await sha256(now)) === cfg.h ? now : null;
  lastDate = lastUser ? lastDay() : '';
  return true;
}

/** Só para testes. */
export const _resetSync = () => { lastUser = null; lastDate = ''; ready = true; pending = 0; chain = Promise.resolve(); sync.conflict = null; sync.status = 'off'; };
