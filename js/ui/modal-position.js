import { PLATFORMS, CURRENCIES } from '../config.js';
import { state, commit, uid } from '../store.js';
import { conv } from '../fx.js';
import { metrics, avgDisp, feeFor, quoteCurOf, qty, pCost, sellFIFO, mergeLots } from '../calc.js';
import { dropAlertsFor } from '../alerts.js';
import { quoteFor } from '../quotes/stocks.js';
import { refresh } from '../quotes/index.js';
import { requestPersistence } from '../backup.js';
import { creditSale, debitBuy, dropCashRefs, saleCashLabel } from '../cash.js';
import { esc, money, price, pct, signed, units, sym, num, inputNum, todayISO } from '../format.js';
import { $, toast, openModal, closeModal, segmented, debounce } from './dom.js';
import { coinSearch, stockSearch } from './asset-search.js';
import { removeWatch } from '../watchlist.js';
import { lotForm } from './lot-form.js';
import { cashPicker } from './cash-pick.js';
import { ui } from './render.js';

const header = title => `<div class="mh"><h3>${title}</h3><button type="button" class="x" data-action="modal-close" aria-label="Fechar">✕</button></div>`;
const platformOptions = sel => [...PLATFORMS, 'Outra'].map(p => `<option${p === sel ? ' selected' : ''}>${esc(p)}</option>`).join('');
const findPos = id => state.positions.find(x => x.id === id);
const SYMBOL_RE = /^[A-Za-z0-9.\-=^]{1,24}$/;

function pickedHtml(name, sub, thumb) {
  return `<div class="picked">${thumb
    ? `<img src="${esc(thumb)}" alt="">`
    : `<div class="tkn" style="width:30px;height:30px;font-size:11px">${esc((sub || name).slice(0, 3).toUpperCase())}</div>`}
    <div style="min-width:0"><div class="rn">${esc(name)}</div><div class="rs" style="color:var(--brass-2)">${esc(sub)}</div></div>
    <button type="button" class="x" data-clear style="margin-left:auto" aria-label="Escolher outro">✕</button></div>`;
}

/* ---------- nova posição ---------- */

