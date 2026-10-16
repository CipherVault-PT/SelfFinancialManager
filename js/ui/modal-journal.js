import { state, commit, normalizeJournal } from '../store.js';
import { metrics, closedM } from '../calc.js';
import { disp } from '../fx.js';
import { addAlert, alertsFor } from '../alerts.js';
import { distance, holdDays, tradeStats, insights, PERIODS } from '../journal.js';
import { esc, money, price, pct, signed, num, inputNum, plural } from '../format.js';
import { $, toast, openModal, closeModal } from './dom.js';

const upDown = v => (v >= 0 ? 'up' : 'down');

/** Resumo do diário no cartão de uma posição aberta. */
export function journalLine(p, m) {
  const j = p.journal;
  if (!j) return '';
  const same = !j.cur || j.cur === m.nativeCur;
  const lvl = (icon, v, label) => {
    if (!v) return '';
    const d = same ? distance(v, m.nativePrice) : null;
    return `<span>${icon} ${label} <b class="mono">${price(v, j.cur || m.nativeCur)}</b>${d != null ? ` <span class="${upDown(d)}">(${pct(d)})</span>` : ''}</span>`;
  };
  const levels = [lvl('🎯', j.target, 'alvo'), lvl('🛑', j.stop, 'stop')].filter(Boolean).join('');
  const broke = same && j.stop && m.nativePrice > 0 && m.nativePrice <= j.stop;
  return `<div class="jline${broke ? ' broke' : ''}">${j.thesis ? `<div class="jthesis">📓 ${esc(j.thesis)}</div>` : ''}
    ${levels ? `<div class="jlv">${levels}${broke ? '<span class="down">· abaixo do stop</span>' : ''}</div>` : ''}</div>`;
}

/** Tese, alvo e stop de uma posição aberta (opcionalmente com alertas). */
export function modalJournal(id) {
  const p = state.positions.find(x => x.id === id);
  if (!p) return;
  const m = metrics(p), j = p.journal ?? {}, cur = j.cur || m.nativeCur;
  const hasAlerts = alertsFor(id).some(a => a.active);
  openModal(`<div class="mh"><h3>Diário · ${esc(p.name)}</h3><button type="button" class="x" data-action="modal-close" aria-label="Fechar">✕</button></div>
    <p class="mlead">Escreve <b>porque compraste</b> e onde sais — a ganhar (alvo) e a perder (stop). Ao vender, a app lembra-te do plano. Agora: <b>${price(m.nativePrice, m.nativeCur)}</b>.</p>
    <div class="field"><label for="jThesis">Tese <span class="sublbl">porque compraste</span></label>
      <textarea class="inp" id="jThesis" rows="3" placeholder="ex: resultados fortes, a cair só pelo mercado; espero recuperar até ao máximo do ano" data-autofocus>${esc(j.thesis || '')}</textarea></div>
    <div class="row2">
      <div class="field"><label for="jTarget">🎯 Alvo (${esc(cur)})</label><input class="inp mono" id="jTarget" inputmode="decimal" autocomplete="off" placeholder="vender a ganhar" value="${j.target ? inputNum(j.target) : ''}"></div>
      <div class="field"><label for="jStop">🛑 Stop (${esc(cur)})</label><input class="inp mono" id="jStop" inputmode="decimal" autocomplete="off" placeholder="sair a perder" value="${j.stop ? inputNum(j.stop) : ''}"></div>
    </div>
    <div class="curhint" id="jRisk"></div>
    <label class="chk" style="margin-top:10px"><input type="checkbox" id="jAlerts" ${hasAlerts ? '' : 'checked'}> Criar alertas de preço no alvo e no stop</label>
    <button type="button" class="btn pri wide" id="jSave" style="margin-top:14px">Guardar</button>`);

  const read = () => ({ target: num($('#jTarget').value) || null, stop: num($('#jStop').value) || null });
  const risk = () => {
    const { target, stop } = read(), now = m.nativePrice;
    const up = distance(target, now), down = distance(stop, now);
    const ratio = up > 0 && down < 0 ? up / Math.abs(down) : null;
    $('#jRisk').innerHTML = [
      up != null && `Alvo a <b class="${upDown(up)}">${pct(up)}</b>`,
      down != null && `stop a <b class="${upDown(down)}">${pct(down)}</b>`,
      ratio != null && `ganhas <b>${ratio.toFixed(1).replace('.', ',')}×</b> o que arriscas${ratio < 1.5 ? ' — pouco para o risco' : ''}`,
    ].filter(Boolean).join(' · ');
  };
  $('#jTarget').oninput = risk;
  $('#jStop').oninput = risk;
  risk();

  $('#jSave').onclick = () => {
    const { target, stop } = read();
    if (target && stop && stop >= target) return toast('O stop tem de ficar abaixo do alvo', true);
    const journal = normalizeJournal({ thesis: $('#jThesis').value.trim(), target, stop, cur });
    if (journal) p.journal = journal; else delete p.journal;
    let made = 0;
    if ($('#jAlerts').checked) {
      const exists = (above, v) => alertsFor(id).some(a => a.active && a.above === above && Math.abs(a.price - v) < 1e-9);
      if (target && !exists(true, target)) { addAlert(p, { above: true, price: target, cur }); made++; }
      if (stop && !exists(false, stop)) { addAlert(p, { above: false, price: stop, cur }); made++; }
    }
    commit();
    closeModal();
    toast(`Diário guardado${made ? ` · ${plural(made, 'alerta criado', 'alertas criados')}` : ''}`);
  };
}

