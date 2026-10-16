import { state } from './store.js';
import { metrics } from './calc.js';
import { conv, disp } from './fx.js';

/* ---------- calendário ---------- */

const pad = v => String(v).padStart(2, '0');
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const utc = s => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
const dow = s => new Date(utc(s)).getUTCDay();
export const addDays = (s, n) => new Date(utc(s) + n * 86_400_000).toISOString().slice(0, 10);

/** Domingo de Páscoa (algoritmo gregoriano anónimo). */
export function easter(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return iso(y, month, day);
}

/** n-ésimo dia da semana `wd` (0 = domingo) do mês; n = -1 é o último. */
function nth(y, m, wd, n) {
  if (n > 0) {
    const first = iso(y, m, 1);
    return addDays(first, ((wd - dow(first) + 7) % 7) + (n - 1) * 7);
  }
  const last = addDays(iso(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1, 1), -1);
  return addDays(last, -((dow(last) - wd + 7) % 7));
}

/** Feriado ao sábado → sexta, ao domingo → segunda (regra da bolsa de Nova Iorque). */
const observed = s => (dow(s) === 6 ? addDays(s, -1) : dow(s) === 0 ? addDays(s, 1) : s);

function usHolidays(y) {
  const jan1 = iso(y, 1, 1);
  return [
    dow(jan1) === 0 ? addDays(jan1, 1) : jan1, // a 1 de janeiro ao sábado não fecha a 31 de dezembro
    nth(y, 1, 1, 3), nth(y, 2, 1, 3), addDays(easter(y), -2), nth(y, 5, 1, -1),
    observed(iso(y, 6, 19)), observed(iso(y, 7, 4)), nth(y, 9, 1, 1), nth(y, 11, 4, 4), observed(iso(y, 12, 25)),
  ];
}

function usEarly(s) {
  const [y, m, d] = s.split('-').map(Number), wd = dow(s);
  const early = (m === 7 && d === 3 && wd >= 1 && wd <= 4)
    || (m === 12 && d === 24 && wd >= 1 && wd <= 4)
    || s === addDays(nth(y, 11, 4, 4), 1);
  return early ? { close: '13:00', post: '17:00' } : null;
}

function ukHolidays(y) {
  const jan1 = iso(y, 1, 1), xmas = dow(iso(y, 12, 25));
  const xmasDays = xmas === 6 ? [27, 28] : xmas === 0 ? [26, 27] : xmas === 5 ? [25, 28] : [25, 26];
  return [
    dow(jan1) === 6 ? addDays(jan1, 2) : dow(jan1) === 0 ? addDays(jan1, 1) : jan1,
    addDays(easter(y), -2), addDays(easter(y), 1), nth(y, 5, 1, 1), nth(y, 5, 1, -1), nth(y, 8, 1, -1),
    ...xmasDays.map(d => iso(y, 12, d)),
  ];
}

/** Datas fixas (MM-DD) e dias relativos à Páscoa (−2 = Sexta-feira Santa, 1 = Segunda de Páscoa, 39 = Ascensão, 50 = Pentecostes). */
const fixed = (mmdd, rel = [-2, 1], extra = () => []) => y => [
  ...mmdd.map(x => `${y}-${x}`), ...rel.map(n => addDays(easter(y), n)), ...extra(y),
];
/** Véspera de São João na Suécia e na Finlândia: a sexta-feira entre 19 e 25 de junho. */
const midsummerEve = y => { const d = iso(y, 6, 19); return [addDays(d, (5 - dow(d) + 7) % 7)]; };
const halfDay = close => s => (/-12-(24|31)$/.test(s) ? { close } : null);
const EU = { open: '09:00', close: '17:30' };

