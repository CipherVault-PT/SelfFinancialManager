import { lotCalc, feeFor } from '../calc.js';
import { state } from '../store.js';
import { num, sym } from '../format.js';
import { $, $$, segmented } from './dom.js';

const field = (id, label, placeholder = '0,00') =>
  `<div class="field"><label for="${id}">${label}</label><input class="inp mono" id="${id}" inputmode="decimal" autocomplete="off" placeholder="${placeholder}"></div>`;

const fmtFee = () => String(state.settings.fxFeePct || 0).replace('.', ',');

/**
 * Campos de uma nova compra, partilhados por "Nova posição" e "Reforçar".
 * ctx: { kind, moneyCur(), quoteCur(), platform(), onChange() }
 */
export function lotForm(root, ctx) {
  const s = { mode: 'amount', priceCur: null, adjust: 'auto' };
  const val = id => num($(`#${id}`, root)?.value);

  function keepValues(fn) {
    const saved = Object.fromEntries($$('input', root).map(i => [i.id, i.value]));
    fn();
    for (const [id, v] of Object.entries(saved)) { const el = $(`#${id}`, root); if (el) el.value = v; }
  }

  function render() {
    keepValues(() => {
      const moneyCur = ctx.moneyCur(), csym = sym(moneyCur);
      if (ctx.kind() === 'stock') {
        const opts = [...new Set([ctx.quoteCur(), moneyCur])];
        if (!opts.includes(s.priceCur)) s.priceCur = opts[0];
        root.innerHTML = `<div class="row2">
            ${field('lfShares', 'Nº de ações', '0')}
            <div class="field"><label for="lfPQ">Preço/ação</label><div class="pqrow">
              <input class="inp mono" id="lfPQ" inputmode="decimal" autocomplete="off" placeholder="0,00">
              ${opts.length > 1
                ? `<div class="mseg pqseg" id="lfPQC">${opts.map(c => `<button type="button" data-pc="${c}" class="${s.priceCur === c ? 'on' : ''}">${sym(c)}</button>`).join('')}</div>`
                : `<span class="pqfix">${sym(s.priceCur)}</span>`}
            </div></div>
          </div>
          <div id="lfAdj"></div>`;
        segmented($('#lfPQC', root), 'pc', c => { s.priceCur = c; renderAdj(); ctx.onChange(); });
        renderAdj();
      } else {
        const byCost = s.mode === 'cost';
        root.innerHTML = `<div class="mseg" id="lfMode" style="margin-bottom:12px">
            <button type="button" data-md="amount" class="${byCost ? '' : 'on'}">Preço + Montante</button>
            <button type="button" data-md="cost" class="${byCost ? 'on' : ''}">Nº unid. + Custo</button></div>
          <div class="row2">${byCost
            ? field('lfShares', 'Nº de unidades', '0') + field('lfCost', `Custo total (${csym})`)
            : field('lfEntry', `Preço de entrada (${csym})`) + field('lfAmt', `Montante (${csym})`)}</div>`;
        segmented($('#lfMode', root), 'md', m => { s.mode = m; render(); ctx.onChange(); });
      }
    });
  }

  function renderAdj() {
    const a = $('#lfAdj', root);
    if (!a) return;
    const moneyCur = ctx.moneyCur(), cross = s.priceCur !== moneyCur, plat = ctx.platform();
    if (!cross && s.adjust === 'rate') s.adjust = 'auto';
    const csym = sym(moneyCur), qsym = sym(s.priceCur), fee = feeFor(plat);
    const t = s.adjust;
    keepValues(() => {
      a.innerHTML = `<div class="mseg" id="lfAdjMode" style="margin:2px 0 12px">
          <button type="button" data-aj="auto" class="${t === 'auto' ? 'on' : ''}">Automático</button>
          <button type="button" data-aj="cost" class="${t === 'cost' ? 'on' : ''}">Custo exato</button>
          ${cross ? `<button type="button" data-aj="rate" class="${t === 'rate' ? 'on' : ''}">Câmbio</button>` : ''}</div>
        ${t === 'cost'
          ? `${field('lfCost', `Custo pago (${csym})`)}<div class="curhint">O <b>valor total debitado</b> pela corretora (ex: “Valor de abertura” na XTB). Fica exato.</div>`
          : t === 'rate'
            ? `<div class="field"><label for="lfRate">Câmbio na compra <span class="sublbl">1 ${qsym} = ? ${csym}</span></label><input class="inp mono" id="lfRate" inputmode="decimal" autocomplete="off" placeholder="ex: 0,8728"></div><div class="curhint">A <b>taxa de câmbio de abertura</b> da corretora. Custo = ações × preço × câmbio.</div>`
            : `<div class="curhint">${cross
                ? (fee > 0
                  ? `Câmbio de hoje + <b style="color:var(--down)">${fmtFee()}% de taxa</b> da ${plat} (aproximado). Para exato, usa <b>Custo exato</b> ou <b>Câmbio</b>.`
                  : `Câmbio de hoje — a ${plat} não cobra taxa de conversão (aproximado).`)
                : 'Custo = ações × preço.'}</div>`}`;
    });
    segmented($('#lfAdjMode', a), 'aj', v => { s.adjust = v; renderAdj(); ctx.onChange(); });
  }

  function read() {
    const moneyCur = ctx.moneyCur();
    if (ctx.kind() === 'stock') {
      return lotCalc({
        mode: 'stock', moneyCur, priceCur: s.priceCur, fee: feeFor(ctx.platform()),
        shares: val('lfShares'), priceQ: val('lfPQ'),
        cost: s.adjust === 'cost' ? val('lfCost') : undefined,
        rate: s.adjust === 'rate' ? val('lfRate') : undefined,
      });
    }
    return lotCalc({
      mode: s.mode === 'cost' ? 'cost' : 'amount', moneyCur,
      shares: val('lfShares'), cost: val('lfCost'), price: val('lfEntry'), amount: val('lfAmt'),
    });
  }

  /** Preenche o preço com a cotação atual (na moeda indicada). */
  function prefillPrice(value, cur) {
    if (!(value > 0)) return;
    const el = $('#lfPQ', root) || $('#lfEntry', root);
    if (!el || el.value) return;
    if (ctx.kind() === 'stock') {
      if (![ctx.quoteCur(), ctx.moneyCur()].includes(cur)) return;
      if (cur !== s.priceCur) { s.priceCur = cur; render(); }
    } else if (cur !== ctx.moneyCur()) return;
    const target = $('#lfPQ', root) || $('#lfEntry', root);
    target.value = String(+value.toPrecision(8)).replace('.', ',');
    ctx.onChange();
  }

  root.addEventListener('input', () => ctx.onChange());
  render();
  return { read, render, renderAdj, prefillPrice, state: s };
}
