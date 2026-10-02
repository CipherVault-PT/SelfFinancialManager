import { PLATFORM_CLASS, REFRESH } from '../config.js';
import { state } from '../store.js';
import { disp, conv, fxRate } from '../fx.js';
import { agg, metrics, closedM, avgDisp, cashBal, pCost } from '../calc.js';
import { alertsFor } from '../alerts.js';
import { net } from '../quotes/index.js';
import { esc, money, moneyParts, price, pct, signed, units, ago, sym, plural } from '../format.js';
import { $, $$ } from './dom.js';

const CLR = { crypto: 'var(--brass)', stock: 'var(--indigo)', cash: 'var(--slate)' };
const platClass = p => PLATFORM_CLASS[p] ?? '';
const upDown = v => (v >= 0 ? 'up' : 'down');

export const ui = { tab: 'painel', chartDays: 90, expanded: new Set() };

export function renderAll() {
  const a = agg();
  renderHero(a);
  renderTiles(a);
  renderCounts();
  renderView(a);
  renderStatus();
  for (const b of $$('#curSeg button')) b.classList.toggle('on', b.dataset.cur === disp());
}

function renderHero(a) {
  const d = disp();
  const { int, dec, symbol } = moneyParts(a.netWorth, d);
  $('#nw').innerHTML = `<span class="cur">${esc(symbol)}</span>${esc(int)}<span class="dec">${esc(dec)}</span>`;

  $('#heroSub').innerHTML = state.positions.length
    ? `<span class="chg ${a.dayChange >= 0 ? 'pos' : 'neg'}"><span class="arw">${a.dayChange >= 0 ? '▲' : '▼'}</span><span class="lbl">Hoje</span> ${signed(a.dayChange, money(a.dayChange, d))} <span>(${pct(a.dayP)})</span></span>
       <span class="chg ${a.unreal >= 0 ? 'pos' : 'neg'}" style="background:transparent"><span class="lbl">Não realizado</span> ${signed(a.unreal, money(a.unreal, d))} <span>(${pct(a.unrealP)})</span></span>`
    : `<span class="chg" style="background:var(--surface-2);color:var(--muted)"><span class="lbl">Sem posições abertas — adiciona a primeira</span></span>`;

  const tot = a.cryptoV + a.stockV + a.cashV;
  const segs = tot > 0
    ? [['Cripto', a.cryptoV, CLR.crypto], ['Ações', a.stockV, CLR.stock], ['Fundo', a.cashV, CLR.cash]].filter(s => s[1] > 0)
    : [];
  $('#ribbon').innerHTML = segs.map(([, v, c]) => `<span style="width:${(v / tot) * 100}%;background:${c}"></span>`).join('');
  $('#rleg').innerHTML = segs.map(([n, v, c]) => `<div><i style="background:${c}"></i>${n} <b>${((v / tot) * 100).toFixed(0)}%</b></div>`).join('');
}

function renderTiles(a) {
  const d = disp();
  const tiles = [
    ['Investido (aberto)', money(a.inv, d), plural(state.positions.length, 'posição', 'posições'), ''],
    ['Valor atual', money(a.val, d), signed(a.unreal, money(a.unreal, d)), upDown(a.unreal)],
    ['Realizado (sempre)', money(a.realized, d), plural(a.closedN, 'fechada', 'fechadas'), a.closedN ? upDown(a.realized) : ''],
    ['Fundo / Cash', money(a.cashV, d), state.cash.length ? plural(state.cash.length, 'conta', 'contas') : '—', ''],
  ];
  $('#tiles').innerHTML = tiles.map(([k, v, s, c]) =>
    `<div class="tile"><div class="k">${k}</div><div class="v">${v}</div><div class="s ${c}">${s}</div></div>`).join('');
}

function renderCounts() {
  $('#cOpen').textContent = state.positions.length || '';
  $('#cClosed').textContent = state.closed.length || '';
}

export function renderView(a = agg()) {
  const v = $('#view');
  v.innerHTML = ui.tab === 'posicoes' ? viewPositions() : ui.tab === 'historico' ? viewHistory() : viewDashboard(a);
}

