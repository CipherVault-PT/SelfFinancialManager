import { state } from '../store.js';
import { avgDisp } from '../calc.js';
import { RANGES, fetchChart, fetchCoinChart } from '../quotes/chart.js';
import { marketOf, extPhaseAt, dayWord } from '../markets.js';
import { esc, money, price, pct, signed, units } from '../format.js';
import { $, openModal, modalOpen } from './dom.js';

const fmt = opts => new Intl.DateTimeFormat('pt-PT', opts);
const HM = { hour: '2-digit', minute: '2-digit' };
const F = {
  time: fmt(HM),
  wday: fmt({ weekday: 'short', ...HM }),
  dayTime: fmt({ day: 'numeric', month: 'short', ...HM }),
  day: fmt({ day: 'numeric', month: 'short' }),
  date: fmt({ day: 'numeric', month: 'short', year: 'numeric' }),
  month: fmt({ month: 'short', year: 'numeric' }),
};
/** Formato da hora na dica (tip) e no eixo, e o nome do período. */
const LOOK = {
  '1d': { tip: F.time, axis: F.time },
  '5d': { tip: F.wday, axis: F.day, name: '1 semana' },
  '1mo': { tip: F.dayTime, axis: F.day, name: '1 mês' },
  '6mo': { tip: F.date, axis: F.day, name: '6 meses' },
  '1y': { tip: F.date, axis: F.month, name: '1 ano' },
  '5y': { tip: F.date, axis: F.month, name: '5 anos' },
  max: { tip: F.month, axis: F.month, name: 'desde o início' },
};

const W = 680, H = 220, PAD = 10;
let lastRange = '1d', view = null, timer = 0;

/** Gráfico de uma posição: ação ou ETF (Yahoo) ou cripto (CoinGecko/Binance). */
export function modalChart(id) {
  const p = state.positions.find(x => x.id === id);
  const coin = p?.kind === 'crypto' && p.coingeckoId ? { id: p.coingeckoId, symbol: p.symbol, cur: p.currency } : null;
  if (!p || (!coin && !p.quoteSymbol)) return;
  const ad = avgDisp(p);
  open({ y: coin ? null : p.quoteSymbol, coin, name: p.name, sub: `${p.symbol || p.quoteSymbol} · ${p.platform}`, avg: ad.value > 0 ? ad : null, lots: p.lots ?? [] });
}

/** Gráfico de um ativo da lista "A seguir". */
export function modalWatchChart(id) {
  const w = state.watchlist.find(x => x.id === id);
  const coin = w?.kind === 'crypto' && w.coingeckoId ? { id: w.coingeckoId, symbol: w.symbol, cur: w.cur } : null;
  if (!w || (!coin && !w.quoteSymbol)) return;
  open({ y: coin ? null : w.quoteSymbol, coin, name: w.name, sub: coin ? w.symbol : w.quoteSymbol,
    target: w.target > 0 ? { value: w.target, cur: coin ? w.cur : w.quoteCur } : null });
}

function open(v) {
  view = { ...v, token: 0 };
  openModal(`<div class="mh"><h3>${esc(v.name)}</h3><button type="button" class="x" data-action="modal-close" aria-label="Fechar">✕</button></div>
    <div class="ch-sub">${esc(v.sub)}</div>
    <div class="seg chart-seg ch-seg" id="chSeg">${RANGES.map(r => `<button type="button" data-r="${r.id}" class="${r.id === lastRange ? 'on' : ''}">${r.label}</button>`).join('')}</div>
    <div id="chBody"><div class="ch-load">A carregar o gráfico…</div></div>`, { wide: true });
  $('#chSeg').onclick = e => {
    const b = e.target.closest('button[data-r]');
    if (!b || b.dataset.r === lastRange) return;
    lastRange = b.dataset.r;
    for (const x of $('#chSeg').children) x.classList.toggle('on', x === b);
    load(true);
  };
  load(true);
  clearInterval(timer);
  timer = setInterval(() => {
    if (!modalOpen() || !$('#chBody')) { clearInterval(timer); return; }
    if (lastRange === '1d' && document.visibilityState === 'visible') load(false);
  }, 60_000);
}

async function load(showLoading) {
  const my = ++view.token, range = lastRange, v = view;
  if (showLoading) $('#chBody').innerHTML = '<div class="ch-load">A carregar o gráfico…</div>';
  const data = await (v.coin ? fetchCoinChart(v.coin, range) : fetchChart(v.y, range)).catch(() => null);
  const body = $('#chBody');
  if (my !== v.token || v !== view || !body) return;
  if (!data) {
    if (showLoading) body.innerHTML = `<div class="ch-load">Sem dados agora — ${v.coin ? 'a CoinGecko e a Binance não responderam' : 'o Yahoo não respondeu'}. Tenta outra vez daqui a um minuto.</div>`;
    return;
  }
  body.innerHTML = draw(v, data, range);
  wire(body, v, data, range);
}

