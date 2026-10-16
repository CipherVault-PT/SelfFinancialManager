// Cloudflare Worker da Aurora: atalho de cotações + cofre cifrado para sincronizar dispositivos.
//
// Cotações:  GET  /?url=<url codificado>   (só Yahoo Finance, CNBC e BCE — não é um proxy aberto)
// Estado:    GET  /status
// Cofre:     GET  /sync/meta               sal e iterações (públicos; sem eles não se deriva nada)
//            POST /sync/init               cria o cofre (ou muda a frase-passe, com a chave atual)
//            GET  /sync[?since=v]          dados cifrados (204 se não mudou)
//            PUT  /sync                    grava nova versão se `base` for a atual (409 se não for)
//            DELETE /sync                  apaga o cofre
//
// Os dados chegam já cifrados (AES-256-GCM) pela app, com uma chave derivada da frase-passe:
// o Worker e a Cloudflare nunca os conseguem ler. A chave de acesso (Authorization) também é
// derivada da frase-passe; aqui só se guarda o SHA-256 dela.
// Para a sincronização, liga um KV namespace com o nome de variável SYNC (ver worker/README.md).

const QUOTE_HOSTS = new Set(['query1.finance.yahoo.com', 'query2.finance.yahoo.com', 'data-api.ecb.europa.eu', 'quote.cnbc.com']);
const CACHE_SECONDS = 30;
const MAX_BODY = 5 * 1024 * 1024;
const MAX_FAILS = 10;
const FAIL_WINDOW = 15 * 60;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Max-Age': '86400',
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const empty = status => new Response(null, { status, headers: { ...cors, 'Cache-Control': 'no-store' } });

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function sameString(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const isB64 = (s, max) => typeof s === 'string' && s.length > 0 && s.length <= max && /^[A-Za-z0-9+/=_-]+$/.test(s);

/* ---------- cotações ---------- */

async function quote(request) {
  let target;
  try {
    target = new URL(new URL(request.url).searchParams.get('url') ?? '');
  } catch {
    return json({ error: 'Parâmetro url inválido' }, 400);
  }
  if (target.protocol !== 'https:' || !QUOTE_HOSTS.has(target.hostname)) return json({ error: 'Domínio não permitido' }, 403);
  const upstream = await fetch(target, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AuroraInvestments/3.0)', Accept: 'application/json' },
    cf: { cacheTtl: CACHE_SECONDS, cacheEverything: true },
  });
  const res = new Response(upstream.body, upstream);
  for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
  res.headers.set('Cache-Control', `public, max-age=${CACHE_SECONDS}`);
  return res;
}

/* ---------- cofre ---------- */

const clientIp = request => request.headers.get('CF-Connecting-IP') || 'local';

async function tooManyFails(kv, request) {
  return (+(await kv.get(`fail:${clientIp(request)}`)) || 0) >= MAX_FAILS;
}

async function addFail(kv, request) {
  const k = `fail:${clientIp(request)}`;
  const n = (+(await kv.get(k)) || 0) + 1;
  try { await kv.put(k, String(n), { expirationTtl: FAIL_WINDOW }); } catch { /* limite de escritas */ }
}

/** Confirma a chave de acesso. Devolve null se estiver certa, ou a resposta de erro. */
async function checkAuth(kv, request, meta) {
  if (!meta) return json({ error: 'Cofre por criar' }, 404);
  if (await tooManyFails(kv, request)) return json({ error: 'Demasiadas tentativas — espera 15 minutos' }, 429);
  const auth = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (auth && sameString(await sha256Hex(auth), meta.authHash)) return null;
  await addFail(kv, request);
  return json({ error: 'Frase-passe errada' }, 401);
}

async function readBody(request) {
  const len = +(request.headers.get('Content-Length') || 0);
  if (len > MAX_BODY) throw new Error('grande');
  const text = await request.text();
  if (text.length > MAX_BODY) throw new Error('grande');
  return JSON.parse(text);
}

async function sync(request, env, path) {
  const kv = env.SYNC;
  if (!kv) return json({ error: 'Sincronização por configurar: liga um KV namespace com o nome SYNC a este Worker' }, 501);
  const meta = await kv.get('meta', 'json');

  if (path === '/sync/meta' && request.method === 'GET') {
    return meta ? json({ salt: meta.salt, iter: meta.iter }) : json({ error: 'Cofre por criar' }, 404);
  }

  if (path === '/sync/init' && request.method === 'POST') {
    if (meta) {
      const denied = await checkAuth(kv, request, meta);
      if (denied) return json({ error: 'Já existe um cofre neste Worker — usa a mesma frase-passe' }, 409);
    }
    let body;
    try { body = await readBody(request); } catch { return json({ error: 'Pedido inválido' }, 400); }
    const { salt, iter, auth } = body ?? {};
    if (!isB64(salt, 64) || !isB64(auth, 128) || !(iter >= 100_000 && iter <= 5_000_000)) return json({ error: 'Pedido inválido' }, 400);
    await kv.put('meta', JSON.stringify({ salt, iter, authHash: await sha256Hex(auth), created: meta?.created ?? Date.now() }));
    return json({ ok: true }, meta ? 200 : 201);
  }

  if (path !== '/sync') return json({ error: 'Não encontrado' }, 404);
  const denied = await checkAuth(kv, request, meta);
  if (denied) return denied;
  const data = await kv.get('data', 'json');

  if (request.method === 'GET') {
    if (!data) return json({ error: 'Ainda sem dados' }, 404);
    const since = new URL(request.url).searchParams.get('since');
    if (since != null && +since === data.v) return empty(204);
    return json(data);
  }

  if (request.method === 'PUT') {
    let body;
    try { body = await readBody(request); } catch { return json({ error: 'Pedido inválido ou demasiado grande' }, 400); }
    const { base, iv, ct, force } = body ?? {};
    if (!isB64(iv, 64) || !isB64(ct, MAX_BODY)) return json({ error: 'Pedido inválido' }, 400);
    const current = data?.v ?? 0;
    if (!force && base !== current) return json({ error: 'Há uma versão mais recente', v: current, ts: data?.ts ?? null }, 409);
    const next = { v: current + 1, ts: Date.now(), iv, ct };
    if (data) await kv.put('prev', JSON.stringify(data));
    await kv.put('data', JSON.stringify(next));
    return json({ v: next.v, ts: next.ts });
  }

  if (request.method === 'DELETE') {
    await Promise.all(['meta', 'data', 'prev'].map(k => kv.delete(k)));
    return empty(204);
  }

  return json({ error: 'Método não permitido' }, 405);
}

export default {
  async fetch(request, env = {}) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    const path = new URL(request.url).pathname.replace(/\/+$/, '') || '/';
    try {
      if (path === '/status') {
        const meta = env.SYNC ? await env.SYNC.get('meta', 'json') : null;
        return json({ ok: true, app: 'aurora', version: 3, quotes: true, sync: !!env.SYNC, vault: !!meta });
      }
      if (path.startsWith('/sync')) return await sync(request, env, path);
      if (request.method !== 'GET') return json({ error: 'Método não permitido' }, 405);
      return await quote(request);
    } catch {
      return json({ error: 'Erro no Worker' }, 500);
    }
  },
};