export function renderStatus() {
  const dot = $('#dot'), txt = $('#statusTxt');
  const last = Math.max(state.cache.updated || 0, state.cache.stockUpdated || 0) || null;
  const fx = `1 € = ${fxRate().toFixed(4).replace('.', ',')} $`;
  const misses = net.stocks?.fail || 0;
  let label;
  if (net.busy && (net.manual || !last)) label = 'A atualizar…';
  else if (!state.positions.length) label = fx;
  else if (!last) label = `Sem cotações · ${fx}`;
  else label = `Cotações ${ago(last)} · ${fx}${misses ? ` · ${misses} sem cotação` : ''}`;
  txt.textContent = label;
  $('.status').title = label;
  dot.classList.toggle('stale', !last || Date.now() - last > REFRESH.liveQuoteMs);
  $('#btnRefresh').classList.toggle('spin', net.busy > 0 && net.manual);
}

function empty(title, text, btn, action) {
  return `<div class="empty"><div class="ei"></div><h4>${title}</h4><p>${text}</p><button class="btn pri" data-action="${action}">${btn}</button></div>`;
}

function liveTag(p, m) {
  if (m.live) {
    const fresh = m.ts && Date.now() - m.ts < REFRESH.liveQuoteMs;
    return `<span class="livetag${fresh ? '' : ' old'}">● ${fresh ? 'ao vivo' : esc(ago(m.ts))}</span>`;
  }
  return `<span class="manualtag">${p.kind === 'stock' ? 'manual' : 'sem cotação'}</span>`;
}

function positionCard(p) {
  const m = metrics(p);
  const st = m.plPos > 0 ? 'g' : m.plPos < 0 ? 'l' : 'n';
  const plc = upDown(m.plPos);
  const icon = p.kind === 'crypto' && p.thumb
    ? `<img src="${esc(p.thumb)}" alt="" loading="lazy">`
    : esc((p.symbol || p.name).slice(0, 3).toUpperCase());
  const isStock = p.kind === 'stock';
  const lots = p.lots;
  const id = esc(p.id);
  const open = ui.expanded.has(p.id);
  const ad = avgDisp(p);
  const lotsHtml = lots.length > 1 ? `<div class="lots"${open ? '' : ' hidden'}>
      ${lots.map((l, i) => {
        const lp = l.priceQ > 0 ? l.priceQ : (l.shares > 0 ? l.cost / l.shares : 0);
        const lpc = l.priceQ > 0 && l.priceCur ? l.priceCur : p.currency;
        return `<div class="lot"><span>${i + 1}. ${units(l.shares)} @ ${price(lp, lpc)}</span><span class="lc">${money(l.cost, p.currency)}${l.date ? ` · ${esc(l.date)}` : ''}</span></div>`;
      }).join('')}
    </div>` : '';
  const hasAlert = alertsFor(p.id).some(a => a.active);
  return `<article class="pos ${st}">
    <div class="pos-top">
      <div class="tkn">${icon}</div>
      <div style="min-width:0">
        <div class="nm">${esc(p.name)} <span class="chip ${platClass(p.platform)}">${esc(p.platform)}</span></div>
        <div class="sub">${units(m.u)} ${esc(p.symbol || '')} · conta ${esc(sym(p.currency))}${m.nativeCur !== p.currency ? ` · cota ${esc(m.nativeCur)}` : ''} ${liveTag(p, m)}</div>
      </div>
      <div class="pos-r">
        <div class="pl ${plc}">${signed(m.plPos, money(m.plPos, p.currency))}</div>
        <div class="plp ${plc}">${pct(m.plp)}</div>
        ${m.dayPct != null ? `<div class="day ${upDown(m.dayPct)}">hoje ${pct(m.dayPct)}</div>` : ''}
      </div>
    </div>
    <div class="pos-grid">
      <div class="pg"><span class="gk">Preço médio</span><span class="gv">${price(ad.value, ad.cur)}${lots.length > 1 ? ` <button class="nent" data-action="toggle-lots" data-id="${id}" aria-expanded="${open}">· ${lots.length} entradas ${open ? '▴' : '▾'}</button>` : ''}</span></div>
      <div class="pg"><span class="gk">Custo · Valor</span><span class="gv">${money(m.cost, p.currency)} · ${money(m.valPos, p.currency)}</span></div>
      <div class="pg"><span class="gk">Cotação ${esc(m.nativeCur)}</span><span class="gv">${price(m.nativePrice, m.nativeCur)}</span></div>
    </div>
    ${lotsHtml}
    <div class="pos-act">
      <button class="btn ghost" data-action="reinforce" data-id="${id}">＋ Reforçar</button>
      ${isStock && !m.live ? `<button class="btn ghost" data-action="price" data-id="${id}">Preço atual</button>` : ''}
      <button class="btn" data-action="close" data-id="${id}">Fechar</button>
      <button class="btn xic ${hasAlert ? 'on' : ''}" data-action="alert" data-id="${id}" title="Alerta de preço" aria-label="Alertas de preço">🔔</button>
      <button class="btn xic" data-action="delete" data-id="${id}" title="Apagar (corrigir erro)" aria-label="Apagar posição">🗑</button>
    </div>
  </article>`;
}