/** Horário de cada bolsa na hora local dela; os EUA têm pré-mercado e pós-mercado. */
export const MARKETS = {
  us: { name: 'EUA', full: 'Nova Iorque (NYSE, Nasdaq)', flag: '🇺🇸', tz: 'America/New_York', open: '09:30', close: '16:00', pre: '04:00', post: '20:00', hol: usHolidays, early: usEarly },
  xetra: { name: 'Xetra', full: 'Frankfurt (Xetra)', flag: '🇩🇪', tz: 'Europe/Berlin', ...EU, hol: fixed(['01-01', '05-01', '12-24', '12-25', '12-26', '12-31']) },
  euronext: { name: 'Euronext', full: 'Euronext (Lisboa, Paris, Amesterdão, Bruxelas, Dublin)', flag: '🇪🇺', tz: 'Europe/Paris', ...EU, hol: fixed(['01-01', '05-01', '12-25', '12-26']), early: halfDay('14:05') },
  lse: { name: 'Londres', full: 'Londres (LSE)', flag: '🇬🇧', tz: 'Europe/London', open: '08:00', close: '16:30', hol: ukHolidays, early: halfDay('12:30') },
  bme: { name: 'Madrid', full: 'Madrid (BME)', flag: '🇪🇸', tz: 'Europe/Madrid', ...EU, hol: fixed(['01-01', '05-01', '12-25', '12-26']), early: halfDay('14:00') },
  milan: { name: 'Milão', full: 'Milão (Borsa Italiana)', flag: '🇮🇹', tz: 'Europe/Rome', ...EU, hol: fixed(['01-01', '05-01', '08-15', '12-24', '12-25', '12-26', '12-31']) },
  six: { name: 'Zurique', full: 'Zurique (SIX)', flag: '🇨🇭', tz: 'Europe/Zurich', ...EU, hol: fixed(['01-01', '01-02', '05-01', '08-01', '12-24', '12-25', '12-26', '12-31'], [-2, 1, 39, 50]) },
  stockholm: { name: 'Estocolmo', full: 'Estocolmo (Nasdaq Nordic)', flag: '🇸🇪', tz: 'Europe/Stockholm', ...EU, hol: fixed(['01-01', '01-06', '05-01', '06-06', '12-24', '12-25', '12-26', '12-31'], [-2, 1, 39], midsummerEve) },
  helsinki: { name: 'Helsínquia', full: 'Helsínquia (Nasdaq Nordic)', flag: '🇫🇮', tz: 'Europe/Helsinki', open: '10:00', close: '18:30', hol: fixed(['01-01', '01-06', '05-01', '12-06', '12-24', '12-25', '12-26', '12-31'], [-2, 1, 39], midsummerEve) },
  copenhagen: { name: 'Copenhaga', full: 'Copenhaga (Nasdaq Nordic)', flag: '🇩🇰', tz: 'Europe/Copenhagen', open: '09:00', close: '17:00', hol: fixed(['01-01', '06-05', '12-24', '12-25', '12-26', '12-31'], [-3, -2, 1, 39, 50]) },
  oslo: { name: 'Oslo', full: 'Oslo (Euronext Oslo)', flag: '🇳🇴', tz: 'Europe/Oslo', open: '09:00', close: '16:20', hol: fixed(['01-01', '05-01', '05-17', '12-24', '12-25', '12-26', '12-31'], [-3, -2, 1, 39, 50]) },
  vienna: { name: 'Viena', full: 'Viena (Wiener Börse)', flag: '🇦🇹', tz: 'Europe/Vienna', ...EU, hol: fixed(['01-01', '05-01', '12-24', '12-25', '12-26', '12-31'], [-2, 1, 50]) },
};

const SUFFIX_MARKET = {
  '.DE': 'xetra', '.F': 'xetra', '.AS': 'euronext', '.PA': 'euronext', '.BR': 'euronext', '.LS': 'euronext', '.IR': 'euronext',
  '.L': 'lse', '.MC': 'bme', '.MI': 'milan', '.SW': 'six', '.ST': 'stockholm', '.HE': 'helsinki', '.CO': 'copenhagen',
  '.OL': 'oslo', '.VI': 'vienna',
};

/** Bolsa de um símbolo Yahoo (sem sufixo = EUA); null para índices, câmbios e bolsas que não conheço. */
export function marketOf(y) {
  if (!y || /[=^]/.test(y)) return null;
  const m = /\.[A-Z]{1,3}$/.exec(y);
  return m ? SUFFIX_MARKET[m[0]] ?? null : 'us';
}

const holCache = new Map();
function isHoliday(id, s) {
  const key = `${id}:${s.slice(0, 4)}`;
  if (!holCache.has(key)) holCache.set(key, new Set(MARKETS[id].hol(+s.slice(0, 4))));
  return holCache.get(key).has(s);
}

export const isTradingDay = (id, s) => dow(s) % 6 !== 0 && !isHoliday(id, s);

/* ---------- fusos horários ---------- */