/** Nova posição; `preset` ({ kind, coin | stock, watchId }) vem da lista "A seguir". */
export function modalAdd(preset = null) {
  if (typeof preset !== 'object') preset = null;
  const draft = {
    kind: preset?.kind ?? 'crypto', currency: preset?.kind === 'stock' ? 'EUR' : (preset?.currency ?? 'EUR'),
    coin: preset?.coin ?? null, stock: preset?.stock ?? null, manual: false, quote: null, quoteToken: 0,
  };

  openModal(`${header('Nova posição')}
    <div class="field"><label>Tipo de ativo</label><div class="mseg" id="dKind">
      <button type="button" data-k="crypto" class="${draft.kind === 'crypto' ? 'on' : ''}">Cripto</button><button type="button" data-k="stock" class="${draft.kind === 'stock' ? 'on' : ''}">Ação / ETF</button></div></div>
    <div id="assetArea"></div>
    <div class="field"><label for="dPlat">Plataforma</label><select class="inp" id="dPlat">${platformOptions('Revolut')}</select></div>
    <div class="field"><label>Moeda da conta <span class="sublbl">o dinheiro que usaste</span></label><div id="curArea"></div></div>
    <div id="amtArea"></div>
    <div class="preview" id="dPrev" hidden></div>
    <div id="dCash"></div>
    <div class="field"><label for="dDate">Data de entrada</label><input class="inp" id="dDate" type="date" max="${todayISO()}" value="${todayISO()}"></div>
    <button type="button" class="btn pri wide" id="dSave">Adicionar posição</button>`);

  const form = lotForm($('#amtArea'), {
    kind: () => draft.kind,
    moneyCur: () => draft.currency,
    quoteCur: () => draft.stock?.c || draft.quote?.cur || draft.currency,
    platform: () => $('#dPlat').value,
    onChange: updatePreview,
  });

  let pick = null;

  function updatePreview() {
    const pv = $('#dPrev');
    if (!pv) return;
    pick?.update();
    const d = form.read();
    pv.hidden = !d.ok;
    if (!d.ok) return;
    const tag = d.exact ? ' <span style="color:var(--up)">exato</span>' : d.feeApplied ? ' <span style="color:var(--down)">c/ taxa</span>' : '';
    pv.innerHTML = `<div class="pr"><span>${draft.kind === 'crypto' ? 'Unidades' : 'Ações'}</span><b>${units(d.units)}</b></div>
      <div class="pr"><span>Preço médio</span><b>${price(d.priceQ ?? d.price, d.priceCur || draft.currency)}</b></div>
      <div class="pr"><span>Custo${tag}</span><b>${money(d.cost, draft.currency)}</b></div>`;
  }

  function renderCur() {
    const opts = draft.kind === 'crypto' ? ['EUR', 'USD'] : CURRENCIES;
    if (!opts.includes(draft.currency)) draft.currency = 'EUR';
    $('#curArea').innerHTML = `<div class="mseg cur5" id="curSel">${opts.map(c => `<button type="button" data-c="${c}" class="${draft.currency === c ? 'on' : ''}">${esc(sym(c))}${draft.kind === 'crypto' ? ` ${c}` : ''}</button>`).join('')}</div>
      ${draft.kind === 'stock' ? '<div class="curhint">A moeda da tua <b>conta</b> na corretora. O preço por ação podes metê-lo na moeda em que cota.</div>' : ''}`;
    segmented($('#curSel'), 'c', c => { draft.currency = c; pick?.render(); form.render(); updatePreview(); });
  }

  async function loadQuote(stock) {
    const token = ++draft.quoteToken;
    const hint = $('#quoteHint');
    if (hint) hint.textContent = 'A obter cotação…';
    const q = await quoteFor(stock.y).catch(() => null);
    if (token !== draft.quoteToken || draft.stock !== stock) return;
    draft.quote = q;
    const h = $('#quoteHint');
    if (q) {
      stock.c = q.cur;
      if (h) h.innerHTML = `Cotação atual: <b>${price(q.price, q.cur)}</b>${q.dayPct != null ? ` · hoje ${pct(q.dayPct)}` : ''}`;
      form.render();
      form.prefillPrice(q.price, q.cur);
    } else if (h) {
      h.textContent = stock.c ? 'Sem cotação ao vivo agora — mete o preço à mão.' : 'Não consegui confirmar a cotação — mete o preço à mão.';
    }
    updatePreview();
  }

  function renderAsset() {
    const a = $('#assetArea');
    if (draft.kind === 'crypto') {
      a.innerHTML = `<div class="field"><label for="dSearch">Procurar criptomoeda</label>
        <div id="coinWrap">${draft.coin
          ? pickedHtml(draft.coin.name, draft.coin.symbol.toUpperCase(), draft.coin.thumb)
          : '<input class="inp" id="dSearch" placeholder="Bitcoin, ETH, Solana…" autocomplete="off" data-autofocus>'}</div>
        <div class="results" id="dResults"></div></div>`;
      if (draft.coin) {
        $('#coinWrap [data-clear]').onclick = () => { draft.coin = null; renderAsset(); updatePreview(); };
        return;
      }
      coinSearch($('#dSearch'), $('#dResults'), coin => {
        draft.coin = coin;
        renderAsset();
        updatePreview();
      });
      return;
    }

    if (draft.manual) {
      a.innerHTML = `<div class="field"><label for="dName">Nome <span class="lnk" id="toList">← procurar</span></label>
          <input class="inp" id="dName" placeholder="Ex: empresa não listada" autocomplete="off"></div>
        <div class="field"><label for="dSym">Símbolo Yahoo <span class="sublbl">opcional, para cotação ao vivo</span></label>
          <input class="inp mono" id="dSym" placeholder="ex: VWCE.DE, AAPL, GALP.LS" autocomplete="off" autocapitalize="characters"></div>
        <div class="curhint" id="quoteHint">Sem símbolo, atualizas o preço à mão no botão “Preço atual”.</div>`;
      $('#toList').onclick = () => { draft.manual = false; draft.stock = null; draft.quote = null; renderAsset(); form.render(); updatePreview(); };
      const check = debounce(() => {
        const y = $('#dSym')?.value.trim().toUpperCase();
        draft.quote = null;
        if (!y) { draft.stock = null; return; }
        if (!SYMBOL_RE.test(y)) { $('#quoteHint').textContent = 'Símbolo inválido.'; return; }
        draft.stock = { n: $('#dName').value.trim() || y, t: y, x: 'Manual', c: null, y };
        loadQuote(draft.stock);
      }, 600);
      $('#dSym').oninput = check;
      return;
    }

    a.innerHTML = `<div class="field"><label for="sSearch">Procurar ação ou ETF <span class="lnk" id="toManual">escrever à mão →</span></label>
      <div id="stkWrap">${draft.stock
        ? pickedHtml(draft.stock.n, `${draft.stock.t} · ${draft.stock.x}`, null)
        : '<input class="inp" id="sSearch" placeholder="Apple, Galp, VWCE, ASML…" autocomplete="off" data-autofocus>'}</div>
      ${draft.stock ? '<div class="curhint" id="quoteHint"></div>' : ''}
      <div class="results" id="sResults"></div></div>`;
    $('#toManual').onclick = () => { draft.manual = true; draft.stock = null; draft.quote = null; renderAsset(); form.render(); updatePreview(); };
    if (draft.stock) {
      $('#stkWrap [data-clear]').onclick = () => { draft.stock = null; draft.quote = null; draft.quoteToken++; renderAsset(); form.render(); updatePreview(); };
      return;
    }

    stockSearch($('#sSearch'), $('#sResults'), stock => {
      draft.stock = stock;
      draft.quote = null;
      renderAsset();
      form.render();
      updatePreview();
      loadQuote(stock);
    }, 'Sem resultados — usa “escrever à mão”');
  }

  segmented($('#dKind'), 'k', k => {
    draft.kind = k; draft.coin = null; draft.stock = null; draft.manual = false; draft.quote = null; draft.quoteToken++;
    renderAsset(); renderCur(); form.render(); updatePreview();
  });
  $('#dPlat').onchange = () => { pick.render(); form.renderAdj(); updatePreview(); };
  $('#dSave').onclick = save;

  renderAsset();
  renderCur();
  form.render();
  pick = cashPicker($('#dCash'), {
    mode: 'buy', platform: () => $('#dPlat').value, currency: () => draft.currency, amount: () => form.read().cost,
  });
  if (draft.stock) loadQuote(draft.stock);

  function save() {
    const d = form.read();
    if (!d.ok) return toast('Preenche os valores da entrada', true);
    const date = $('#dDate').value || todayISO();
    const p = {
      id: uid(), kind: draft.kind, platform: $('#dPlat').value, currency: draft.currency,
      lots: [{ shares: d.units, cost: d.cost, priceQ: d.priceQ, priceCur: d.priceCur, date }], openedAt: date,
    };
    if (draft.kind === 'crypto') {
      if (!draft.coin) return toast('Escolhe a criptomoeda', true);
      Object.assign(p, { name: draft.coin.name, symbol: draft.coin.symbol.toUpperCase(), coingeckoId: draft.coin.id, thumb: draft.coin.thumb });
    } else if (draft.manual) {
      const name = $('#dName').value.trim();
      if (!name) return toast('Indica o nome da ação', true);
      const y = $('#dSym').value.trim().toUpperCase();
      if (y && !SYMBOL_RE.test(y)) return toast('Símbolo inválido', true);
      Object.assign(p, {
        name, symbol: y || name.slice(0, 4).toUpperCase(), exchange: 'Manual',
        quoteSymbol: y || null, quoteCur: draft.quote?.cur || draft.currency, manualPrice: d.price,
      });
    } else {
      if (!draft.stock) return toast('Escolhe a ação ou ETF', true);
      const s = draft.stock;
      Object.assign(p, {
        name: s.n, symbol: s.t, exchange: s.x, quoteSymbol: s.y,
        quoteCur: s.c || draft.quote?.cur || draft.currency, manualPrice: d.price,
      });
    }
    if (draft.quote && p.quoteSymbol) state.cache.stockPrices[p.quoteSymbol] = { ...draft.quote, ts: Date.now() };
    state.positions.push(p);
    const used = debitBuy(pick.value(), { amount: d.cost, currency: p.currency, platform: p.platform, date, posId: p.id });
    const fromWatch = preset?.watchId ? removeWatch(preset.watchId) : null;
    commit();
    closeModal();
    toast(`Posição adicionada${used > 0 ? ` · ${money(used, p.currency)} saíram do saldo` : ''}${fromWatch ? ' · saiu da lista “A seguir”' : ''}`);
    requestPersistence();
    refresh({ crypto: p.kind === 'crypto', stocks: p.kind === 'stock' && !draft.quote, force: true });
  }
}

