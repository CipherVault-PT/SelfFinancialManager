import { PLATFORM_CLASS, REFRESH } from '../config.js';
import { state } from '../store.js';
import { disp, conv, fxRate } from '../fx.js';
import { agg, metrics, closedM, avgDisp, cashBal, pCost } from '../calc.js';
import { alertsFor } from '../alerts.js';
import { dividendTotal, dividendStats, netOf } from '../dividends.js';
import { allocation, concentration, unclassified, UNKNOWN, CRYPTO } from '../allocation.js';
import { FLAGS } from '../data/classification.js';
import { performance, benchmarkCompare, benchSeries, benchState, BENCHMARK, MIN_DAYS } from '../performance.js';
import { net } from '../quotes/index.js';
import { backupDue, daysSinceBackup } from '../backup.js';
import { saleCashLabel } from '../cash.js';
import { syncBadge } from './modal-sync.js';
import { hicpSeries, inflationSince, realRate } from '../inflation.js';
import { plansDue, validPlan, plansMonthly } from '../plans.js';
import { monthsToGoal, addMonths, fourPercentMonthly, DEFAULT_RATE } from '../goals.js';
import { holdings, suggest } from '../rebalance.js';
import { esc, money, moneyParts, price, pct, signed, units, ago, sym, plural } from '../format.js';
import { $, $$ } from './dom.js';
import { marketStrip, extLine } from './markets-ui.js';
import { viewWatch } from './watch-ui.js';
import { journalLine, journalSection } from './modal-journal.js';

const CLR = { crypto: 'var(--brass)', stock: 'var(--indigo)', cash: 'var(--slate)' };
const platClass = p => PLATFORM_CLASS[p] ?? '';
const upDown = v => (v >= 0 ? 'up' : 'down');

export const ui = { tab: 'painel', chartDays: 90, expanded: new Set(), allocDim: 'sector', rbAmount: null, journalPeriod: 'year' };

export function renderAll() {
  const a = agg();
  renderHero(a);
  renderMarkets();
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
    ? `<span class="chg ${a.dayChange >= 0 ? 'gain' : 'loss'}"><span class="arw">${a.dayChange >= 0 ? '▲' : '▼'}</span><span class="lbl">Hoje</span> ${signed(a.dayChange, money(a.dayChange, d))} <span>(${pct(a.dayP)})</span></span>
       <span class="chg ${a.unreal >= 0 ? 'gain' : 'loss'}" style="background:transparent"><span class="lbl">Não realizado</span> ${signed(a.unreal, money(a.unreal, d))} <span>(${pct(a.unrealP)})</span></span>`
    : `<span class="chg" style="background:var(--surface-2);color:var(--muted)"><span class="lbl">Sem posições abertas — adiciona a primeira</span></span>`;

  const tot = a.cryptoV + a.stockV + a.cashV;
  const segs = tot > 0
    ? [['Cripto', a.cryptoV, CLR.crypto], ['Ações', a.stockV, CLR.stock], ['Fundo', a.cashV, CLR.cash]].filter(s => s[1] > 0)
    : [];
  $('#ribbon').innerHTML = segs.map(([, v, c]) => `<span style="width:${(v / tot) * 100}%;background:${c}"></span>`).join('');
  $('#rleg').innerHTML = segs.map(([n, v, c]) => `<div><i style="background:${c}"></i>${n} <b>${((v / tot) * 100).toFixed(0)}%</b></div>`).join('');
}

export function renderMarkets() {
  const el = $('#mkts');
  el.innerHTML = marketStrip([...state.positions, ...state.watchlist]);
  el.hidden = !el.innerHTML;
}

