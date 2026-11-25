import { state, commit } from '../store.js';
import { readXlsx } from '../import/xlsx.js';
import { isXtb, parseXtb } from '../import/xtb.js';
import { parseCsv } from '../import/csv.js';
import { isTr, parseTr, resolveIsins } from '../import/tr.js';
import { isRevolut, parseRevolut, resolveCoins } from '../import/revolut.js';
import { searchYahoo } from '../quotes/stocks.js';
import { searchCoins } from '../quotes/crypto.js';
import { planImport, applyImport, manualCount } from '../import/apply.js';
import { refresh } from '../quotes/index.js';
import { daysBetween } from '../performance.js';
import { esc, money, plural, todayISO } from '../format.js';

const num = v => v.toLocaleString('pt-PT', { maximumFractionDigits: 4 });
import { $, toast, openModal, closeModal } from './dom.js';

const header = `<div class="mh"><h3>Importar extrato</h3><button type="button" class="x" data-action="modal-close" aria-label="Fechar">✕</button></div>`;

const BROKERS = [
  ['XTB', 'Excel (.xlsx)', true],
  ['Trade Republic', 'CSV', true],
  ['Revolut', 'cripto · CSV', true],
];

export function modalImport(error = '') {
  openModal(`${header}
    <p class="mlead">Cria as posições, as <b>vendas com a data de cada compra</b> (para o IRS) e os dividendos a partir do extrato da corretora. O ficheiro é lido <b>só neste dispositivo</b>.</p>
    <div class="imp-brokers">${BROKERS.map(([n, s, on]) => `<div class="imp-b${on ? '' : ' off'}"><b>${n}</b><span>${s}</span></div>`).join('')}</div>
    <div class="imp-how"><b>XTB:</b> na xStation, abre o <i>Histórico</i> da conta, escolhe o período <b>desde que abriste a conta até hoje</b> e exporta para <i>Excel</i>. Se tens conta em euros e em dólares, importa um ficheiro de cada.</div>
    <div class="imp-how"><b>Trade Republic:</b> exporta as <i>transações</i> em CSV, <b>desde que abriste a conta</b>. Não precisas de mexer no ficheiro.</div>
    <div class="imp-how"><b>Revolut (cripto):</b> Cripto → ⋯ → Documentos → Extrato de conta, em Excel/CSV, de <b>todo o período</b>.</div>
    ${error ? `<div class="imp-err" role="alert">${esc(error)}</div>` : ''}
    <label class="btn pri wide imp-pick">Escolher ficheiro…<input type="file" id="iFile" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" class="hide"></label>`);
  $('#iFile').onchange = async e => {
    const f = e.target.files?.[0];
    if (!f) return;
    $('.imp-pick').classList.add('busy');
    try {
      preview(await readStatement(f));
    } catch (err) {
      modalImport(err?.message || 'Não consegui ler o ficheiro.');
    }
  };
}

/** Lê o ficheiro escolhido: Excel da XTB ou CSV da Trade Republic (este com os símbolos encontrados pelo ISIN). */
async function readStatement(f) {
  const head = new Uint8Array(await f.slice(0, 2).arrayBuffer());
  if (head[0] === 0x50 && head[1] === 0x4b) {
    const wb = await readXlsx(await f.arrayBuffer());
    if (!isXtb(wb)) throw new Error('Não reconheci este ficheiro. A app lê o extrato da XTB (Excel) e as transações da Trade Republic (CSV).');
    return parseXtb(wb, { rates: state.cache.rates });
  }
  const text = await f.text(), head2 = parseCsv(text.slice(0, 4000));
  const pick = $('.imp-pick');
  if (isRevolut(head2)) {
    if (pick) pick.firstChild.textContent = 'A identificar as moedas…';
    return resolveCoins(parseRevolut(text, { modified: f.lastModified }), { known: knownCoins(), search: searchCoins });
  }
  if (!isTr(head2)) throw new Error('Não reconheci este ficheiro. A app lê o extrato da XTB (Excel), as transações da Trade Republic (CSV) e o extrato de cripto da Revolut (CSV).');
  const stmt = parseTr(text, { name: f.name });
  if (pick) pick.firstChild.textContent = 'A identificar as ações…';
  return resolveIsins(stmt, isin => searchYahoo(isin));
}

/** Moedas que já tens na app (símbolo → id da CoinGecko), para o extrato cair nas mesmas posições. */
function knownCoins() {
  const out = {};
  for (const p of [...state.positions, ...state.closed, ...state.watchlist]) {
    if (p.kind === 'crypto' && p.coingeckoId && p.symbol) out[String(p.symbol).toUpperCase()] ??= { id: p.coingeckoId, name: p.name, thumb: p.thumb };
  }
  return out;
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
    stmt.approx?.length && (stmt.kind === 'crypto'
      ? row('ℹ', `${plural(stmt.approx.length, 'receção', 'receções')} de cripto (${esc([...new Set(stmt.approx.map(a => a.symbol))].join(', '))}) — custo pelo valor no dia em que chegou. Se veio de outra corretora, o custo e a data reais são os da compra original.`, 'warn')
      : row('ℹ', `${stmt.approx.map(a => `${esc(a.name)}: ${num(a.units)} un. compradas antes de ${esc(stmt.period?.from ?? '')}`).join('; ')} — custo pelo preço médio da corretora e data aproximada. Para valores exatos, exporta desde a abertura da conta.`, 'warn')),
    stmt.sent && row('ℹ', `${plural(stmt.sent, 'envio', 'envios')} de cripto para fora — saem das posições, não contam como venda.`, 'muted'),
    stmt.missing?.length && row('⚠', `Vendas sem as compras no ficheiro (${esc(stmt.missing.map(m => m.name).join(', '))}) — ficam de fora. Exporta desde a abertura da conta.`, 'warn'),
    stmt.unresolved?.length && row('⚠', stmt.kind === 'crypto'
      ? `Não encontrei na CoinGecko: ${esc(stmt.unresolved.join(', '))} — ficam sem cotação ao vivo.`
      : `Sem cotação ao vivo (não encontrei o símbolo): ${esc(stmt.unresolved.join(', '))} — usa "Preço atual" no cartão.`, 'warn'),
    stmt.interest.gross > 0 && row('ℹ', `Juros do saldo não investido: ${money(stmt.interest.gross, cur)} (imposto ${money(stmt.interest.tax, cur)}) — não são importados.`, 'muted'),
    (stmt.deposits > 0 || stmt.withdrawals > 0) && row('ℹ', `Depósitos ${money(stmt.deposits || 0, cur)} e levantamentos ${money(stmt.withdrawals || 0, cur)} no período — o saldo em dinheiro acertas em Fundo / Cash.`, 'muted'),
  ].filter(Boolean);
  const nothing = !s.changes;

  openModal(`${header}
    <div class="imp-meta"><b>${esc(stmt.broker)}</b>${stmt.kind === 'crypto' ? ' · cripto' : ''} · conta em ${esc(cur)}${stmt.period ? ` · ${esc(stmt.period.from)} a ${esc(stmt.period.to)}` : ''}</div>
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