/** Linha de referência (fecho anterior, preço médio, alvo) que só entra se estiver perto dos preços do gráfico. */
const near = (r, lo, hi) => r > 0 && r >= lo - (hi - lo) * 0.35 && r <= hi + (hi - lo) * 0.35;

function scale(v, data, range) {
  const vals = data.pts.map(p => p[1]);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const refs = [];
  if (range === '1d' && data.prev) refs.push({ k: 'prev', v: data.prev, label: 'fecho anterior' });
  if (v.avg && v.avg.cur === data.cur) refs.push({ k: 'avg', v: v.avg.value, label: 'o teu preço médio' });
  if (v.target && (!v.target.cur || v.target.cur === data.cur)) refs.push({ k: 'target', v: v.target.value, label: 'alvo' });
  const shown = refs.filter(r => near(r.v, lo, hi));
  for (const r of shown) { lo = Math.min(lo, r.v); hi = Math.max(hi, r.v); }
  const span = hi - lo || hi * 0.01 || 1;
  lo -= span * 0.04; hi += span * 0.04;
  const n = data.pts.length;
  return {
    min: Math.min(...vals), max: Math.max(...vals), refs: shown, lo, hi,
    X: i => (i / (n - 1)) * W,
    Y: val => PAD + (1 - (val - lo) / (hi - lo)) * (H - 2 * PAD),
  };
}

/** Faixas do pré e do pós-mercado (só no 1D das ações dos EUA). */
function extBands(data, sc) {
  const out = [];
  let start = -1;
  data.pts.forEach(([t], i) => {
    const ext = extPhaseAt(t) != null;
    if (ext && start < 0) start = i;
    if ((!ext || i === data.pts.length - 1) && start >= 0) {
      const end = ext ? i : i - 1;
      out.push(`<rect x="${sc.X(Math.max(0, start - 0.5)).toFixed(1)}" y="0" width="${Math.max(2, sc.X(end + 0.5) - sc.X(start - 0.5)).toFixed(1)}" height="${H}" class="ch-ext"/>`);
      start = -1;
    }
  });
  return out.join('');
}

/** Compras da posição que caem dentro do período (no preço registado, se estiver na moeda do gráfico). */
function buyDots(v, data, sc, range) {
  if (!v.lots?.length || range === '1d') return '';
  const t0 = data.pts[0][0], tN = data.pts.at(-1)[0];
  return v.lots.flatMap(l => {
    const t = Date.parse(`${l.date}T12:00:00`);
    if (!Number.isFinite(t) || t < t0 - 86_400_000 || t > tN + 86_400_000) return [];
    let i = data.pts.findIndex(p => p[0] >= t - 43_200_000);
    if (i < 0) i = data.pts.length - 1;
    const own = l.priceQ > 0 && l.priceCur === data.cur && l.priceQ >= sc.lo && l.priceQ <= sc.hi;
    const at = own ? l.priceQ : data.pts[i][1];
    const tip = `Compra ${l.date}: ${units(l.shares)}${l.priceQ > 0 ? ` a ${price(l.priceQ, l.priceCur || data.cur)}` : ''}`;
    return [`<i class="ch-buy" style="left:${(sc.X(i) / W) * 100}%;top:${(sc.Y(at) / H) * 100}%" title="${esc(tip)}"></i>`];
  }).join('');
}

