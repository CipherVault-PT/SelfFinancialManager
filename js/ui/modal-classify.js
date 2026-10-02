import { state, commit } from '../store.js';
import { autoClass, classify, UNKNOWN } from '../allocation.js';
import { SECTORS, COUNTRIES } from '../data/classification.js';
import { esc } from '../format.js';
import { $$, openModal, modalEl, toast } from './dom.js';

const options = (list, auto, chosen) =>
  `<option value="">Automático${auto === UNKNOWN ? ' (sem dados)' : ` (${esc(auto)})`}</option>`
  + list.map(v => `<option${v === chosen ? ' selected' : ''}>${esc(v)}</option>`).join('');

/** Corrigir ou completar o setor e o país das ações/ETFs. */
export function modalClassify() {
  const stocks = state.positions
    .filter(p => p.kind === 'stock')
    .sort((a, b) => Object.values(classify(b)).includes(UNKNOWN) - Object.values(classify(a)).includes(UNKNOWN));
  openModal(`<div class="mh"><h3>Setor e país</h3><button type="button" class="x" data-action="modal-close" aria-label="Fechar">✕</button></div>
    <p class="mlead">A app classifica sozinha as ações da base. Aqui completas as que ficaram <b>sem dados</b> (ex: escritas à mão) ou corriges o que quiseres. Para ETFs globais usa “ETF (diversificado)” e “Global”.</p>
    ${stocks.length ? `<div class="clist">${stocks.map(p => {
      const a = autoClass(p);
      return `<div class="crow">
        <div class="crow-n"><b>${esc(p.name)}</b> <span class="chip">${esc(p.platform)}</span></div>
        <div class="row2">
          <select class="inp" data-cls="sector" data-id="${esc(p.id)}" aria-label="Setor de ${esc(p.name)}">${options(SECTORS, a.sector, p.sector)}</select>
          <select class="inp" data-cls="country" data-id="${esc(p.id)}" aria-label="País de ${esc(p.name)}">${options(COUNTRIES, a.country, p.country)}</select>
        </div></div>`;
    }).join('')}</div>` : '<p class="mlead">Ainda não tens ações nem ETFs.</p>'}`);

  for (const sel of $$('select[data-cls]', modalEl())) {
    sel.onchange = () => {
      const p = state.positions.find(x => x.id === sel.dataset.id);
      if (!p) return;
      if (sel.value) p[sel.dataset.cls] = sel.value;
      else delete p[sel.dataset.cls];
      commit();
      toast('Classificação guardada');
    };
  }
}