/* ---------- reforçar ---------- */

export function modalReinforce(id) {
  const p = findPos(id);
  if (!p) return;
  const cur = p.currency, unit = p.kind === 'crypto' ? 'unidades' : 'ações';
  openModal(`${header(`Reforçar ${esc(p.name)}`)}
    <p class="mlead">Nova compra em <b>${esc(sym(cur))}</b>. Soma às entradas e recalcula o preço médio.</p>
    <div id="rAmt"></div>
    <div class="preview" id="rPrev" hidden></div>
    <div id="rCash"></div>
    <div class="field"><label for="rDate">Data</label><input class="inp" id="rDate" type="date" max="${todayISO()}" value="${todayISO()}"></div>
    <button type="button" class="btn pri wide" id="rDo">Adicionar entrada</button>`);

  const form = lotForm($('#rAmt'), {
    kind: () => p.kind, moneyCur: () => cur, quoteCur: () => quoteCurOf(p), platform: () => p.platform, onChange: update,
  });

  let pick = null;

  function update() {
    const pv = $('#rPrev');
    pick?.update();
    const v = form.read();
    pv.hidden = !v.ok;
    if (!v.ok) return;
    const nl = { shares: v.units, cost: v.cost, priceQ: v.priceQ, priceCur: v.priceCur };
    const ad = avgDisp({ currency: cur, lots: [...p.lots, nl] });
    const tag = v.exact ? ' <span style="color:var(--up)">exato</span>' : v.feeApplied ? ' <span style="color:var(--down)">c/ taxa</span>' : '';
    pv.innerHTML = `<div class="pr"><span>Nova entrada${tag}</span><b>${units(v.units)} · ${money(v.cost, cur)}</b></div>
      <div class="pr"><span>Total ${unit}</span><b>${units(qty(p) + v.units)}</b></div>
      <div class="pr total"><span>Novo preço médio</span><b style="color:var(--brass-2);font-size:15px">${price(ad.value, ad.cur)}</b></div>`;
  }

  pick = cashPicker($('#rCash'), { mode: 'buy', platform: () => p.platform, currency: () => cur, amount: () => form.read().cost });
  const live = metrics(p);
  if (live.live) form.prefillPrice(live.nativePrice, live.nativeCur);

  $('#rDo').onclick = () => {
    const v = form.read();
    if (!v.ok) return toast('Preenche os valores', true);
    const date = $('#rDate').value || todayISO();
    p.lots.push({ shares: v.units, cost: v.cost, priceQ: v.priceQ, priceCur: v.priceCur, date });
    const used = debitBuy(pick.value(), { amount: v.cost, currency: cur, platform: p.platform, date, posId: p.id });
    commit();
    closeModal();
    toast(`Reforço adicionado — média recalculada${used > 0 ? ` · ${money(used, cur)} do saldo` : ''}`);
  };
}