function renderTiles(a) {
  const d = disp();
  const tiles = [
    ['Investido (aberto)', money(a.inv, d), plural(state.positions.length, 'posição', 'posições'), ''],
    ['Valor atual', money(a.val, d), signed(a.unreal, money(a.unreal, d)), upDown(a.unreal)],
    ['Realizado (sempre)', money(a.realized, d), plural(a.closedN, 'fechada', 'fechadas'), a.closedN ? upDown(a.realized) : ''],
    ['Fundo / Cash', money(a.cashV, d), state.cash.length ? `${plural(state.cash.length, 'conta', 'contas')} ›` : 'adicionar ›', '', 'cash'],
  ];
  $('#tiles').innerHTML = tiles.map(([k, v, s, c, action]) => action
    ? `<button type="button" class="tile tile-btn" data-action="${action}"><div class="k">${k}</div><div class="v">${v}</div><div class="s ${c}">${s}</div></button>`
    : `<div class="tile"><div class="k">${k}</div><div class="v">${v}</div><div class="s ${c}">${s}</div></div>`).join('');
}

function renderCounts() {
  $('#cOpen').textContent = state.positions.length || '';
  $('#cWatch').textContent = state.watchlist.length || '';
  $('#cClosed').textContent = state.closed.length || '';
}

export function renderView(a = agg()) {
  const v = $('#view');
  v.innerHTML = ui.tab === 'posicoes' ? viewPositions() : ui.tab === 'seguir' ? viewWatch() : ui.tab === 'historico' ? viewHistory() : viewDashboard(a);
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
  const cloud = syncBadge();
  txt.textContent = cloud ? `${label} · ${cloud}` : label;
  $('.status').title = txt.textContent;
  dot.classList.toggle('stale', !last || Date.now() - last > REFRESH.liveQuoteMs);
  $('#btnRefresh').classList.toggle('spin', net.busy > 0 && net.manual);
}

function empty(title, text, btn, action, alt = null) {
  return `<div class="empty"><div class="ei"></div><h4>${title}</h4><p>${text}</p><button class="btn pri" data-action="${action}">${btn}</button>${alt ? `<button class="lnk empty-alt" data-action="${alt[1]}">${alt[0]}</button>` : ''}</div>`;
}

const IMPORT_ALT = ['ou importa o extrato da XTB', 'import'];

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
  const divNet = isStock ? dividendTotal(p.id, p.currency) : 0;
  const totalRet = m.cost > 0 ? ((m.plPos + divNet) / m.cost) * 100 : 0;
  return `<article class="pos ${st}">
    <div class="pos-top">
      <div class="tkn">${icon}</div>
      <div style="min-width:0">
        <div class="nm">${esc(p.name)} <span class="chip ${platClass(p.platform)}">${esc(p.platform)}</span></div>
        <div class="sub">${units(m.u)} ${esc(p.symbol || '')} · conta ${esc(sym(p.currency))}${m.nativeCur !== p.currency ? ` · cota ${esc(m.nativeCur)}` : ''} ${liveTag(p, m)}${validPlan(p.plan) ? ` <span class="plantag">🔁 ${money(p.plan.amount, p.currency)}/mês · dia ${p.plan.day}</span>` : ''}</div>
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
    ${extLine(p, m)}
    ${journalLine(p, m)}
    ${divNet ? `<div class="divline">💰 Dividendos <b class="up">${signed(divNet, money(divNet, p.currency))}</b> · retorno total <b class="${upDown(totalRet)}">${pct(totalRet)}</b></div>` : ''}
    ${lotsHtml}
    <div class="pos-act">
      <div class="acts-main">
        <button class="btn ghost" data-action="reinforce" data-id="${id}">＋ Reforçar</button>
        ${isStock && !m.live ? `<button class="btn ghost" data-action="price" data-id="${id}">Preço atual</button>` : ''}
        <button class="btn" data-action="close" data-id="${id}">Vender</button>
      </div>
      <div class="acts-ic">
      <button class="btn xic ${validPlan(p.plan) ? 'on' : ''}" data-action="plan" data-id="${id}" title="Plano mensal" aria-label="Plano de poupança mensal">🔁</button>
      ${isStock ? `<button class="btn xic ${divNet ? 'on' : ''}" data-action="dividend" data-id="${id}" title="Dividendos" aria-label="Dividendos">💰</button>` : ''}
      <button class="btn xic ${p.journal ? 'on' : ''}" data-action="journal" data-id="${id}" title="Diário: tese, alvo e stop" aria-label="Diário da posição">📓</button>
      <button class="btn xic ${hasAlert ? 'on' : ''}" data-action="alert" data-id="${id}" title="Alerta de preço" aria-label="Alertas de preço">🔔</button>
      <button class="btn xic" data-action="delete" data-id="${id}" title="Apagar (corrigir erro)" aria-label="Apagar posição">🗑</button>
      </div>
    </div>
  </article>`;
}

