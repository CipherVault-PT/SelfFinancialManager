import { $, toast } from './ui/dom.js';

const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

/** Botão "Instalar app" + service worker (abre offline com os últimos dados). */
export function initPWA() {
  const btn = $('#btnInstall');
  let deferred = null;

  addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferred = e;
    if (!isStandalone()) btn.hidden = false;
  });
  addEventListener('appinstalled', () => {
    deferred = null;
    btn.hidden = true;
    toast('App instalada! 📲');
  });
  // iOS não tem beforeinstallprompt: mostra o botão com instruções.
  if (!isStandalone() && /iphone|ipad|ipod/i.test(navigator.userAgent)) btn.hidden = false;

  btn.onclick = async () => {
    if (deferred) {
      deferred.prompt();
      try { await deferred.userChoice; } catch { /* ignorado */ }
      deferred = null;
      btn.hidden = true;
      return;
    }
    toast('No iPhone (Safari): Partilhar → “Adicionar ao ecrã principal”. No Chrome: menu ⋮ → “Instalar aplicação”.');
  };

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('./sw.js').catch(() => { /* sem modo offline */ });
  }
}