function draw(v, data, range) {
  const sc = scale(v, data, range), pts = data.pts, last = pts.at(-1)[1];
  const base = range === '1d' && data.prev ? data.prev : pts[0][1];
  const up = last >= base, col = up ? 'var(--up)' : 'var(--down)';
  const line = pts.map(([, p], i) => `${sc.X(i).toFixed(1)},${sc.Y(p).toFixed(1)}`).join(' ');
  const look = LOOK[range];
  const mid = pts[Math.floor((pts.length - 1) / 2)][0];
  const refs = sc.refs.map(r => `<line x1="0" x2="${W}" y1="${sc.Y(r.v).toFixed(1)}" y2="${sc.Y(r.v).toFixed(1)}" class="ch-line ${r.k}" vector-effect="non-scaling-stroke"/>`).join('');
  const refLabels = sc.refs.map(r => `<span class="ch-ref ${r.k}" style="top:${(sc.Y(r.v) / H) * 100}%">${esc(r.label)} ${price(r.v, data.cur)}</span>`).join('');
  const ext = range === '1d' && marketOf(v.y) === 'us' ? extBands(data, sc) : '';
  const stats = [
    `Mín <b>${price(sc.min, data.cur)}</b>`, `Máx <b>${price(sc.max, data.cur)}</b>`,
    v.avg && v.avg.cur === data.cur && `Preço médio <b>${price(v.avg.value, data.cur)}</b> <span class="${last >= v.avg.value ? 'up' : 'down'}">${pct((last / v.avg.value - 1) * 100)}</span>`,
    v.target && `Alvo <b>${price(v.target.value, v.target.cur || data.cur)}</b>`,
  ].filter(Boolean);
  return `<div class="ch-top">
      <div class="ch-px mono" id="chPx">${price(last, data.cur)}</div>
      <div class="ch-chg ${up ? 'up' : 'down'}" id="chChg"></div>
    </div>
    <div class="ch-wrap" id="chWrap">
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="ch-svg" role="img" aria-label="Gráfico de ${esc(v.name)}">
        <defs><linearGradient id="chg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${up ? 'rgba(84,194,149,.28)' : 'rgba(227,123,97,.28)'}"/><stop offset="1" stop-color="rgba(0,0,0,0)"/></linearGradient></defs>
        ${ext}${refs}
        <polygon points="0,${H} ${line} ${W},${H}" fill="url(#chg)"/>
        <polyline points="${line}" fill="none" stroke="${col}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
      </svg>
      ${refLabels}${buyDots(v, data, sc, range)}
      <i class="ch-x" id="chX" hidden></i><i class="ch-dot" id="chDot" hidden style="--c:${col}"></i>
    </div>
    <div class="chart-axis"><span>${esc(look.axis.format(pts[0][0]))}</span><span>${esc(look.axis.format(mid))}</span><span>${esc(look.axis.format(pts.at(-1)[0]))}</span></div>
    <div class="ch-stats">${stats.map(s => `<span>${s}</span>`).join('')}</div>
    ${ext ? '<div class="ch-note">Zonas sombreadas: pré e pós-mercado.</div>' : ''}
    ${v.coin ? `<div class="ch-note">Fonte: ${data.src === 'binance' ? 'Binance' : 'CoinGecko'}${data.approx ? ' — preços em dólares convertidos ao câmbio de hoje (aproximado)' : ''}${data.capped ? ' — só há o último ano para esta moeda' : ''}.</div>` : ''}
    ${v.lots?.length && range !== '1d' ? '<div class="ch-note">Os pontos dourados são as tuas compras.</div>' : ''}`;
}

/** Arrastar o dedo (ou o rato) pelo gráfico mostra o preço e a hora de cada ponto. */
function wire(body, v, data, range) {
  const sc = scale(v, data, range), pts = data.pts, look = LOOK[range];
  const base = range === '1d' && data.prev ? data.prev : pts[0][1];
  const wrap = $('#chWrap', body), x = $('#chX', body), dot = $('#chDot', body);
  const show = i => {
    const [t, p] = pts[i], d = p - base, isLast = i === pts.length - 1;
    $('#chPx', body).textContent = price(p, data.cur);
    const chg = $('#chChg', body);
    chg.className = `ch-chg ${d >= 0 ? 'up' : 'down'}`;
    const when = isLast ? (range !== '1d' ? (data.capped ? '1 ano' : look.name) : v.coin ? '24 h' : dayWord(t)) : look.tip.format(t);
    chg.innerHTML = `${signed(d, money(d, data.cur))} · ${pct(base > 0 ? (d / base) * 100 : 0)} <span>${esc(when)}</span>`;
  };
  const move = e => {
    const r = wrap.getBoundingClientRect();
    const i = Math.max(0, Math.min(pts.length - 1, Math.round(((e.clientX - r.left) / r.width) * (pts.length - 1))));
    const left = `${(sc.X(i) / W) * 100}%`;
    x.hidden = dot.hidden = false;
    x.style.left = dot.style.left = left;
    dot.style.top = `${(sc.Y(pts[i][1]) / H) * 100}%`;
    show(i);
  };
  const reset = () => { x.hidden = dot.hidden = true; show(pts.length - 1); };
  wrap.onpointerdown = wrap.onpointermove = move;
  wrap.onpointerleave = wrap.onpointercancel = reset;
  wrap.onpointerup = e => { if (e.pointerType !== 'mouse') reset(); };
  reset();
}
