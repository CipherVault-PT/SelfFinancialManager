import { PLATFORM_CLASS } from '../config.js';
import { save } from '../store.js';
import { taxLines, taxYears, defaultTaxYear, taxSummary, ensureFxHistory, taxCSV, lineNotes, TAX_RATE } from '../tax.js';
import { esc, money, signed, units, plural } from '../format.js';
import { $, toast, openModal, modalOpen, segmented, saveFile } from './dom.js';

const eur = v => money(v, 'EUR');
const upDown = v => (v >= 0 ? 'up' : 'down');
const header = `<div class="mh"><h3>Relatório IRS · mais-valias</h3><button type="button" class="x" data-action="modal-close" aria-label="Fechar">✕</button></div>`;

export async function modalTax(year) {
  const years = taxYears(taxLines());
  if (!years.length) {
    openModal(`${header}<p class="mlead">Ainda não tens vendas registadas. Quando venderes (no todo ou em parte), o relatório aparece aqui por ano.</p>`);
    return;
  }
  const y = years.includes(year) ? year : defaultTaxYear(years);
  draw(y, years);
  try {
    if (await ensureFxHistory()) {
      save();
      if (modalOpen() && $('#taxBody')) draw(y, years);
    }
  } catch { /* sem câmbio histórico: os valores ficam marcados como aproximados */ }
}

function groupCard(title, g, { excluded = false, hint = '' } = {}) {
  if (!g.count) return '';
  return `<div class="tcard">
    <div class="k">${title}</div>
    <div class="v ${excluded ? '' : upDown(g.net)}">${signed(g.net, eur(g.net))}</div>
    <div class="tc-rows">
      <span>Mais-valias</span><b class="up">${eur(g.gains)}</b>
      <span>Menos-valias</span><b class="down">${g.losses ? `−${eur(g.losses)}` : eur(0)}</b>
      ${excluded
        ? '<span>Imposto</span><b>excluída</b>'
        : `<span>Imposto estimado (${Math.round(TAX_RATE * 100)}%)</span><b>${eur(g.tax)}</b>`}
    </div>
    ${hint ? `<div class="sd">${hint}</div>` : ''}
  </div>`;
}

function lineRow(l) {
  const notes = lineNotes(l);
  return `<div class="tline">
    <div class="tl-h"><div style="min-width:0"><b>${esc(l.name)}</b> <span class="mono">${units(l.units)} ${esc(l.symbol)}</span></div>
      <b class="mono ${upDown(l.gain)}">${signed(l.gain, eur(l.gain))}</b></div>
    <div class="tl-g">
      <span>Aquisição</span><b>${esc(l.acqDate || '—')} · ${eur(l.acqEUR)}</b>
      <span>Realização</span><b>${esc(l.saleDate || '—')} · ${eur(l.saleEUR)}</b>
      <span>Detido</span><b>${l.days != null ? plural(l.days, 'dia', 'dias') : '—'}</b>
    </div>
    ${notes ? `<div class="tl-n">${esc(notes)}</div>` : ''}
  </div>`;
}

function draw(year, years) {
  const sum = taxSummary(taxLines(), year);
  const { securities, crypto, cryptoLong } = sum.groups;
  const byPlatform = new Map();
  for (const l of sum.lines) {
    const k = l.platform || 'Outra';
    byPlatform.set(k, [...(byPlatform.get(k) ?? []), l]);
  }
  const warnings = [
    sum.shortTermGains && `${plural(sum.shortTermGains, 'linha de ações/ETFs', 'linhas de ações/ETFs')} com ganho e detidas menos de 365 dias: se o teu rendimento coletável (incluindo estes ganhos) chegar ao último escalão do IRS, o saldo destas vendas tem de ser englobado.`,
    sum.approxFx && `${plural(sum.approxFx, 'linha usa', 'linhas usam')} o câmbio atual, porque não consegui o câmbio do BCE da data — confirma esses valores.`,
    sum.missingDate && `${plural(sum.missingDate, 'linha não tem', 'linhas não têm')} data de compra ou de venda — o prazo de detenção não pode ser calculado.`,
  ].filter(Boolean);

  openModal(`${header}
    <div class="seg tyears" id="tYear">${years.map(y => `<button type="button" data-y="${y}" class="${y === year ? 'on' : ''}">${y}</button>`).join('')}</div>
    <div id="taxBody">
      <p class="mlead">Ajuda para preencher o IRS de <b>${year}</b>, calculada pelo método <b>FIFO</b> com as vendas que registaste. Os valores já incluem comissões e taxas de câmbio. <b>Não é aconselhamento fiscal.</b></p>
      <div class="tcards">
        ${groupCard('Ações e ETFs', securities)}
        ${groupCard('Cripto < 365 dias', crypto)}
        ${groupCard('Cripto ≥ 365 dias', cryptoLong, { excluded: true, hint: 'Excluída de tributação (regra em vigor desde 2023).' })}
      </div>
      ${sum.taxTotal > 0 ? `<div class="ttotal"><span>Imposto estimado à taxa autónoma</span><b>${eur(sum.taxTotal)}</b></div>` : ''}
      ${warnings.length ? `<ul class="twarn">${warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
      <div class="tinfo"><b>Onde declarar.</b> Ações e ETFs em corretoras estrangeiras vão normalmente no <b>Anexo J, quadro 9.2 A</b>, uma linha por cada compra vendida — é o que a lista abaixo mostra. A cripto tem quadros próprios. Confirma o anexo, o código e o país no guia de IRS da tua corretora (XTB, Trade Republic e Revolut publicam um) ou com um contabilista, e compara com o relatório fiscal anual que a corretora te envia.</div>
      <button type="button" class="btn ghost wide" id="tCsv" style="margin:6px 0 18px">↓ Exportar ${year} em CSV (Excel)</button>
      ${[...byPlatform].map(([plat, rows]) => `
        <div class="sh" style="margin:16px 0 10px"><span class="chip ${PLATFORM_CLASS[plat] ?? ''}">${esc(plat)}</span><span class="hint">${plural(rows.length, 'linha', 'linhas')}</span></div>
        <div class="tlines">${rows.map(lineRow).join('')}</div>`).join('')}
    </div>`, { wide: true });

  segmented($('#tYear'), 'y', y => draw(y, years));
  $('#tCsv').onclick = async () => {
    if (await saveFile(taxCSV(sum.lines), `aurora-irs-${year}.csv`, 'text/csv')) toast('CSV exportado');
  };
}