/* ---------- vender (total ou parcial) ---------- */

const FULL_EPS = 1e-9;

export function modalClose(id) {
  const p = findPos(id);
  if (!p) return;
  const m = metrics(p), exCur = m.nativeCur, cross = exCur !== p.currency;
  const csym = sym(p.currency), fee = feeFor(p.platform);
  const unit = p.kind === 'crypto' ? 'unidades' : 'ações';
  let adj = 'auto';
  openModal(`${header(`Vender ${esc(p.name)}`)}
    <div class="picked" style="margin-bottom:16px;background:var(--surface-2);border-color:var(--line-2)">
      ${p.kind === 'crypto' && p.thumb ? `<img src="${esc(p.thumb)}" alt="">` : `<div class="tkn">${esc((p.symbol || p.name).slice(0, 3))}</div>`}
      <div><div class="rn">${esc(p.name)}</div><div class="rs">${units(m.u)} ${unit} · ${esc(p.platform)} · resultado em ${esc(csym)}</div></div></div>
    <div id="cForm">
      <div class="field"><label for="cQty">Quantidade a vender <span class="sublbl">tens ${units(m.u)}</span></label>
        <div class="pqrow"><input class="inp mono" id="cQty" inputmode="decimal" autocomplete="off" value="${inputNum(m.u, 8)}">
          <div class="mseg pqseg" id="cQtyQuick"><button type="button" data-q="0.25">¼</button><button type="button" data-q="0.5">½</button><button type="button" data-q="1" class="on">Tudo</button></div></div></div>
      <div class="field"><label for="cExit">Preço de venda (${esc(exCur)})</label>
        <input class="inp mono" id="cExit" inputmode="decimal" autocomplete="off" value="${inputNum(m.nativePrice)}" data-autofocus></div>
      ${cross ? '<div id="cAdjArea"></div>' : ''}
      <div class="field"><label for="cDate">Data da venda</label><input class="inp" id="cDate" type="date" max="${todayISO()}" value="${todayISO()}"></div>
      <div id="cCash"></div>
      <div class="preview big" id="cPrev"></div>
      <div class="curhint" id="cFifo" hidden>Venda parcial pelo método <b>FIFO</b> (as compras mais antigas saem primeiro), como manda o IRS. O preço médio das que ficam pode diferir do que a corretora mostra.</div>
    </div>
    <div class="row2" style="margin-top:14px"><button type="button" class="btn ghost" data-action="modal-close" style="justify-content:center">Cancelar</button>
      <button type="button" class="btn pri" id="cDo" style="justify-content:center">Confirmar venda</button></div>`);

  /** Quantidade escrita; valores muito próximos do total contam como venda total. */
  const sellQty = () => {
    const q = num($('#cQty').value);
    if (!(q > 0) || q > m.u * (1 + FULL_EPS)) return NaN;
    return m.u - q <= m.u * FULL_EPS ? m.u : q;
  };

  const proceeds = q => {
    const ex = num($('#cExit').value);
    if (!(ex > 0) || !(q > 0)) return NaN;
    if (!cross) return q * ex;
    if (adj === 'recv') return num($('#cRecv')?.value);
    if (adj === 'rate') return q * ex * num($('#cRate')?.value);
    return conv(q * ex, exCur, p.currency) * (1 - fee);
  };

  const renderAdj = () => {
    const a = $('#cAdjArea');
    if (!a) return;
    a.innerHTML = `<div class="mseg" id="cAdjMode" style="margin:2px 0 12px">
        <button type="button" data-aj="auto" class="${adj === 'auto' ? 'on' : ''}">Automático</button>
        <button type="button" data-aj="recv" class="${adj === 'recv' ? 'on' : ''}">Recebido ${esc(csym)}</button>
        <button type="button" data-aj="rate" class="${adj === 'rate' ? 'on' : ''}">Câmbio</button></div>
      ${adj === 'recv'
        ? `<div class="field"><label for="cRecv">Recebido (${esc(csym)})</label><input class="inp mono" id="cRecv" inputmode="decimal" autocomplete="off" placeholder="0,00"></div><div class="curhint">O valor exato que a corretora te creditou por esta venda.</div>`
        : adj === 'rate'
          ? `<div class="field"><label for="cRate">Câmbio da venda <span class="sublbl">1 ${esc(sym(exCur))} = ? ${esc(csym)}</span></label><input class="inp mono" id="cRate" inputmode="decimal" autocomplete="off" placeholder="ex: 0,8535"></div><div class="curhint">A taxa de câmbio da venda (já inclui a taxa).</div>`
          : `<div class="curhint">Converto ao câmbio de hoje${fee > 0 ? ` menos <b style="color:var(--down)">${String(state.settings.fxFeePct).replace('.', ',')}% de taxa</b> da ${esc(p.platform)}` : ` (a ${esc(p.platform)} não cobra taxa)`}.</div>`}`;
    segmented($('#cAdjMode'), 'aj', v => { adj = v; renderAdj(); update(); });
  };

  let pick = null;
  const update = () => {
    pick?.update();
    const q = sellQty();
    const partial = q > 0 && q < m.u;
    const cost = q > 0 ? sellFIFO(p.lots, q, p.openedAt).sold.reduce((s, l) => s + l.cost, 0) : NaN;
    const pr = proceeds(q);
    const ok = Number.isFinite(pr) && pr > 0 && Number.isFinite(cost);
    const pl = pr - cost, plp = cost > 0 ? (pl / cost) * 100 : 0;
    $('#cFifo').hidden = !partial;
    $('#cDo').textContent = partial ? 'Confirmar venda parcial' : 'Confirmar venda';
    $('#cPrev').innerHTML = `${partial ? `<div class="pr"><span>Vendes</span><b>${units(q)} de ${units(m.u)}</b></div>` : ''}
      <div class="pr"><span>Custo${partial ? ' (FIFO)' : ''}</span><b>${Number.isFinite(cost) ? money(cost, p.currency) : '—'}</b></div>
      <div class="pr"><span>Recebido</span><b>${ok ? money(pr, p.currency) : '—'}</b></div>
      <div class="pr total"><span>Resultado</span><b class="${pl >= 0 ? 'up' : 'down'}" style="font-size:16px">${ok ? `${signed(pl, money(pl, p.currency))} · ${pct(plp)}` : '—'}</b></div>
      ${partial ? `<div class="pr"><span>Ficam</span><b>${units(m.u - q)} ${unit}</b></div>` : ''}`;
  };

  segmented($('#cQtyQuick'), 'q', f => {
    $('#cQty').value = inputNum(+f === 1 ? m.u : m.u * +f, 8);
    update();
  });
  $('#cQty').addEventListener('input', () => {
    for (const b of $('#cQtyQuick').children) b.classList.remove('on');
  });
  $('#cForm').oninput = update;
  renderAdj();
  pick = cashPicker($('#cCash'), { mode: 'sale', platform: () => p.platform, currency: () => p.currency, amount: () => proceeds(sellQty()) });
  update();

  $('#cDo').onclick = () => {
    const q = sellQty();
    if (!(q > 0)) return toast(`Quantidade inválida — no máximo ${units(m.u)}`, true);
    const pr = proceeds(q);
    if (!(pr > 0)) return toast('Indica o preço ou valor de venda', true);
    const full = q >= m.u;
    const { sold, remaining } = sellFIFO(p.lots, q, p.openedAt);
    const sale = {
      ...p, lots: sold, exitPrice: num($('#cExit').value), exitCur: exCur, proceeds: pr,
      closedAt: $('#cDate').value || todayISO(),
    };
    if (full) {
      state.positions = state.positions.filter(x => x.id !== id);
      dropAlertsFor(id);
      ui.expanded.delete(id);
    } else {
      Object.assign(sale, { id: uid(), parentId: p.id, partial: true });
      p.lots = remaining;
    }
    state.closed.push(sale);
    const dest = creditSale(pick.value(), { amount: pr, currency: p.currency, platform: p.platform, date: sale.closedAt, saleId: sale.id });
    commit();
    closeModal();
    const pl = pr - sold.reduce((s, l) => s + l.cost, 0);
    toast(`${pl >= 0 ? 'Lucro' : 'Perda'} de ${money(Math.abs(pl), p.currency)}${full ? '' : ` · ficam ${units(qty(p))} ${unit}`}${dest ? ` · ${money(pr, p.currency)} → ${dest.label}` : ''}`);
  };
}

