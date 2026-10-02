import { commit } from '../store.js';
import { dividendsFor, dividendAssets, addDividend, removeDividend, netOf, HIGH_WITHHOLDING } from '../dividends.js';
import { esc, money, num, sym, todayISO, pct } from '../format.js';
import { $, $$, toast, openModal, segmented, modalEl } from './dom.js';

const header = `<div class="mh"><h3>Dividendos</h3><button type="button" class="x" data-action="modal-close" aria-label="Fechar">✕</button></div>`;

/** Registar dividendos de uma posição (aberta ou já vendida). Sem posId mostra a lista de ativos. */
export function modalDividend(posId) {
  const assets = dividendAssets();
  if (!assets.length) {
    openModal(`${header}<p class="mlead">Ainda não tens ações ou ETFs. Os dividendos registam-se por ativo — adiciona primeiro a posição.</p>`);
    return;
  }
  let asset = assets.find(a => a.id === posId) ?? null;
  let cur = asset?.currency ?? 'EUR';

  const curOptions = () => (asset ? [...new Set([asset.currency, asset.quoteCur].filter(Boolean))] : ['EUR']);

  function draw() {
    const list = asset ? dividendsFor(asset.id).sort((a, b) => b.date.localeCompare(a.date)) : [];
    if (!curOptions().includes(cur)) cur = curOptions()[0];
    openModal(`${header}
      ${posId && asset
        ? `<div class="picked" style="margin-bottom:14px;background:var(--surface-2);border-color:var(--line-2)"><div class="tkn">${esc((asset.symbol || asset.name).slice(0, 3))}</div>
            <div><div class="rn">${esc(asset.name)}</div><div class="rs">${esc(asset.platform)}${asset.open ? '' : ' · já vendida'}</div></div></div>`
        : `<div class="field"><label for="vAsset">Ativo</label><select class="inp" id="vAsset">
            <option value="">Escolhe…</option>
            ${assets.map(a => `<option value="${esc(a.id)}"${a.id === asset?.id ? ' selected' : ''}>${esc(a.name)} · ${esc(a.platform)}${a.open ? '' : ' (vendida)'}</option>`).join('')}
          </select></div>`}
      ${list.length ? `<div class="mlabel">Recebidos</div><div class="divlist">${list.map(d => `
        <div class="lot"><span>${esc(d.date)} · bruto ${money(d.gross, d.currency)}${d.withheld ? ` · retido ${money(d.withheld, d.currency)}` : ''}</span>
          <span class="lc">${money(netOf(d), d.currency)} <button type="button" class="x mini" data-delv="${esc(d.id)}" aria-label="Apagar dividendo">✕</button></span></div>`).join('')}</div><div class="sep"></div>` : ''}
      <div class="mlabel">Novo dividendo</div>
      <div class="row2">
        <div class="field"><label for="vDate">Data de pagamento</label><input class="inp" id="vDate" type="date" max="${todayISO()}" value="${todayISO()}"></div>
        <div class="field"><label>Moeda</label>${curOptions().length > 1
          ? `<div class="mseg" id="vCur">${curOptions().map(c => `<button type="button" data-c="${c}" class="${c === cur ? 'on' : ''}">${esc(sym(c))}</button>`).join('')}</div>`
          : `<div class="pqfix" style="height:46px">${esc(sym(cur))} ${esc(cur)}</div>`}</div>
      </div>
      <div class="row2">
        <div class="field"><label for="vGross">Valor bruto</label><input class="inp mono" id="vGross" inputmode="decimal" autocomplete="off" placeholder="0,00" data-autofocus></div>
        <div class="field"><label for="vTax">Imposto retido <span class="sublbl">opcional</span></label><input class="inp mono" id="vTax" inputmode="decimal" autocomplete="off" placeholder="0,00"></div>
      </div>
      <div class="curhint" id="vHint">O extrato da corretora mostra o <b>valor bruto</b> e o <b>imposto retido na fonte</b> (ex: 15% nos EUA com o W-8BEN).</div>
      <button type="button" class="btn pri wide" id="vDo" style="margin-top:14px">Registar dividendo</button>`);

    const sel = $('#vAsset');
    if (sel) sel.onchange = () => { asset = assets.find(a => a.id === sel.value) ?? null; cur = asset?.currency ?? 'EUR'; draw(); };
    segmented($('#vCur'), 'c', c => { cur = c; hint(); });
    for (const b of $$('[data-delv]', modalEl())) {
      b.onclick = () => {
        if (!confirm('Apagar este dividendo?')) return;
        removeDividend(b.dataset.delv);
        commit();
        draw();
      };
    }
    const hint = () => {
      const g = num($('#vGross').value), t = num($('#vTax').value) || 0;
      if (!(g > 0)) return;
      const rate = t / g;
      $('#vHint').innerHTML = `Líquido: <b>${money(g - t, cur)}</b>${t > 0 ? ` · retenção de ${pct(rate * 100).replace('+', '')}` : ''}${rate > HIGH_WITHHOLDING + 1e-6
        ? `<br><span style="color:var(--down)">Retenção acima de ${HIGH_WITHHOLDING * 100}%: o excedente normalmente não é dedutível no IRS. Nas ações dos EUA, preenche o formulário W-8BEN na corretora.</span>` : ''}`;
    };
    $('#vGross').oninput = hint;
    $('#vTax').oninput = hint;

    $('#vDo').onclick = () => {
      if (!asset) return toast('Escolhe o ativo', true);
      const gross = num($('#vGross').value), withheld = num($('#vTax').value) || 0;
      const date = $('#vDate').value;
      if (!(gross > 0)) return toast('Indica o valor bruto', true);
      if (withheld < 0 || withheld >= gross) return toast('O imposto retido tem de ser menor que o valor bruto', true);
      if (!date) return toast('Indica a data', true);
      addDividend(asset, { date, gross, withheld, currency: cur });
      commit();
      toast(`Dividendo de ${money(gross - withheld, cur)} registado`);
      draw();
    };
  }

  draw();
}
