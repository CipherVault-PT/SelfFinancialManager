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
export function openModal(html, { wide = false } = {}) {
  if (!modalOpen()) lastFocus = document.activeElement;
  modalEl().innerHTML = html;
  modalEl().classList.toggle('wide', wide);
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

function download(text, name, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Guarda um ficheiro: no telemóvel abre a folha de partilha (Drive, email, Ficheiros…) quando o
 * browser o permite; senão descarrega-o. Devolve false se o utilizador cancelar.
 */
export async function saveFile(text, name, type) {
  const file = new File([text], name, { type });
  if (matchMedia('(pointer: coarse)').matches && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      return true;
    } catch (e) {
      if (e?.name === 'AbortError') return false;
    }
  }
  download(text, name, type);
  return true;
}

export const debounce = (fn, ms) => {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
};