function viewPositions() {
  if (!state.positions.length) {
    return empty('Ainda sem posições', 'Regista a tua primeira entrada. A app calcula as unidades, o lucro ao vivo e a percentagem — tudo por ti.', 'Adicionar posição', 'add', IMPORT_ALT);
  }
  return `${plansBanner()}<div class="sh"><h3>Posições abertas</h3><div class="sh-r"><button class="btn ghost" data-action="import" title="Importar extrato da corretora">📄 Extrato</button><button class="btn ghost" data-action="cash">💶 Fundo / Cash</button></div></div>
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
    return empty('Bem-vindo à Aurora', 'A tua carteira toda num sítio — cripto, ações e ETFs da Revolut, XTB e Trade Republic, ao vivo. Começa por registar uma posição.', 'Adicionar primeira posição', 'add', IMPORT_ALT);
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
    ${divTile(d)}
  </div>`;

  return `${backupBanner()}${plansBanner()}${historyChart()}${performanceSection(d)}${goalSection(a, d)}${stats}<div class="two">
    <div><div class="sh"><h3>Por plataforma</h3><span class="hint">valor atual</span></div><div class="bd">${platRows}</div></div>
    <div><div class="sh"><h3>Por ativo</h3><span class="hint">peso · rendimento</span></div><div class="bd">${assetRows}</div></div>
  </div>${allocationSection(d)}${rebalanceSection(d)}`;
}

const ALLOC_DIMS = [['sector', 'Setor'], ['country', 'País'], ['currency', 'Moeda']];
const ALLOC_CLR = { sector: 'var(--brass)', country: 'var(--indigo)', currency: 'var(--up)' };
const allocLabel = (dim, k) =>
  k === CRYPTO ? '₿ Cripto' : k === 'ETF (diversificado)' ? 'ETFs' : dim === 'country' && FLAGS[k] ? `${FLAGS[k]} ${k}` : k;

