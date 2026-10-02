export class HttpError extends Error {
  constructor(status, url) {
    super(`HTTP ${status}`);
    this.status = status;
    this.url = url;
  }
}

function timeoutSignal(ms) {
  if (typeof AbortSignal.timeout === 'function') return AbortSignal.timeout(ms);
  const c = new AbortController();
  setTimeout(() => c.abort(), ms);
  return c.signal;
}

/** GET com timeout; lança erro se a resposta não for 2xx ou não for JSON. */
export async function fetchJSON(url, { timeout = 10_000 } = {}) {
  const res = await fetch(url, { signal: timeoutSignal(timeout) });
  if (!res.ok) throw new HttpError(res.status, url);
  return JSON.parse(await res.text());
}

/** Executa `fn` sobre `items` com no máximo `limit` pedidos em simultâneo. */
export async function pool(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      try { results[i] = await fn(items[i], i); } catch (e) { results[i] = e; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
