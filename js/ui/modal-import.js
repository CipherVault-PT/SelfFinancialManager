import { state, commit } from '../store.js';
import { readXlsx } from '../import/xlsx.js';
import { isXtb, parseXtb } from '../import/xtb.js';
import { planImport, applyImport, manualCount } from '../import/apply.js';
import { refresh } from '../quotes/index.js';
import { daysBetween } from '../performance.js';
import { esc, money, plural, todayISO } from '../format.js';
import { $, toast, openModal, closeModal } from './dom.js';

const header = `<div class="mh"><h3>Importar extrato</h3><button type="button" class="x" data-action="modal-close" aria-label="Fechar">✕</button></div>`;

const BROKERS = [
  ['XTB', 'Excel (.xlsx)', true],
  ['Revolut', 'em breve', false],
  ['Trade Republic', 'em breve', false],
];

export function modalImport(error = '') {
  openModal(`${header}
    <p class="mlead">Cria as posições, as <b>vendas com a data de cada compra</b> (para o IRS) e os dividendos a partir do extrato da corretora. O ficheiro é lido <b>só neste dispositivo</b>.</p>
    <div class="imp-brokers">${BROKERS.map(([n, s, on]) => `<div class="imp-b${on ? '' : ' off'}"><b>${n}</b><span>${s}</span></div>`).join('')}</div>
    <div class="imp-how"><b>XTB:</b> na xStation, abre o <i>Histórico</i> da conta, escolhe o período <b>desde que abriste a conta até hoje</b> e exporta para <i>Excel</i>. Não precisas de mexer no ficheiro.</div>
    ${error ? `<div class="imp-err" role="alert">${esc(error)}</div>` : ''}
    <label class="btn pri wide imp-pick">Escolher ficheiro…<input type="file" id="iFile" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" class="hide"></label>`);
  $('#iFile').onchange = async e => {
    const f = e.target.files?.[0];
    if (!f) return;
    $('.imp-pick').classList.add('busy');
    try {
      const wb = await readXlsx(await f.arrayBuffer());
      if (!isXtb(wb)) throw new Error('Não reconheci este ficheiro. Por agora a app lê o extrato da XTB em Excel.');
      preview(parseXtb(wb, { rates: state.cache.rates }));
    } catch (err) {
      modalImport(err?.message || 'Não consegui ler o ficheiro.');
    }
  };
}

function preview(stmt, replace = true) {
  const manual = manualCount(stmt.broker, stmt);
  const hasManual = manual.lots + manual.sales > 0;
  const plan = planImport(stmt, { replace: hasManual && replace });
  const s = plan.summary, cur = stmt.currency;
  const names = [...new Set(stmt.open.map(r => r.name))];
  const stale = stmt.snapshot && daysBetween(stmt.snapshot, todayISO()) > 7;
  const row = (ic, html, cls = '') => `<div class="imp-row ${cls}"><span class="imp-ic" aria-hidden="true">${ic}</span><div>${html}</div></div>`;
  const rows = [
    s.openLots && row('📈', `<b>${plural(s.openLots, 'compra em aberto', 'compras em aberto')}</b> em ${plural(s.touched, 'posição', 'posições')}${names.length ? ` <small>${esc(names.join(', '))}</small>` : ''}`),
    s.sales && row('🧾', `<b>${plural(s.sales, 'venda', 'vendas')}</b> (${plural(s.saleLots, 'compra vendida', 'compras vendidas')}) — vão para o Histórico e para o relatório do IRS`),
    s.dividends && row('💰', `<b>${plural(s.dividends, 'dividendo', 'dividendos')}</b> com o imposto retido`),
    s.reduced && row('↘', `${plural(s.reduced, 'compra importada antes foi vendida', 'compras importadas antes foram vendidas')} entretanto`),
    s.removedLots + s.removedSales > 0 && row('🔁', `${s.removedLots + s.removedSales === 1 ? 'Sai' : 'Saem'} ${[s.removedLots && plural(s.removedLots, 'entrada', 'entradas'), s.removedSales && plural(s.removedSales, 'venda', 'vendas')].filter(Boolean).join(' e ')} que registaste à mão${s.removedPositions.length ? ` <small>sai: ${esc(s.removedPositions.join(', '))}</small>` : ''}`),
    s.skipped && row('↷', `${plural(s.skipped, 'movimento já importado', 'movimentos já importados')} — ignorado${s.skipped === 1 ? '' : 's'}`, 'muted'),
    stmt.cfd.count && row('⚠', `${plural(stmt.cfd.count, 'operação CFD ignorada', 'operações CFD ignoradas')} (resultado ${money(stmt.cfd.pl, cur)}). A app só acompanha ações e ETFs; para o IRS dos CFDs usa o relatório fiscal da XTB.`, 'warn'),
    stmt.interest.gross > 0 && row('ℹ', `Juros do saldo não investido: ${money(stmt.interest.gross, cur)} (imposto ${money(stmt.interest.tax, cur)}) — não são importados.`, 'muted'),
  ].filter(Boolean);
  const nothing = !s.changes;

  openModal(`${header}
    <div class="imp-meta"><b>${esc(stmt.broker)}</b> · conta em ${esc(cur)}${stmt.period ? ` · ${esc(stmt.period.from)} a ${esc(stmt.period.to)}` : ''}</div>
    <div class="imp-list">${rows.join('') || row('✓', 'Nada de novo neste extrato.')}</div>
    ${stale ? `<div class="imp-err warn">As posições abertas do ficheiro são as de <b>${esc(stmt.snapshot)}</b>. Se compraste ou vendeste depois disso, exporta de novo até hoje.</div>` : ''}
    ${hasManual ? `<div class="field" style="margin-top:14px"><label>Já tens ${plural(manual.lots + manual.sales, 'entrada', 'entradas')} da ${esc(stmt.broker)} registada${manual.lots + manual.sales === 1 ? '' : 's'} à mão</label>
      <div class="imp-opts">
        <label class="imp-opt"><input type="radio" name="iMode" value="replace"${replace ? ' checked' : ''}><span><b>Substituir pelo extrato</b> (recomendado)<small>valores e datas exatos; mantém os teus alertas e classificações</small></span></label>
        <label class="imp-opt"><input type="radio" name="iMode" value="merge"${replace ? '' : ' checked'}><span><b>Juntar</b><small>pode duplicar o que já registaste</small></span></label>
      </div></div>` : ''}
    <div class="row2" style="margin-top:16px"><button type="button" class="btn ghost" id="iBack" style="justify-content:center">Outro ficheiro</button>
      <button type="button" class="btn pri" id="iDo" style="justify-content:center"${nothing ? ' disabled' : ''}>Importar</button></div>
    <p class="sd" style="margin-top:10px;font-size:12px;color:var(--muted-2)">Podes desfazer em ⚙ → Dados e segurança → Repor os dados de antes da importação.</p>`);

  for (const r of document.querySelectorAll('input[name=iMode]')) r.onchange = () => preview(stmt, r.value === 'replace');
  $('#iBack').onclick = () => modalImport();
  $('#iDo').onclick = () => {
    applyImport(plan);
    commit();
    closeModal();
    toast(`Extrato importado${s.sales ? ` · ${plural(s.sales, 'venda', 'vendas')}` : ''}${s.openLots ? ` · ${plural(s.touched, 'posição', 'posições')}` : ''}`);
    refresh({ force: true });
  };
}