function viewPositions() {
  if (!state.positions.length) {
    return empty('Ainda sem posições', 'Regista a tua primeira entrada. A app calcula as unidades, o lucro ao vivo e a percentagem — tudo por ti.', 'Adicionar posição', 'add');
  }
  return `<div class="sh"><h3>Posições abertas</h3><button class="btn ghost" data-action="cash">＋ Fundo / Cash</button></div>
    <div class="plist">${state.positions.map(positionCard).join('')}</div>`;
}

const CHART_RANGES = [[30, '1M'], [90, '3M'], [365, '1A'], [0, 'Tudo']];

function historyChart() {
  const all = state.history;
  const h = ui.chartDays ? all.slice(-ui.chartDays) : all;
  const d = disp();
  const head = `<div class="chart-head"><div class="k">Evolução do património</div>
    ${all.length >= 2 ? `<div class="seg chart-seg">${CHART_RANGES.map(([n, l]) => `<button data-action="chart-range" data-days="${n}" class="${ui.chartDays === n ? 'on' : ''}">${l}</button>`).join('')}</div>` : ''}</div>`;
  if (h.length < 2) {
    return `<div class="chartbox">${head}<div class="chart-empty">O gráfico desenha-se sozinho — um ponto por dia. Deixa a app registar e volta para veres a evolução da tua carteira.</div></div>`;
  }
  const vals = h.map(x => conv(x.v, 'EUR', d));
  const W = 680, H = 170, pad = 8;
  const min = Math.min(...vals), max = Math.max(...vals), rng = max - min || 1;
  const X = i => pad + (i / (vals.length - 1)) * (W - 2 * pad);
  const Y = v => pad + (1 - (v - min) / rng) * (H - 2 * pad);
  const pts = vals.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(' ');
  const first = vals[0], lastV = vals.at(-1), chg = lastV - first, chgp = first > 0 ? (chg / first) * 100 : 0;
  const up = chg >= 0, col = up ? 'var(--up)' : 'var(--down)';
  return `<div class="chartbox">${head}
    <div class="chart-chg ${up ? 'up' : 'down'}">${signed(chg, money(chg, d))} · ${pct(chgp)} <span style="color:var(--muted-2);font-weight:400">· ${h.length} dias</span></div>
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="spark" role="img" aria-label="Evolução do património">
      <defs><linearGradient id="cg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${up ? 'rgba(84,194,149,.3)' : 'rgba(227,123,97,.3)'}"/><stop offset="1" stop-color="rgba(0,0,0,0)"/></linearGradient></defs>
      <polygon points="${pad},${H - pad} ${pts} ${W - pad},${H - pad}" fill="url(#cg)"/>
      <polyline points="${pts}" fill="none" stroke="${col}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
    </svg>
    <div class="chart-axis"><span>${esc(h[0].d)}</span><span>${money(min, d)} – ${money(max, d)}</span><span>${esc(h.at(-1).d)}</span></div></div>`;
}

