import { state, commit } from '../store.js';
import { disp, conv } from '../fx.js';
import { metrics, agg } from '../calc.js';
import { setPlan, stopPlan, advancePlan, estimateUnits, firstDue, validPlan, MAX_DAY } from '../plans.js';
import { buySources, debitBuy } from '../cash.js';
import { DEFAULT_RATE } from '../goals.js';
import { holdings, currentAsTargets } from '../rebalance.js';
import { performance } from '../performance.js';
import { esc, money, sym, num, inputNum, units, todayISO } from '../format.js';
import { $, $$, toast, openModal, closeModal, segmented } from './dom.js';
import { cashPicker } from './cash-pick.js';

const header = title => `<div class="mh"><h3>${title}</h3><button type="button" class="x" data-action="modal-close" aria-label="Fechar">✕</button></div>`;
const findPos = id => state.positions.find(p => p.id === id);
const numStr = v => (v > 0 ? String(+(+v).toFixed(2)).replace('.', ',') : '');

/* ---------- plano de poupança ---------- */

export function modalPlan(id) {
  const p = findPos(id);
  if (!p) return;
  const pl = validPlan(p.plan) ? p.plan : null;
  const { opts } = buySources(p.platform, p.currency);
  const src = pl?.source ?? 'new';
  openModal(`${header(`Plano mensal · ${esc(p.name)}`)}
    <p class="mlead">Uma compra de valor fixo todos os meses (como os planos de poupança da Trade Republic). No dia, a app avisa-te no Painel para <b>confirmares</b> o preço e as unidades — não compra nada sozinha.</p>
    <div class="row2">
      <div class="field"><label for="plAmt">Valor por mês (${esc(sym(p.currency))})</label><input class="inp mono" id="plAmt" inputmode="decimal" autocomplete="off" value="${numStr(pl?.amount)}" placeholder="100" data-autofocus></div>
      <div class="field"><label for="plDay">Dia do mês</label><select class="inp" id="plDay">${Array.from({ length: MAX_DAY }, (_, i) => i + 1).map(d => `<option${d === (pl?.day ?? 2) ? ' selected' : ''}>${d}</option>`).join('')}</select></div>
    </div>
    <div class="field"><label for="plSrc">De onde vem o dinheiro</label><select class="inp" id="plSrc">
      ${opts.map(o => `<option value="${esc(o.v)}"${o.v === src ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}</select></div>
    <div class="curhint" id="plNext"></div>
    <div class="row2" style="margin-top:16px">
      ${pl ? '<button type="button" class="btn ghost" id="plStop" style="justify-content:center">Parar plano</button>' : '<button type="button" class="btn ghost" data-action="modal-close" style="justify-content:center">Cancelar</button>'}
      <button type="button" class="btn pri" id="plSave" style="justify-content:center">${pl ? 'Guardar' : 'Criar plano'}</button></div>`);
  const showNext = () => {
    const day = +$('#plDay').value;
    const next = pl && pl.day === day ? pl.next : firstDue(day);
    $('#plNext').innerHTML = `Próxima compra: <b>${esc(next)}</b>.`;
  };
  $('#plDay').onchange = showNext;
  showNext();
  $('#plSave').onclick = () => {
    const amount = num($('#plAmt').value);
    if (!(amount > 0)) return toast('Indica o valor por mês', true);
    setPlan(p, { amount, day: +$('#plDay').value, source: $('#plSrc').value });
    commit();
    closeModal();
    toast(`Plano criado: ${money(amount, p.currency)} por mês, dia ${p.plan.day}`);
  };
  const stop = $('#plStop');
  if (stop) stop.onclick = () => {
    if (!confirm(`Parar o plano mensal de ${p.name}? As compras já registadas ficam.`)) return;
    stopPlan(p);
    commit();
    closeModal();
    toast('Plano parado');
  };
}

/** Registar a compra do plano: valor e preço pré-preenchidos, unidades editáveis (o valor exato da corretora). */
export function modalPlanRun(id) {
  const p = findPos(id);
  if (!p || !validPlan(p.plan)) return;
  const pl = p.plan, m = metrics(p);
  const priceCur = m.nativeCur, unit = p.kind === 'crypto' ? 'unidades' : 'ações';
  let unitsEdited = false;
  openModal(`${header(`Plano · ${esc(p.name)}`)}
    <p class="mlead">Compra do plano de <b>${esc(pl.next)}</b>. Confirma com o que a corretora executou.</p>
    <div class="row2">
      <div class="field"><label for="prAmt">Valor (${esc(sym(p.currency))})</label><input class="inp mono" id="prAmt" inputmode="decimal" autocomplete="off" value="${numStr(pl.amount)}"></div>
      <div class="field"><label for="prPrice">Preço (${esc(priceCur)})</label><input class="inp mono" id="prPrice" inputmode="decimal" autocomplete="off" value="${m.nativePrice > 0 ? inputNum(m.nativePrice) : ''}" data-autofocus></div>
    </div>
    <div class="field"><label for="prUnits">${unit === 'ações' ? 'Ações' : 'Unidades'} recebidas <span class="sublbl">estimado — corrige se precisares</span></label>
      <input class="inp mono" id="prUnits" inputmode="decimal" autocomplete="off"></div>
    <div id="prCash"></div>
    <div class="field"><label for="prDate">Data</label><input class="inp" id="prDate" type="date" max="${todayISO()}" value="${esc(pl.next <= todayISO() ? pl.next : todayISO())}"></div>
    <div class="row2" style="margin-top:14px"><button type="button" class="btn ghost" id="prSkip" style="justify-content:center">Saltar este mês</button>
      <button type="button" class="btn pri" id="prDo" style="justify-content:center">Registar compra</button></div>`);
  const pick = cashPicker($('#prCash'), { mode: 'buy', platform: () => p.platform, currency: () => p.currency, amount: () => num($('#prAmt').value) });
  if (pl.source && pl.source !== 'new' && $('#buyCash') && [...$('#buyCash').options].some(o => o.value === pl.source)) {
    $('#buyCash').value = pl.source;
    $('#buyCash').dispatchEvent(new Event('change'));
  }
  const estimate = () => {
    if (unitsEdited) return;
    const u = estimateUnits(p, num($('#prAmt').value), num($('#prPrice').value), priceCur);
    $('#prUnits').value = u > 0 ? inputNum(u, 8) : '';
  };
  $('#prAmt').oninput = () => { estimate(); pick.update(); };
  $('#prPrice').oninput = estimate;
  $('#prUnits').oninput = () => { unitsEdited = true; };
  estimate();
  $('#prSkip').onclick = () => { advancePlan(p); commit(); closeModal(); toast(`Plano saltado — próximo a ${p.plan.next}`); };
  $('#prDo').onclick = () => {
    const amount = num($('#prAmt').value), sh = num($('#prUnits').value), pr = num($('#prPrice').value);
    if (!(amount > 0) || !(sh > 0)) return toast('Indica o valor e as unidades', true);
    const date = $('#prDate').value || todayISO();
    p.lots.push({ shares: sh, cost: amount, priceQ: pr > 0 ? pr : null, priceCur: pr > 0 ? priceCur : null, date });
    const used = debitBuy(pick.value(), { amount, currency: p.currency, platform: p.platform, date, posId: p.id });
    advancePlan(p);
    commit();
    closeModal();
    toast(`Compra registada: ${units(sh)} ${unit}${used > 0 ? ` · ${money(used, p.currency)} do saldo` : ''}`);
  };
}

export function skipPlan(id) {
  const p = findPos(id);
  if (!p || !validPlan(p.plan)) return;
  advancePlan(p);
  commit();
  toast(`Plano de ${p.name} saltado — próximo a ${p.plan.next}`);
}

/* ---------- meta ---------- */

export function modalGoal() {
  const d = disp(), g = state.settings.goal;
  const pf = performance();
  const myRate = pf?.days >= 365 && pf.annual != null ? Math.round(pf.annual * 1000) / 10 : null;
  const from = g?.currency || d;
  let rate = g?.rate ?? DEFAULT_RATE;
  const rates = [...new Set([5, DEFAULT_RATE, 9, ...(myRate != null && myRate > 0 ? [myRate] : [])])];
  openModal(`${header('Meta')}
    <p class="mlead">Quanto queres juntar? Conta tudo o que tens na app (investimentos e fundos/cash), com um valor por mês e uma rentabilidade estimada.</p>
    <div class="row2">
      <div class="field"><label for="gTarget">Objetivo (${esc(sym(d))})</label><input class="inp mono" id="gTarget" inputmode="decimal" autocomplete="off" value="${numStr(g ? conv(g.target, from, d) : 0)}" placeholder="100000" data-autofocus></div>
      <div class="field"><label for="gMonthly">Por mês (${esc(sym(d))})</label><input class="inp mono" id="gMonthly" inputmode="decimal" autocomplete="off" value="${numStr(g ? conv(g.monthly, from, d) : 0)}" placeholder="500"></div>
    </div>
    <div class="field"><label>Rentabilidade estimada por ano</label>
      <div class="mseg" id="gRate">${rates.map(r => `<button type="button" data-r="${r}" class="${r === rate ? 'on' : ''}">${String(r).replace('.', ',')}%${r === myRate ? ' (tua)' : ''}</button>`).join('')}</div>
      <div class="curhint">${myRate != null ? `A tua TIR até agora é ${String(myRate).replace('.', ',')}%/ano. ` : ''}Ações globais renderam ~7%/ano a longo prazo (sem garantias). Um valor mais baixo dá uma estimativa mais prudente.</div></div>
    <div class="row2" style="margin-top:16px">
      ${g ? '<button type="button" class="btn ghost" id="gDel" style="justify-content:center">Apagar meta</button>' : '<button type="button" class="btn ghost" data-action="modal-close" style="justify-content:center">Cancelar</button>'}
      <button type="button" class="btn pri" id="gSave" style="justify-content:center">Guardar</button></div>`);
  segmented($('#gRate'), 'r', r => { rate = +r; });
  $('#gSave').onclick = () => {
    const target = num($('#gTarget').value), monthly = num($('#gMonthly').value) || 0;
    if (!(target > 0)) return toast('Indica o objetivo', true);
    state.settings.goal = { target, monthly: Math.max(0, monthly), rate, currency: d };
    commit();
    closeModal();
    toast(target > agg(d).netWorth ? 'Meta guardada' : 'Meta guardada — já lá estás! 🎉');
  };
  const del = $('#gDel');
  if (del) del.onclick = () => { state.settings.goal = null; commit(); closeModal(); toast('Meta apagada'); };
}

/* ---------- alocação alvo ---------- */

export function modalTargets() {
  const d = disp(), list = holdings(d);
  if (!list.length) return toast('Ainda não tens posições', true);
  const total = list.reduce((s, h) => s + h.value, 0) || 1;
  const saved = state.settings.targets ?? {};
  openModal(`${header('Alocação alvo')}
    <p class="mlead">Que percentagem queres em cada ativo? Por exemplo, 80% num ETF mundial e 20% em cripto. A app sugere onde pôr o dinheiro novo para te aproximares disto.</p>
    <div class="row2" style="margin-bottom:12px"><button type="button" class="btn ghost" id="tgNow" style="justify-content:center">Usar a atual</button>
      <button type="button" class="btn ghost" id="tgClear" style="justify-content:center">Limpar</button></div>
    <div class="tg-list">${list.map(h => `<div class="tg-row"><div class="tg-n"><b>${esc(h.name)}</b><small>agora ${((h.value / total) * 100).toFixed(1).replace('.', ',')}%</small></div>
      <div class="tg-in"><input class="inp mono" data-tg="${esc(h.key)}" inputmode="decimal" autocomplete="off" value="${saved[h.key] > 0 ? String(saved[h.key]).replace('.', ',') : ''}" placeholder="0"><span>%</span></div></div>`).join('')}</div>
    <div class="tg-sum" id="tgSum"></div>
    <button type="button" class="btn pri wide" id="tgSave" style="margin-top:12px">Guardar</button>`);
  const inputs = () => $$('[data-tg]');
  const sum = () => inputs().reduce((s, i) => s + (num(i.value) || 0), 0);
  const showSum = () => {
    const v = sum();
    $('#tgSum').innerHTML = `Soma: <b class="${Math.abs(v - 100) < 0.5 ? 'up' : 'warn'}">${v.toFixed(1).replace('.', ',')}%</b>${v > 0 && Math.abs(v - 100) >= 0.5 ? ' — não dá 100%, a app ajusta proporcionalmente.' : ''}`;
  };
  for (const i of inputs()) i.oninput = showSum;
  $('#tgNow').onclick = () => {
    const now = currentAsTargets(list);
    for (const i of inputs()) i.value = String(now[i.dataset.tg] ?? 0).replace('.', ',');
    showSum();
  };
  $('#tgClear').onclick = () => { for (const i of inputs()) i.value = ''; showSum(); };
  showSum();
  $('#tgSave').onclick = () => {
    const t = {};
    for (const i of inputs()) { const v = num(i.value); if (v > 0) t[i.dataset.tg] = v; }
    state.settings.targets = t;
    commit();
    closeModal();
    toast(Object.keys(t).length ? 'Alocação alvo guardada' : 'Alvos apagados');
  };
}
