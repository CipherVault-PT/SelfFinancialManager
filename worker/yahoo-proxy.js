// Cloudflare Worker: intermediário privado para as cotações do Yahoo Finance.
// Uso: https://<o-teu-worker>.workers.dev/?url=<url do Yahoo codificado>
// Só aceita pedidos para os domínios do Yahoo Finance, para não servir de proxy aberto.

const ALLOWED_HOSTS = new Set(['query1.finance.yahoo.com', 'query2.finance.yahoo.com']);
const CACHE_SECONDS = 30;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

const json = (body, status) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (request.method !== 'GET') return json({ error: 'Método não permitido' }, 405);

    let target;
    try {
      target = new URL(new URL(request.url).searchParams.get('url') ?? '');
    } catch {
      return json({ error: 'Parâmetro url inválido' }, 400);
    }
    if (target.protocol !== 'https:' || !ALLOWED_HOSTS.has(target.hostname)) {
      return json({ error: 'Domínio não permitido' }, 403);
    }

    const upstream = await fetch(target, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AuroraInvestments/2.0)', Accept: 'application/json' },
      cf: { cacheTtl: CACHE_SECONDS, cacheEverything: true },
    });

    const res = new Response(upstream.body, upstream);
    for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
    res.headers.set('Cache-Control', `public, max-age=${CACHE_SECONDS}`);
    return res;
  },
};
