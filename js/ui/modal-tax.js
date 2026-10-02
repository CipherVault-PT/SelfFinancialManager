import { PLATFORM_CLASS } from '../config.js';
import { save } from '../store.js';
import {
  taxLines, taxYears, defaultTaxYear, taxSummary, ensureFxHistory, taxCSV, lineNotes, TAX_RATE,
  dividendLines, dividendSummary, dividendCSV, dividendNotes,
} from '../tax.js';
import { HIGH_WITHHOLDING } from '../dividends.js';
import { esc, money, signed, units, plural } from '../format.js';
import { $, toast, openModal, modalOpen, segmented, saveFile } from './dom.js';

const eur = v => money(v, 'EUR');
const upDown = v => (v >= 0 ? 'up' : 'down');
const header = `<div class="mh"><h3>Relatório IRS</h3><button type="button" class="x" data-action="modal-close" aria-label="Fechar">✕</button></div>`;

export async function modalTax(year) {
  const years = taxYears([...taxLines(), ...dividendLines()]);
  if (!years.length) {
    openModal(`${header}<p class="mlead">Ainda não tens vendas nem dividendos registados. Quando venderes (no todo ou em parte) ou registares dividendos, o relatório aparece aqui por ano.</p>`);
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

function divCard(dv) {
  if (!dv.count) return '';
  return `<div class="tcard tdiv">
    <div class="k">Dividendos</div>
    <div class="v up">${eur(dv.gross)}</div>
    <div class="tc-rows">
      <span>Retido no estrangeiro</span><b class="down">${dv.withheld ? `−${eur(dv.withheld)}` : eur(0)}</b>
      <span>Líquido recebido</span><b>${eur(dv.net)}</b>
      <span>Imposto adicional estimado</span><b>${eur(dv.ptTax)}</b>
    </div>
    <div class="sd">${Math.round(TAX_RATE * 100)}% do bruto menos o imposto já retido, dividendo a dividendo.</div>
  </div>`;
}

function divRow(l) {
  const notes = dividendNotes(l);
  return `<div class="tline">
    <div class="tl-h"><div style="min-width:0"><b>${esc(l.name)}</b> <span class="mono">${esc(l.symbol)}</span></div>
      <b class="mono up">${eur(l.netEUR)}</b></div>
    <div class="tl-g">
      <span>Data</span><b>${esc(l.date)}</b>
      <span>Bruto</span><b>${eur(l.grossEUR)}${l.currency !== 'EUR' ? ` (${money(l.gross, l.currency)})` : ''}</b>
      <span>Retido</span><b>${eur(l.withheldEUR)}</b>
    </div>
    ${notes ? `<div class="tl-n">${esc(notes)}</div>` : ''}
  </div>`;
}

const byPlatform = rows => {
  const m = new Map();
  for (const l of rows) {
    const k = l.platform || 'Outra';
    m.set(k, [...(m.get(k) ?? []), l]);
  }
  return [...m];
};

const groupedList = (rows, row) => byPlatform(rows).map(([plat, list]) => `
  <div class="sh" style="margin:14px 0 10px"><span class="chip ${PLATFORM_CLASS[plat] ?? ''}">${esc(plat)}</span><span class="hint">${plural(list.length, 'linha', 'linhas')}</span></div>
  <div class="tlines">${list.map(row).join('')}</div>`).join('');

function draw(year, years) {
  const sum = taxSummary(taxLines(), year);
  const dv = dividendSummary(dividendLines(), year);
  const { securities, crypto, cryptoLong } = sum.groups;
  const taxTotal = sum.taxTotal + dv.ptTax;
  const approx = sum.approxFx + dv.approxFx;
  const warnings = [
    sum.shortTermGains && `${plural(sum.shortTermGains, 'linha de ações/ETFs', 'linhas de ações/ETFs')} com ganho e detidas menos de 365 dias: se o teu rendimento coletável (incluindo estes ganhos) chegar ao último escalão do IRS, o saldo destas vendas tem de ser englobado.`,
    approx && `${plural(approx, 'linha usa', 'linhas usam')} o câmbio atual, porque não consegui o câmbio do BCE da data — confirma esses valores.`,
    dv.highWithholding && `${plural(dv.highWithholding, 'dividendo teve', 'dividendos tiveram')} retenção acima de ${HIGH_WITHHOLDING * 100}%: normalmente só é dedutível até à taxa da convenção (em regra ${HIGH_WITHHOLDING * 100}%), por isso o imposto adicional pode ser maior que o estimado. Nas ações dos EUA, preenche o W-8BEN.`,
    sum.missingDate && `${plural(sum.missingDate, 'linha não tem', 'linhas não têm')} data de compra ou de venda — o prazo de detenção não pode ser calculado.`,
  ].filter(Boolean);

  openModal(`${header}
    <div class="seg tyears" id="tYear">${years.map(y => `<button type="button" data-y="${y}" class="${y === year ? 'on' : ''}">${y}</button>`).join('')}</div>
    <div id="taxBody">
      <p class="mlead">Ajuda para preencher o IRS de <b>${year}</b>, com as vendas (método <b>FIFO</b>) e os dividendos que registaste. Os valores das vendas já incluem comissões e taxas de câmbio. <b>Não é aconselhamento fiscal.</b></p>
      <div class="tcards">
        ${groupCard('Ações e ETFs', securities)}
        ${groupCard('Cripto < 365 dias', crypto)}
        ${groupCard('Cripto ≥ 365 dias', cryptoLong, { excluded: true, hint: 'Excluída de tributação (regra em vigor desde 2023).' })}
        ${divCard(dv)}
      </div>
      ${taxTotal > 0 ? `<div class="ttotal"><span>Imposto estimado à taxa autónoma</span><b>${eur(taxTotal)}</b></div>` : ''}
      ${warnings.length ? `<ul class="twarn">${warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
      <div class="tinfo"><b>Onde declarar.</b> Ações e ETFs em corretoras estrangeiras vão normalmente no <b>Anexo J, quadro 9.2 A</b>, uma linha por cada compra vendida — é o que a lista abaixo mostra. Os dividendos de empresas estrangeiras vão normalmente no <b>Anexo J, quadro 8 A</b> (código E11), com o país da empresa e o imposto retido no estrangeiro. A cripto tem quadros próprios. Confirma o anexo, o código e o país no guia de IRS da tua corretora (XTB, Trade Republic e Revolut publicam um) ou com um contabilista, e compara com o relatório fiscal anual que a corretora te envia.</div>
      <div class="row2" style="margin:6px 0 8px">
        ${sum.lines.length ? '<button type="button" class="btn ghost" id="tCsv" style="justify-content:center">↓ Vendas (CSV)</button>' : ''}
        ${dv.count ? '<button type="button" class="btn ghost" id="tDivCsv" style="justify-content:center">↓ Dividendos (CSV)</button>' : ''}
      </div>
      ${sum.lines.length ? `<h4 class="tsec">Vendas</h4>${groupedList(sum.lines, lineRow)}` : ''}
      ${dv.count ? `<h4 class="tsec">Dividendos</h4>${groupedList(dv.lines, divRow)}` : ''}
    </div>`, { wide: true });

  segmented($('#tYear'), 'y', y => draw(y, years));
  const csv = $('#tCsv'), divCsv = $('#tDivCsv');
  if (csv) csv.onclick = async () => {
    if (await saveFile(taxCSV(sum.lines), `aurora-irs-vendas-${year}.csv`, 'text/csv')) toast('CSV exportado');
  };
  if (divCsv) divCsv.onclick = async () => {
    if (await saveFile(dividendCSV(dv.lines), `aurora-irs-dividendos-${year}.csv`, 'text/csv')) toast('CSV exportado');
  };
}