function viewDashboard(a) {
  if (!state.positions.length && !state.cash.length && !state.closed.length) {
    return empty('Bem-vindo à Aurora', 'A tua carteira toda num sítio — cripto, ações e ETFs da Revolut, XTB e Trade Republic, ao vivo. Começa por registar uma posição.', 'Adicionar primeira posição', 'add');
  }
  const d = disp();
  const rows = state.positions.map(p => ({ p, m: metrics(p) }));

  const byP = {};
  for (const { p, m } of rows) byP[p.platform] = (byP[p.platform] || 0) + m.valD;
  for (const c of state.cash) { const k = c.platform || 'Outra'; byP[k] = (byP[k] || 0) + conv(cashBal(c), c.currency); }
  const totP = Object.values(byP).reduce((s, v) => s + v, 0) || 1;
  const platRows = Object.entries(byP).sort((x, y) => y[1] - x[1]).map(([k, v]) => `
    <div class="brow"><div class="bl"><span class="chip ${platClass(k)}">${esc(k)}</span></div>
      <div class="bt"><i style="width:${(v / totP) * 100}%;background:var(--brass)"></i></div>
      <div class="bv">${money(v, d)}</div></div>`).join('') || '<div class="searching">—</div>';

  const totA = rows.reduce((s, r) => s + r.m.valD, 0) || 1;
  const assetRows = [...rows].sort((x, y) => y.m.valD - x.m.valD).slice(0, 6).map(({ p, m }) => `
    <div class="brow"><div class="bl" title="${esc(p.name)}">${esc(p.name)}</div>
      <div class="bt"><i style="width:${(m.valD / totA) * 100}%;background:${CLR[p.kind]}"></i></div>
      <div class="bv ${upDown(m.plD)}">${pct(m.plp)}</div></div>`).join('') || '<div class="searching">Sem posições abertas</div>';

  const ranked = rows.filter(r => r.m.cost > 0).sort((x, y) => y.m.plp - x.m.plp);
  const best = ranked[0], worst = ranked.length > 1 ? ranked.at(-1) : null;
  const tile = (k, v, s, cls = '', small = true) =>
    `<div class="tile"><div class="k">${k}</div><div class="v ${cls}"${small ? ' style="font-size:19px"' : ''}>${v}</div><div class="s">${s}</div></div>`;
  const stats = `<div class="stats">
    ${tile('Melhor posição', best ? pct(best.m.plp) : '—', best ? esc(best.p.name) : 'sem posições', best ? upDown(best.m.plp) : '')}
    ${tile('Pior posição', worst ? pct(worst.m.plp) : '—', worst ? esc(worst.p.name) : '', worst ? upDown(worst.m.plp) : '')}
    ${tile('Exposição cripto', a.val > 0 ? `${((a.cryptoV / a.val) * 100).toFixed(0)}%` : '—', 'do valor em aberto', '', false)}
    ${tile(`Realizado${a.closedN ? ` · ${a.winRate.toFixed(0)}% acerto` : ''}`, a.closedN ? money(a.realized, d) : '—', plural(a.closedN, 'trade fechado', 'trades fechados'), a.closedN ? upDown(a.realized) : '')}
  </div>`;

  return `${historyChart()}${stats}<div class="two">
    <div><div class="sh"><h3>Por plataforma</h3><span class="hint">valor atual</span></div><div class="bd">${platRows}</div></div>
    <div><div class="sh"><h3>Por ativo</h3><span class="hint">peso · rendimento</span></div><div class="bd">${assetRows}</div></div>
  </div>`;
}

function viewHistory() {
  if (!state.closed.length) {
    return empty('Sem histórico ainda', 'Quando fechares uma posição, ela aparece aqui com o lucro realizado, a percentagem e as datas — o teu registo completo.', 'Ver posições', 'go-positions');
  }
  const d = disp();
  const rows = [...state.closed].reverse().map(p => {
    const m = closedM(p), plc = upDown(m.pl);
    return `<div class="hrow">
      <div class="nm">${esc(p.name)} <small>${esc(p.platform)} · ${esc(sym(p.currency))}${p.closedAt ? ` · ${esc(p.closedAt)}` : ''}</small></div>
      <div class="r">${units(m.u)}</div>
      <div class="r">${money(pCost(p), p.currency)} → ${money(m.proceeds, p.currency)}</div>
      <div class="r ${plc}">${signed(m.pl, money(m.pl, p.currency))}</div>
      <div class="r ${plc}">${pct(m.plp)}</div>
      <div class="r"><button class="x danger hx" data-action="delete-closed" data-id="${esc(p.id)}" title="Apagar registo" aria-label="Apagar registo">✕</button></div>
    </div>`;
  }).join('');
  const tot = state.closed.reduce((s, p) => s + closedM(p).plD, 0);
  return `<div class="sh"><h3>Trades fechados</h3><span class="hint">total realizado: <b class="mono ${upDown(tot)}">${signed(tot, money(tot, d))}</b></span></div>
    <div class="htbl"><div class="hscroll">
      <div class="hrow hh"><div>Ativo</div><div class="r">Unid.</div><div class="r">Custo → Recebido</div><div class="r">Resultado</div><div class="r">%</div><div></div></div>
      ${rows}
    </div></div>`;
}