const fmts = new Map();
function partsIn(ts, tz) {
  let f = fmts.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    fmts.set(tz, f);
  }
  const o = {};
  for (const p of f.formatToParts(ts)) o[p.type] = +p.value;
  return o;
}

/** Data (AAAA-MM-DD) no fuso horário `tz`. */
export const dateIn = (ts, tz) => { const p = partsIn(ts, tz); return iso(p.year, p.month, p.day); };

const offset = (ts, tz) => {
  const p = partsIn(ts, tz);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ts / 1000) * 1000;
};

/** Instante (ms) de uma hora local "HH:MM" num dia, no fuso `tz` — trata da mudança de hora. */
export function zoned(day, hhmm, tz) {
  const [h, mi] = hhmm.split(':').map(Number);
  const guess = utc(day) + (h * 60 + mi) * 60_000;
  const o1 = offset(guess, tz), t = guess - o1, o2 = offset(t, tz);
  return o1 === o2 ? t : guess - o2;
}

/* ---------- sessões ---------- */

/** Sessão de um dia de negociação ({ pre?, open, close, post? } em ms), ou null se a bolsa estiver fechada. */
export function sessionOn(id, day) {
  const mk = MARKETS[id];
  if (!mk || !isTradingDay(id, day)) return null;
  const early = mk.early?.(day);
  const t = hhmm => zoned(day, hhmm, mk.tz);
  const s = { day, open: t(mk.open), close: t(early?.close ?? mk.close) };
  if (mk.pre) s.pre = t(mk.pre);
  if (mk.post) s.post = t(early?.post ?? mk.post);
  const y = state.cache.sessions?.[id];
  if (y?.day === day && y.close > y.open) {
    s.open = y.open; s.close = y.close;
    if (mk.post && y.post > y.close) s.post = y.post;
  }
  return s;
}

/**
 * Estado de uma bolsa: phase 'pre' | 'open' | 'post' | 'closed'; `until` (fim da fase atual),
 * `next` (sessão seguinte, quando fechada) e `reason` ('weekend' | 'holiday' | 'night').
 */
export function marketStatus(id, now = Date.now()) {
  const mk = MARKETS[id];
  const today = dateIn(now, mk.tz);
  const s = sessionOn(id, today);
  if (s) {
    if (now < (s.pre ?? s.open)) return { id, phase: 'closed', reason: 'night', next: s };
    if (now < s.open) return { id, phase: 'pre', until: s.open, session: s };
    if (now < s.close) return { id, phase: 'open', until: s.close, session: s };
    if (s.post && now < s.post) return { id, phase: 'post', until: s.post, session: s };
  }
  let next = null;
  for (let i = 1; i <= 14 && !next; i++) next = sessionOn(id, addDays(today, i));
  return { id, phase: 'closed', reason: s ? 'night' : dow(today) % 6 === 0 ? 'weekend' : 'holiday', next };
}

/** Guarda a sessão de hoje que o Yahoo indica (corrige meios-dias e fechos especiais). */
export function noteSession(id, meta) {
  const p = meta?.currentTradingPeriod, mk = MARKETS[id];
  const sec = v => (Number.isFinite(v) ? v * 1000 : null);
  const open = sec(p?.regular?.start), close = sec(p?.regular?.end);
  if (!mk || !open || !close || close <= open || close - open > 12 * 3600_000) return;
  state.cache.sessions ??= {};
  state.cache.sessions[id] = { day: dateIn(open, mk.tz), open, close, ...(mk.post && sec(p.post?.end) > close ? { post: sec(p.post.end) } : {}) };
}

/** Bolsas das ações que tens (ou segues), pela ordem da lista de bolsas. */
export function marketsHeld(items) {
  const ids = new Set(items.filter(x => x.kind === 'stock').map(x => marketOf(x.quoteSymbol)).filter(Boolean));
  return Object.keys(MARKETS).filter(id => ids.has(id));
}

/** Preço do pré/pós-mercado guardado para um símbolo dos EUA, se fizer sentido mostrá-lo agora. */
export function extQuote(y, now = Date.now()) {
  const q = y ? state.cache.stockPrices[y] : null;
  if (!q?.ext || marketOf(y) !== 'us' || marketStatus('us', now).phase === 'open') return null;
  return now - q.ext.at < 20 * 3600_000 ? q.ext : null;
}

