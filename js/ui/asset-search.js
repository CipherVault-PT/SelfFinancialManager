import { searchLocal } from '../stocks.js';
import { searchCoins } from '../quotes/crypto.js';
import { searchYahoo } from '../quotes/stocks.js';
import { esc } from '../format.js';
import { debounce } from './dom.js';

const enterClicks = e => { if (e.key === 'Enter') e.target.closest('.res')?.click(); };

/** Pesquisa de criptomoedas na CoinGecko: liga um campo de texto a uma lista de resultados. */
export function coinSearch(input, box, onPick) {
  let coins = [], token = 0;
  const run = debounce(async q => {
    const my = ++token;
    try {
      coins = await searchCoins(q);
      if (my !== token) return;
      box.innerHTML = coins.length
        ? coins.map((c, i) => `<div class="res" data-i="${i}" role="button" tabindex="0">
            <img src="${esc(c.thumb)}" alt="" loading="lazy">
            <div><div class="rn">${esc(c.name)}</div><div class="rs">${esc(c.symbol)}</div></div>
            ${c.rank ? `<div class="rr">#${esc(c.rank)}</div>` : ''}</div>`).join('')
        : '<div class="searching">Nada encontrado</div>';
    } catch (e) {
      if (my === token) box.innerHTML = `<div class="searching">${esc(e.message)}</div>`;
    }
  }, 300);
  input.oninput = e => {
    const q = e.target.value.trim();
    if (q.length < 2) { token++; box.innerHTML = ''; return; }
    box.innerHTML = '<div class="searching">A procurar…</div>';
    run(q);
  };
  box.onclick = e => {
    const r = e.target.closest('.res');
    if (r) onPick(coins[+r.dataset.i]);
  };
  box.onkeydown = enterClicks;
}

/** Pesquisa de ações/ETFs: base local primeiro e, a partir de 2 letras, também no Yahoo. */
export function stockSearch(input, box, onPick, emptyText = 'Sem resultados') {
  let local = [], online = [], shown = [], token = 0;
  const row = (s, i) => `<div class="res" data-i="${i}" role="button" tabindex="0">
      <div class="tkn" style="width:26px;height:26px;font-size:9.5px">${esc(s.t.slice(0, 4))}</div>
      <div style="min-width:0"><div class="rn">${esc(s.n)}</div><div class="rs">${esc(s.y)}${s.x ? ` · ${esc(s.x)}` : ''}</div></div>
      <div class="rr">${esc(s.c || '')}</div></div>`;
  const draw = (pending = false) => {
    const seen = new Set(local.map(s => s.y));
    const extra = online.filter(s => !seen.has(s.y));
    shown = [...local, ...extra];
    box.innerHTML = (local.map(row).join('')
      + (extra.length ? `<div class="res-sep">Mais resultados (Yahoo)</div>${extra.map((s, i) => row(s, local.length + i)).join('')}` : '')
      + (pending ? '<div class="searching">A procurar mais…</div>' : ''))
      || `<div class="searching">${emptyText}</div>`;
  };
  const runOnline = debounce(async q => {
    const my = ++token;
    const res = await searchYahoo(q).catch(() => []);
    if (my !== token) return;
    online = res;
    draw();
  }, 450);
  input.oninput = e => {
    const q = e.target.value.trim();
    local = searchLocal(q);
    online = [];
    token++;
    if (q.length >= 2) { draw(true); runOnline(q); } else draw();
    if (!q) box.innerHTML = '';
  };
  box.onclick = e => {
    const r = e.target.closest('.res');
    if (r) onPick({ ...shown[+r.dataset.i] });
  };
  box.onkeydown = enterClicks;
}