/** Uma venda do histórico: o plano, o resultado e a nota (editável). */
export function modalTrade(id) {
  const c = state.closed.find(x => x.id === id);
  if (!c) return;
  const m = closedM(c), j = c.journal, days = holdDays(c), cur = j?.cur || c.exitCur || c.currency;
  const exit = c.exitPrice > 0 ? c.exitPrice : null;
  const gap = v => { const d = distance(exit, v); return d == null ? '' : ` <span class="muted">· vendeste ${Math.abs(d).toFixed(1).replace('.', ',')}% ${d < 0 ? 'abaixo' : 'acima'}</span>`; };
  const vs = (v, label) => (v ? `<span>${label} <b class="mono">${price(v, cur)}</b>${gap(v)}</span>` : '');
  openModal(`<div class="mh"><h3>${esc(c.name)}</h3><button type="button" class="x" data-action="modal-close" aria-label="Fechar">✕</button></div>
    <div class="preview big">
      <div class="pr"><span>Resultado</span><b class="${upDown(m.pl)}">${signed(m.pl, money(m.pl, c.currency))} · ${pct(m.plp)}</b></div>
      <div class="pr"><span>Vendido em</span><b>${esc(c.closedAt || '—')}${exit ? ` a ${price(exit, c.exitCur || c.currency)}` : ''}</b></div>
      <div class="pr"><span>Tempo na carteira</span><b>${days != null ? plural(days, 'dia', 'dias') : '—'}</b></div>
    </div>
    ${j ? `<div class="mlabel" style="margin-top:14px">O plano</div>
      ${j.thesis ? `<div class="jthesis">📓 ${esc(j.thesis)}</div>` : ''}
      <div class="jlv">${vs(j.target, '🎯 alvo')}${vs(j.stop, '🛑 stop')}</div>` : ''}
    <div class="field" style="margin-top:14px"><label for="tNote">Nota da venda <span class="sublbl">o que correu bem ou mal</span></label>
      <textarea class="inp" id="tNote" rows="3" placeholder="ex: vendi por medo antes dos resultados; da próxima respeito o plano">${esc(c.note || '')}</textarea></div>
    <button type="button" class="btn pri wide" id="tSave">Guardar nota</button>`);
  $('#tSave').onclick = () => {
    const note = $('#tNote').value.trim().slice(0, 1000);
    if (note) c.note = note; else delete c.note;
    commit();
    closeModal();
    toast('Nota guardada');
  };
}

const days = d => (d == null ? '—' : plural(Math.round(d), 'dia', 'dias'));
const ratio = v => (v == null ? '—' : v === Infinity ? '∞' : `${v.toFixed(2).replace('.', ',')}×`);

/** Estatísticas do diário no topo do Histórico. */
export function journalSection(period) {
  if (!state.closed.length) return '';
  const d = disp(), st = tradeStats(state.closed, { period, cur: d });
  const seg = `<div class="seg chart-seg">${PERIODS.map(([k, l]) => `<button data-action="journal-period" data-p="${k}" class="${period === k ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  const head = `<div class="sh"><h3>📓 Diário de trades</h3><div class="sh-r">${seg}</div></div>`;
  if (!st.n) return `${head}<div class="searching" style="text-align:left;padding:4px 0 14px">Sem vendas neste período.</div>`;
  const tile = (k, v, s, cls = '') => `<div class="tile"><div class="k">${k}</div><div class="v ${cls}" style="font-size:19px">${v}</div><div class="s">${s}</div></div>`;
  const notes = insights(st);
  return `${head}
    <div class="stats">
      ${tile('Taxa de acerto', st.winRate == null ? '—' : `${st.winRate.toFixed(0)}%`, `${st.wins} de ${plural(st.n, 'trade', 'trades')}`, st.winRate >= 50 ? 'up' : 'down')}
      ${tile('Ganho médio', st.avgWin == null ? '—' : money(st.avgWin, d), st.avgWinPct == null ? 'sem ganhos' : pct(st.avgWinPct), 'up')}
      ${tile('Perda média', st.avgLoss == null ? '—' : money(st.avgLoss, d), st.avgLossPct == null ? 'sem perdas' : pct(st.avgLossPct), 'down')}
      ${tile('Ganho ÷ perda', ratio(st.payoff), `profit factor ${ratio(st.profitFactor)}`, st.payoff == null ? '' : upDown(st.payoff - 1))}
      ${tile('Por trade', st.expectancy == null ? '—' : signed(st.expectancy, money(st.expectancy, d)), `total ${signed(st.total, money(st.total, d))}`, upDown(st.expectancy ?? 0))}
      ${tile('Tempo médio', days(st.avgDays), `ganhos ${days(st.avgDaysWin)} · perdas ${days(st.avgDaysLoss)}`)}
    </div>
    <div class="perf-notes">
      ${st.best ? `<div>Melhor: <b>${esc(st.best.c.name)}</b> <span class="up">${pct(st.best.plp)}</span>${st.worst ? ` · pior: <b>${esc(st.worst.c.name)}</b> <span class="${upDown(st.worst.plp)}">${pct(st.worst.plp)}</span>` : ''}</div>` : ''}
      ${notes.map(x => `<div class="warn">${esc(x)}</div>`).join('')}
      <div>Cada venda (também as parciais) conta como um trade. Toca no 📓 de uma venda para ver o plano e escrever o que aprendeste${st.withNotes ? ` — ${plural(st.withNotes, 'venda tem', 'vendas têm')} notas` : ''}.</div>
    </div>`;
}