/**
 * Último preço fora do horário normal numa resposta intradiária do Yahoo (com includePrePost):
 * { price, pct, phase: 'pre' | 'post', at } face ao preço normal `regular`.
 */
export function extFromChart(d, regular, div = 1) {
  const r = d?.chart?.result?.[0];
  const ts = r?.timestamp, close = r?.indicators?.quote?.[0]?.close;
  if (!(regular > 0) || !Array.isArray(ts) || !Array.isArray(close) || r.meta?.dataGranularity === '1d') return null;
  for (let i = ts.length - 1; i >= 0; i--) {
    const c = close[i], t = ts[i] * 1000;
    if (!(c > 0) || !Number.isFinite(t)) continue;
    const s = sessionOn('us', dateIn(t, MARKETS.us.tz));
    if (!s || (t >= s.open && t < s.close)) return null;
    const price = c / div;
    return { price, pct: ((price - regular) / regular) * 100, phase: t < s.open ? 'pre' : 'post', at: t };
  }
  return null;
}

/* ---------- pré/pós-mercado da carteira e futuros ---------- */

/**
 * As tuas ações dos EUA fora do horário normal, com o efeito do pré/pós-mercado em cada uma (moeda de visualização).
 * No pré e no pós-mercado entram todas — as que ainda não tiveram negócios vêm com `e` a null.
 */
export function extRows(positions = state.positions, now = Date.now()) {
  const phase = marketStatus('us', now).phase;
  if (phase === 'open') return [];
  const rows = positions.flatMap(p => {
    if (p.kind !== 'stock' || marketOf(p.quoteSymbol) !== 'us') return [];
    const e = extQuote(p.quoteSymbol, now);
    if (!e && phase === 'closed') return [];
    const m = metrics(p);
    return m.live ? [{ p, e, m, effect: e ? conv(m.u * (e.price - m.nativePrice), m.nativeCur, disp()) : null }] : [];
  });
  const size = r => (r.e ? Math.abs(r.effect) : -1);
  return rows.sort((a, b) => size(b) - size(a));
}

/** Futuros dos índices dos EUA: antes da abertura indicam para onde vão os ETFs desses índices cotados na Europa. */
export const FUTURES = { sp500: { y: 'ES=F', name: 'S&P 500' }, ndx: { y: 'NQ=F', name: 'Nasdaq 100' } };

const INDEX_TICKERS = {
  VUAA: 'sp500', VUSA: 'sp500', CSPX: 'sp500', SXR8: 'sp500', IUSA: 'sp500', SPY5: 'sp500', SPXS: 'sp500', SPXP: 'sp500',
  EQQQ: 'ndx', CNDX: 'ndx', SXRV: 'ndx', EQQB: 'ndx', NQSE: 'ndx',
};
const INDEX_NAMES = [[/s\s*&\s*p\s*500/i, 'sp500'], [/nasdaq[\s-]*100/i, 'ndx']];

/** Índice dos EUA que um ETF cotado fora dos EUA segue (pelo ticker ou pelo nome). */
export function trackedIndex(p) {
  if (p?.kind !== 'stock' || !p.quoteSymbol || marketOf(p.quoteSymbol) === 'us') return null;
  const t = String(p.symbol || '').toUpperCase();
  if (INDEX_TICKERS[t]) return INDEX_TICKERS[t];
  return INDEX_NAMES.find(([re]) => re.test(p.name || ''))?.[1] ?? null;
}

/** Futuros que interessam: os dos índices dos teus ETFs e o do S&P 500 se tens ações dos EUA. */
export function futuresWanted(items) {
  const ids = new Set();
  for (const p of items) {
    const i = trackedIndex(p);
    if (i) ids.add(i);
    else if (p.kind === 'stock' && marketOf(p.quoteSymbol) === 'us') ids.add('sp500');
  }
  return Object.keys(FUTURES).filter(id => ids.has(id));
}

/** Os futuros só se mostram com a bolsa dos EUA fechada num dia útil (ao fim de semana param). */
export function futuresTime(now = Date.now()) {
  const st = marketStatus('us', now);
  return st.phase === 'pre' || st.phase === 'post' || (st.phase === 'closed' && st.reason === 'night');
}

export function futureQuote(id, now = Date.now()) {
  const q = state.cache.stockPrices[FUTURES[id]?.y];
  return q?.price > 0 && q.dayPct != null && now - (q.ts || 0) < 3 * 3600_000 ? q : null;
}
