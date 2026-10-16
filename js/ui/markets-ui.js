import { state } from '../store.js';
import { conv, disp } from '../fx.js';
import { qty, priceInfo } from '../calc.js';
import { MARKETS, marketStatus, marketsHeld, extQuote } from '../markets.js';
import { esc, money, price, pct, signed } from '../format.js';
import { openModal } from './dom.js';

const PHASE = { open: 'Aberta', pre: 'Pré-mercado', post: 'Pós-mercado', closed: 'Fechada' };
const DAYS = ['dom.', 'seg.', 'ter.', 'qua.', 'qui.', 'sex.', 'sáb.'];

const hm = ts => new Date(ts).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
const localDay = ts => { const d = new Date(ts); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };

/** "14:30", "amanhã 14:30" ou "seg. 14:30" (na hora do dispositivo). */
function when(ts, now = Date.now()) {
  const days = Math.round((localDay(ts) - localDay(now)) / 86_400_000);
  if (days <= 0) return hm(ts);
  return `${days === 1 ? 'amanhã' : DAYS[new Date(ts).getDay()]} ${hm(ts)}`;
}

function statusText(st, now) {
  if (st.phase === 'open') return `fecha ${hm(st.until)}`;
  if (st.phase === 'pre') return `abre ${hm(st.until)}`;
  if (st.phase === 'post') return `até ${hm(st.until)}`;
  return st.next ? `abre ${when(st.next.open, now)}` : '';
}

/** Quanto as tuas ações dos EUA mexem no pré/pós-mercado, na moeda de visualização. */
export function extMove(now = Date.now()) {
  let sum = 0, any = false;
  for (const p of state.positions) {
    if (p.kind !== 'stock') continue;
    const e = extQuote(p.quoteSymbol, now), pi = priceInfo(p);
    if (!e || !pi.live) continue;
    sum += conv(qty(p) * (e.price - pi.price), pi.cur, disp());
    any = true;
  }
  return any ? sum : null;
}

/** Faixa com o estado das bolsas das tuas ações (e das que segues). */
export function marketStrip(items, now = Date.now()) {
  const ids = marketsHeld(items);
  if (!ids.length) return '';
  const move = extMove(now);
  return ids.map(id => {
    const mk = MARKETS[id], st = marketStatus(id, now);
    const mv = id === 'us' && move != null && (st.phase === 'pre' || st.phase === 'post')
      ? ` <span class="mk-x ${move >= 0 ? 'up' : 'down'}">${signed(move, money(move, disp()))}</span>` : '';
    return `<button type="button" class="mk" data-action="markets" title="${esc(mk.full)}">
      <span class="mk-f" aria-hidden="true">${mk.flag}</span><b>${esc(mk.name)}</b>
      <span class="mk-dot ${st.phase}" aria-hidden="true"></span><span class="mk-st">${PHASE[st.phase]}</span>
      <span class="mk-t">${esc(statusText(st, now))}</span>${mv}</button>`;
  }).join('');
}

/** Linha do pré/pós-mercado num cartão de ação dos EUA. */
export function extLine(p, m) {
  const e = p.kind === 'stock' ? extQuote(p.quoteSymbol) : null;
  if (!e || !m.live) return '';
  const delta = conv(m.u * (e.price - m.nativePrice), m.nativeCur, p.currency);
  return `<div class="extline">${e.phase === 'pre' ? '🌅 Pré-mercado' : '🌙 Pós-mercado'}
    <b class="mono">${price(e.price, m.nativeCur)}</b> <span class="${e.pct >= 0 ? 'up' : 'down'}">${pct(e.pct)}</span>
    <span class="muted">· ${signed(delta, money(delta, p.currency))}</span></div>`;
}

const range = (a, b) => `${hm(a)}–${hm(b)}`;

export function modalMarkets() {
  const now = Date.now();
  const held = new Set(marketsHeld([...state.positions, ...(state.watchlist ?? [])]));
  const usOpen = marketStatus('us', now);
  const usNext = usOpen.session ?? usOpen.next;
  const rows = Object.keys(MARKETS).sort((a, b) => held.has(b) - held.has(a)).map(id => {
    const mk = MARKETS[id], st = marketStatus(id, now), s = st.session ?? st.next;
    const ext = s?.pre ? `<div class="mk-ext">pré ${range(s.pre, s.open)} · pós ${range(s.close, s.post)}</div>` : '';
    const why = st.phase === 'closed' && st.reason !== 'night' ? ` · ${st.reason === 'weekend' ? 'fim de semana' : 'feriado'}` : '';
    return `<div class="mk-row${held.has(id) ? ' held' : ''}">
      <div class="mk-n"><span aria-hidden="true">${mk.flag}</span> <b>${esc(mk.name)}</b><small>${esc(mk.full)}</small></div>
      <div class="mk-h mono">${s ? range(s.open, s.close) : '—'}${ext}</div>
      <div class="mk-s"><span class="mk-dot ${st.phase}" aria-hidden="true"></span>${PHASE[st.phase]}<small>${esc(statusText(st, now))}${why}</small></div></div>`;
  }).join('');
  const usTxt = usNext ? `${hm(usNext.open)} às ${hm(usNext.close)}` : '';
  openModal(`<div class="mh"><h3>Horário das bolsas</h3><button type="button" class="x" data-action="modal-close" aria-label="Fechar">✕</button></div>
    <p class="mlead">Na <b>tua hora</b> (já com a mudança de hora de cada país). ${held.size ? 'Em cima, as bolsas das tuas ações.' : ''}</p>
    <div class="mk-tbl">${rows}</div>
    <div class="perf-notes">
      <div><b>Pré e pós-mercado</b> só existem nos EUA: dá para negociar antes da abertura e depois do fecho, com menos volume e preços mais instáveis. A app mostra esses preços nas tuas ações dos EUA, mas o valor da carteira conta com o preço do horário normal.</div>
      <div><b>S&amp;P 500</b> é um índice dos EUA: mexe das ${esc(usTxt || '14:30 às 21:00')}. Os ETFs dele cotados na Europa (ex.: VUAA, CSPX) negoceiam no horário da bolsa europeia — por isso parecem "abrir às 8h".</div>
      <div><b>Mudança de hora</b>: a Europa e os EUA não mudam no mesmo dia. Nessas semanas (fim de março e fim de outubro) a bolsa dos EUA abre uma hora mais cedo cá — a app já conta com isso.</div>
      <div>A tua corretora pode ter horário alargado noutros mercados (ex.: a Trade Republic negoceia na LS Exchange das 7:30 às 23:00 de Frankfurt). Feriados: os principais de cada bolsa.</div>
    </div>`, { wide: true });
}