function allocationSection(d) {
  if (!state.positions.length) return '';
  const dim = ui.allocDim;
  const al = allocation(dim, d);
  const conc = concentration(al);
  const missing = dim !== 'currency' ? unclassified().length : 0;
  const rows = al.rows.map(r => `
    <div class="brow" title="${esc(money(r.value, d))}"><div class="bl">${esc(allocLabel(dim, r.key))}</div>
      <div class="bt"><i style="width:${r.pct}%;background:${r.key === UNKNOWN ? 'var(--slate)' : ALLOC_CLR[dim]}"></i></div>
      <div class="bv">${r.pct.toFixed(r.pct < 10 ? 1 : 0).replace('.', ',')}%</div></div>`).join('');
  const notes = [
    conc && `<span class="warn">Concentração: ${conc.pct.toFixed(0)}% ${dim === 'currency' ? 'fora do euro' : `em ${esc(allocLabel(dim, conc.key))}`}.</span>`,
    missing && `${plural(missing, 'ação sem', 'ações sem')} setor ou país — <button class="lnk" data-action="classify">classificar</button>`,
    dim === 'currency' && 'Moeda de cotação de cada ativo, mais os fundos/cash. ETFs globais estão expostos a várias moedas.',
  ].filter(Boolean);
  return `<div class="sh"><h3>Distribuição</h3><div class="sh-r"><div class="seg chart-seg">${ALLOC_DIMS.map(([k, l]) =>
      `<button data-action="alloc-dim" data-dim="${k}" class="${dim === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      <button class="btn ghost sm icon-only" data-action="classify" title="Editar setor e país" aria-label="Editar setor e país">✎</button></div></div>
    <div class="bd">${rows || '<div class="searching">—</div>'}
      ${notes.length ? `<div class="alloc-notes">${notes.map(n => `<div>${n}</div>`).join('')}</div>` : ''}</div>`;
}

function span(days) {
  if (days < 60) return plural(days, 'dia', 'dias');
  if (days < 365) return plural(Math.floor(days / 30.44), 'mês', 'meses');
  const y = Math.floor(days / 365.25), m = Math.floor((days - y * 365.25) / 30.44);
  return `${plural(y, 'ano', 'anos')}${m ? ` e ${plural(m, 'mês', 'meses')}` : ''}`;
}

const ratePct = r => (r == null ? '—' : pct(r * 100));

function performanceSection(d) {
  const pf = performance();
  if (!pf) return '';
  const toD = v => conv(v, 'EUR', d);
  const annualised = pf.days >= 365;
  const bench = benchmarkCompare(pf.flows, benchSeries());
  const diff = pf.rate != null && bench?.rate != null ? (pf.rate - bench.rate) * 100 : null;
  const bs = benchState();
  const infl = inflationSince(hicpSeries(), pf.start);
  const real = realRate(pf.rate, pf.days, infl);
  const inflRate = infl ? (annualised ? infl.annual : infl.period) : null;
  const tile = (k, v, s, cls = '') => `<div class="tile"><div class="k">${k}</div><div class="v ${cls}" style="font-size:19px">${v}</div><div class="s">${s}</div></div>`;
  const benchTile = bench
    ? tile(`${BENCHMARK.name} · mesmas datas`, ratePct(bench.rate), `valeria ${money(toD(bench.value), d)}`, bench.rate != null ? upDown(bench.rate) : '')
    : tile(`${BENCHMARK.name} · mesmas datas`, '—', bs === 'fail' ? 'sem ligação ao Yahoo' : 'a carregar…');
  const notes = [
    pf.missingDates && `<span class="warn">${plural(pf.missingDates, 'entrada sem data', 'entradas sem data')} — conta${pf.missingDates === 1 ? '' : 'm'} a partir de quando começaste a usar a app.</span>`,
    `Conta com o dia de cada compra, venda e dividendo; ${annualised ? 'a taxa anual é a TIR (como num depósito a prazo)' : 'só anualiza a partir de 1 ano'}. A comparação investe o mesmo dinheiro, nos mesmos dias, num ETF do ${BENCHMARK.name} em euros (${BENCHMARK.y}). "Sem a inflação" é o ganho em poder de compra (inflação de Portugal, IHPC do BCE${infl ? `, até ${esc(monthName(infl.to))}` : ''}). Fundos/cash não contam.`,
  ].filter(Boolean);
  return `<div class="sh"><h3>Rentabilidade</h3><span class="hint">desde ${esc(pf.start)} · ${span(pf.days)}</span></div>
    <div class="stats perf">
      ${tile('Ganho total', signed(pf.gain, money(toD(pf.gain), d)), `${pct(pf.totalPct)} · capital ${money(toD(pf.capital), d)}`, upDown(pf.gain))}
      ${tile(annualised ? 'Por ano' : 'No período', ratePct(pf.rate), pf.rate == null ? `ao fim de ${MIN_DAYS} dias` : 'a tua carteira', pf.rate != null ? upDown(pf.rate) : '')}
      ${tile('Sem a inflação', ratePct(real), inflRate == null ? (pf.rate == null ? 'poder de compra' : 'a carregar…') : `inflação ${pct(inflRate * 100)}${annualised ? '/ano' : ''}`, real != null ? upDown(real) : '')}
      ${benchTile}
      ${tile('Diferença', diff == null ? '—' : `${diff >= 0 ? '+' : ''}${diff.toFixed(1).replace('.', ',')} p.p.`, diff == null ? 'face ao índice' : diff >= 0 ? `à frente do ${BENCHMARK.name}` : `atrás do ${BENCHMARK.name}`, diff == null ? '' : upDown(diff))}
    </div>
    <div class="perf-notes">${notes.map(n => `<div>${n}</div>`).join('')}</div>`;
}

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const monthName = ym => { const [y, m] = String(ym).split('-'); return `${MONTHS[+m - 1] ?? m} ${y}`; };
const shortDate = iso => { const [, m, d] = iso.split('-'); return `${+d} ${MONTHS[+m - 1]}`; };

function plansBanner() {
  const due = plansDue();
  if (!due.length) return '';
  return `<div class="plan-due">${due.slice(0, 4).map(({ p, date }) => `
    <div class="plan-row"><span class="plan-ic" aria-hidden="true">🔁</span>
      <div class="plan-tx"><b>${esc(p.name)}</b> <span>${money(p.plan.amount, p.currency)} · plano de ${shortDate(date)}</span></div>
      <button class="btn pri sm" data-action="plan-run" data-id="${esc(p.id)}">Registar</button>
      <button class="btn ghost sm" data-action="plan-skip" data-id="${esc(p.id)}">Saltar</button></div>`).join('')}
    ${due.length > 4 ? `<div class="hint">+ ${due.length - 4} por registar</div>` : ''}</div>`;
}

function goalSection(a, d) {
  const g = state.settings.goal;
  if (!g || !(g.target > 0)) {
    return `<button type="button" class="goal-cta" data-action="goal">🎯 <span><b>Define uma meta</b> — quanto queres juntar e a app diz-te quando lá chegas</span></button>`;
  }
  const target = conv(g.target, g.currency || 'EUR', d), monthly = conv(g.monthly || 0, g.currency || 'EUR', d);
  const rate = g.rate ?? DEFAULT_RATE, now = a.netWorth;
  const pctDone = Math.min(100, (now / target) * 100);
  const when = r => monthsToGoal({ now, monthly, rate: r, target });
  const label = m => (m == null ? 'mais de 70 anos' : m === 0 ? 'já lá estás' : `${monthName(addMonths(m))} (${span(Math.round(m * 30.44))})`);
  const base = when(rate);
  const alt = [rate - 2, rate + 2].filter(r => r > 0).map(r => `a ${String(+r.toFixed(1)).replace('.', ',')}%/ano, ${when(r) == null ? 'mais de 70 anos' : monthName(addMonths(when(r)))}`).join(' · ');
  return `<div class="sh"><h3>Meta</h3><button class="btn ghost sm icon-only" data-action="goal" title="Editar meta" aria-label="Editar meta">✎</button></div>
    <div class="bd goal">
      <div class="goal-top"><span><b class="mono">${money(now, d)}</b> de <span class="mono">${money(target, d)}</span></span><b class="goal-pct">${pctDone.toFixed(pctDone < 10 ? 1 : 0).replace('.', ',')}%</b></div>
      <div class="bt goal-bar"><i style="width:${pctDone}%"></i></div>
      <div class="goal-proj">${base === 0 ? '🎉 <b>Meta atingida!</b>' : `Com <b>${money(monthly, d)}/mês</b> a <b>${String(rate).replace('.', ',')}%/ano</b> chegas lá em <b>${label(base)}</b>.`}</div>
      ${base !== 0 && alt ? `<div class="goal-alt">Noutros cenários: ${alt}.</div>` : ''}
      <div class="goal-alt">Regra dos 4%: ${money(target, d)} dariam ~<b>${money(fourPercentMonthly(target), d)}/mês</b> para sempre (levantando 4% ao ano).</div>
    </div>`;
}

function rebalanceRows(d) {
  const list = holdings(d);
  const amount = ui.rbAmount ?? (state.settings.goal?.monthly ? conv(state.settings.goal.monthly, state.settings.goal.currency || 'EUR', d) : plansMonthly(d));
  const { rows, hasTargets } = suggest(list, state.settings.targets, amount);
  return { rows, hasTargets, amount };
}

export function rebalanceTable(d = disp()) {
  const { rows } = rebalanceRows(d);
  return rows.filter(r => r.target > 0 || r.pct >= 0.5).map(r => `
    <div class="rb-row"><div class="rb-n" title="${esc(r.name)}">${esc(r.name)}</div>
      <div class="rb-p mono"><span class="${Math.abs(r.diff) >= 5 ? (r.diff > 0 ? 'down' : 'up') : ''}">${r.pct.toFixed(0)}%</span> <span class="rb-arrow">→</span> ${r.target > 0 ? `${r.target.toFixed(0)}%` : '<span class="muted">—</span>'}</div>
      <div class="rb-b mono ${r.buy > 0.005 ? 'up' : 'muted'}">${r.buy > 0.005 ? `+${money(r.buy, d)}` : '—'}</div></div>`).join('');
}

function rebalanceSection(d) {
  if (!state.positions.length) return '';
  const { hasTargets, amount } = rebalanceRows(d);
  if (!hasTargets) {
    return `<button type="button" class="goal-cta" data-action="targets">⚖️ <span><b>Define a tua alocação alvo</b> — a app diz-te onde pôr o próximo dinheiro para manteres o equilíbrio</span></button>`;
  }
  return `<div class="sh"><h3>Rebalancear</h3><button class="btn ghost sm icon-only" data-action="targets" title="Editar alvos" aria-label="Editar alocação alvo">✎</button></div>
    <div class="bd">
      <div class="rb-in"><label for="rbAmt">Vou investir</label><input class="inp mono" id="rbAmt" inputmode="decimal" autocomplete="off" value="${amount > 0 ? String(+amount.toFixed(2)).replace('.', ',') : ''}" placeholder="0,00"><span>${esc(sym(d))}</span></div>
      <div class="rb-head"><span>Ativo</span><span>Atual → alvo</span><span>Comprar</span></div>
      <div id="rbRows">${rebalanceTable(d)}</div>
      <div class="alloc-notes"><div>Sem vender nada: o dinheiro novo vai primeiro para o que está abaixo do alvo. Ativos iguais em corretoras diferentes contam juntos.</div></div>
    </div>`;
}

function divTile(d) {
  const st = dividendStats(d);
  if (!st.count) return '';
  return `<div class="tile"><div class="k">Dividendos · 12 meses</div><div class="v up" style="font-size:19px">${money(st.last12, d)}</div><div class="s">total ${money(st.total, d)}</div></div>`;
}

function backupBanner() {
  if (!backupDue()) return '';
  const d = daysSinceBackup();
  return `<div class="nag" role="note">
    <div class="nag-ic" aria-hidden="true">🛟</div>
    <div class="nag-tx"><b>Faz uma cópia de segurança</b>
      <span>Os teus dados só existem neste dispositivo. ${d == null ? 'Ainda não fizeste nenhum backup.' : `O último foi há ${d} dias.`}</span></div>
    <div class="nag-btns"><button class="btn pri" data-action="backup-now">Guardar</button><button class="btn ghost" data-action="backup-later">Mais tarde</button></div>
  </div>`;
}

function viewHistory() {
  const sales = state.closed.length, divs = state.dividends.length;
  if (!sales && !divs) {
    return empty('Sem histórico ainda', 'Quando venderes (no todo ou em parte) ou receberes dividendos, aparecem aqui — o teu registo completo para o IRS.', 'Ver posições', 'go-positions');
  }
  return `${sales ? journalSection(ui.journalPeriod) + salesSection() : ''}${dividendSection(!sales)}`;
}

const dest = id => { const l = saleCashLabel(id); return l ? ` · → ${esc(l)}` : ''; };

function salesSection() {
  const d = disp();
  const rows = [...state.closed].reverse().map(p => {
    const m = closedM(p), plc = upDown(m.pl);
    return `<div class="hrow">
      <div class="nm">${esc(p.name)}${p.partial ? ' <span class="chip">parcial</span>' : ''} <small>${esc(p.platform)} · ${esc(sym(p.currency))}${p.closedAt ? ` · ${esc(p.closedAt)}` : ''}${dest(p.id)}</small></div>
      <div class="r">${units(m.u)}</div>
      <div class="r">${money(pCost(p), p.currency)} → ${money(m.proceeds, p.currency)}</div>
      <div class="r ${plc}">${signed(m.pl, money(m.pl, p.currency))}</div>
      <div class="r ${plc}">${pct(m.plp)}</div>
      <div class="r hx-r"><button class="x hx jb${p.journal || p.note ? ' on' : ''}" data-action="trade" data-id="${esc(p.id)}" title="Diário desta venda" aria-label="Diário desta venda">📓</button><button class="x hx" data-action="undo-sale" data-id="${esc(p.id)}" title="Anular venda" aria-label="Anular venda">↶</button></div>
    </div>`;
  }).join('');
  const tot = state.closed.reduce((s, p) => s + closedM(p).plD, 0);
  return `<div class="sh"><h3>Vendas</h3><button class="btn ghost sm" data-action="tax">📄 Relatório IRS</button></div>
    <div class="hint" style="margin:-6px 0 12px">total realizado: <b class="mono ${upDown(tot)}">${signed(tot, money(tot, d))}</b></div>
    <div class="htbl"><div class="hscroll">
      <div class="hrow hh"><div>Ativo</div><div class="r">Unid.</div><div class="r">Custo → Recebido</div><div class="r">Resultado</div><div class="r">%</div><div></div></div>
      ${rows}
    </div></div>`;
}

function dividendSection(withReport) {
  const d = disp(), st = dividendStats(d);
  const rows = [...state.dividends].sort((a, b) => b.date.localeCompare(a.date)).map(x => `<div class="hrow drow">
      <div class="nm">${esc(x.name)} <small>${esc(x.platform)} · ${esc(x.date)}</small></div>
      <div class="r">${money(x.gross, x.currency)}</div>
      <div class="r down">${x.withheld ? `−${money(x.withheld, x.currency)}` : '—'}</div>
      <div class="r up">${money(netOf(x), x.currency)}</div>
      <div class="r"><button class="x hx danger" data-action="dividend-del" data-id="${esc(x.id)}" title="Apagar dividendo" aria-label="Apagar dividendo">✕</button></div>
    </div>`).join('');
  return `<div class="sh"><h3>Dividendos</h3><div class="sh-r">${withReport ? '<button class="btn ghost sm" data-action="tax">📄 Relatório IRS</button>' : ''}<button class="btn ghost sm" data-action="dividend">＋ Registar</button></div></div>
    ${st.count ? `<div class="hint" style="margin:-6px 0 12px">líquido recebido: <b class="mono up">${money(st.total, d)}</b> · últimos 12 meses <b class="mono">${money(st.last12, d)}</b></div>
    <div class="htbl"><div class="hscroll">
      <div class="hrow drow hh"><div>Ativo</div><div class="r">Bruto</div><div class="r">Retido</div><div class="r">Líquido</div><div></div></div>
      ${rows}
    </div></div>` : '<div class="searching" style="text-align:left;padding:4px 0 10px">Ainda sem dividendos — regista-os a partir do 💰 de cada ação ou aqui.</div>'}`;
}