/* ---------- preço manual ---------- */

export function modalStockPrice(id) {
  const p = findPos(id);
  if (!p) return;
  openModal(`${header('Preço atual')}
    <p class="mlead">Atualiza a cotação de <b>${esc(p.name)}</b> a partir da tua app de investimento${p.quoteSymbol ? ` (não consegui obter a cotação de <span class="mono">${esc(p.quoteSymbol)}</span>)` : ''}.</p>
    <div class="field"><label for="sPrice">Cotação atual (${esc(sym(p.currency))})</label>
      <input class="inp mono" id="sPrice" inputmode="decimal" autocomplete="off" value="${inputNum(p.manualPrice > 0 ? p.manualPrice : pCost(p) / (qty(p) || 1))}" data-autofocus></div>
    <button type="button" class="btn pri wide" id="sDo">Guardar cotação</button>`);
  $('#sDo').onclick = () => {
    const v = num($('#sPrice').value);
    if (!(v > 0)) return toast('Valor inválido', true);
    p.manualPrice = v;
    commit();
    closeModal();
    toast('Cotação atualizada');
  };
}

/* ---------- apagar ---------- */

export function deletePosition(id) {
  const p = findPos(id);
  if (!p) return;
  if (!confirm(`Apagar "${p.name}"?\n\nÉ removida já e NÃO fica no histórico. Usa isto só para corrigir erros — para uma venda a sério, usa Vender.`)) return;
  state.positions = state.positions.filter(x => x.id !== id);
  dropCashRefs(`pos:${id}`);
  dropAlertsFor(id);
  ui.expanded.delete(id);
  commit();
  toast('Posição apagada');
}

/** Anula uma venda: as unidades voltam à posição de origem (ou a posição é reaberta). */
export function undoSale(id) {
  const rec = state.closed.find(x => x.id === id);
  if (!rec) return;
  const what = `${units(qty(rec))} ${rec.kind === 'crypto' ? 'unidades' : 'ações'}`;
  const dest = saleCashLabel(rec.id);
  if (!confirm(`Anular a venda de "${rec.name}"?\n\nAs ${what} voltam às posições abertas e o resultado desta venda deixa de contar.${dest ? `\nO dinheiro sai de "${dest}".` : ''}`)) return;
  state.closed = state.closed.filter(x => x.id !== id);
  dropCashRefs(`sale:${id}`);
  const posId = rec.parentId || rec.id;
  const target = findPos(posId);
  if (target) {
    target.lots = mergeLots(target.lots, rec.lots);
  } else {
    const reopened = { ...rec, id: posId };
    for (const k of ['exitPrice', 'exitCur', 'proceeds', 'closedAt', 'partial', 'parentId']) delete reopened[k];
    state.positions.push(reopened);
  }
  commit();
  toast('Venda anulada');
}
