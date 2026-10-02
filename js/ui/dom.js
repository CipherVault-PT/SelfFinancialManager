export const $ = (s, root = document) => root.querySelector(s);
export const $$ = (s, root = document) => [...root.querySelectorAll(s)];

let toastTimer;
export function toast(msg, isError = false) {
  const t = $('#toast');
  $('#toastTxt').textContent = msg;
  t.classList.toggle('err', isError);
  t.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('on'), msg.length > 70 ? 6000 : 2800);
}

const ov = () => $('#ov');
export const modalEl = () => $('#modal');
export const modalOpen = () => ov().classList.contains('on');

let lastFocus = null;
export function openModal(html) {
  if (!modalOpen()) lastFocus = document.activeElement;
  modalEl().innerHTML = html;
  ov().classList.add('on');
  ov().setAttribute('aria-hidden', 'false');
  if (matchMedia('(pointer: fine)').matches) {
    requestAnimationFrame(() => $('[data-autofocus]', modalEl())?.focus({ preventScroll: true }));
  }
}

export function closeModal() {
  ov().classList.remove('on');
  ov().setAttribute('aria-hidden', 'true');
  lastFocus?.focus?.({ preventScroll: true });
}

/** Ativa os botões de um grupo segmentado e devolve o valor escolhido via callback. */
export function segmented(el, attr, onPick) {
  if (!el) return;
  el.addEventListener('click', e => {
    const b = e.target.closest(`button[data-${attr}]`);
    if (!b) return;
    for (const x of el.children) x.classList.toggle('on', x === b);
    onPick(b.dataset[attr]);
  });
}

export const debounce = (fn, ms) => {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
};
