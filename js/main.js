import { REFRESH, STORAGE_KEY } from './config.js';
import { state, load, save, subscribe, commit, hasData } from './store.js';
import { saveBackup, snoozeBackup, requestPersistence } from './backup.js';
import { refresh, onAlerts, net } from './quotes/index.js';
import { renderAll, renderStatus, renderView, ui } from './ui/render.js';
import { $, $$, toast, closeModal, modalOpen } from './ui/dom.js';
import { applyAccent } from './ui/theme.js';
import { initBackground } from './ui/background.js';
import { modalAdd, modalReinforce, modalClose, modalStockPrice, deletePosition, undoSale } from './ui/modal-position.js';
import { modalAlert, notifyAlerts } from './ui/modal-alert.js';
import { modalCash } from './ui/modal-cash.js';
import { modalSettings, configureSettings } from './ui/modal-settings.js';
import { modalTax } from './ui/modal-tax.js';
import { modalDividend } from './ui/modal-dividend.js';
import { removeDividend } from './dividends.js';
import { initPWA } from './pwa.js';

load();
state.settings.accent = applyAccent(state.settings.accent);
save();

const background = initBackground($('#aurC'), () => state.settings.bgStyle);

subscribe(renderAll);
onAlerts(notifyAlerts);
renderAll();

/* ---------- navegação e ações ---------- */

function switchTab(tab) {
  ui.tab = tab;
  for (const b of $$('.tabs button')) {
    b.classList.toggle('on', b.dataset.tab === tab);
    b.setAttribute('aria-selected', String(b.dataset.tab === tab));
  }
  renderView();
  const v = $('#view');
  v.classList.remove('tabfx');
  void v.offsetWidth;
  v.classList.add('tabfx');
}

async function manualRefresh() {
  const job = refresh({ force: true });
  renderStatus();
  await job;
  const misses = net.stocks?.fail || 0;
  if (net.crypto === false && !state.positions.some(p => p.kind === 'stock')) toast('Sem ligação às cotações de cripto', true);
  else if (misses) toast(`${misses} ${misses === 1 ? 'ação ficou' : 'ações ficaram'} sem cotação — vê o atalho nas Definições`, true);
  else toast('Cotações atualizadas');
}

const ACTIONS = {
  add: modalAdd,
  cash: modalCash,
  settings: modalSettings,
  refresh: manualRefresh,
  'modal-close': closeModal,
  'go-positions': () => switchTab('posicoes'),
  reinforce: modalReinforce,
  close: modalClose,
  alert: modalAlert,
  price: modalStockPrice,
  delete: deletePosition,
  'undo-sale': undoSale,
  tax: modalTax,
  dividend: modalDividend,
  'dividend-del': id => {
    if (!confirm('Apagar este dividendo?')) return;
    removeDividend(id);
    commit();
    toast('Dividendo apagado');
  },
  'toggle-lots': id => {
    if (!ui.expanded.delete(id)) ui.expanded.add(id);
    renderView();
  },
  'chart-range': (_, el) => { ui.chartDays = +el.dataset.days; renderView(); },
  'backup-now': async () => {
    if (!(await saveBackup())) return;
    commit();
    toast('Backup guardado');
  },
  'backup-later': () => {
    snoozeBackup();
    commit();
    toast('Lembro-te daqui a 7 dias');
  },
};

document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  ACTIONS[el.dataset.action]?.(el.dataset.id, el);
});

for (const b of $$('.tabs button')) b.addEventListener('click', () => switchTab(b.dataset.tab));

$('#curSeg').addEventListener('click', e => {
  const b = e.target.closest('button[data-cur]');
  if (!b) return;
  state.settings.displayCurrency = b.dataset.cur;
  commit();
});

// Outra aba alterou os dados: recarrega em vez de os sobrescrever.
addEventListener('storage', e => {
  if (e.key !== STORAGE_KEY || !e.newValue) return;
  load();
  if (modalOpen()) closeModal();
  renderAll();
});

$('#ov').addEventListener('click', e => { if (e.target.id === 'ov') closeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && modalOpen()) closeModal(); });

/* ---------- atualizações automáticas ---------- */

let cryptoTimer, stockTimer, lastAuto = Date.now();

function schedule() {
  clearInterval(cryptoTimer);
  clearInterval(stockTimer);
  cryptoTimer = setInterval(() => {
    if (document.hidden) return;
    lastAuto = Date.now();
    refresh({ stocks: false });
  }, REFRESH.cryptoMs);
  const m = state.settings.refreshMin;
  if (m > 0) {
    stockTimer = setInterval(() => {
      if (!document.hidden) refresh({ crypto: false });
    }, m * 60_000);
  }
}

configureSettings({ onBackground: () => background.restart(), onSchedule: schedule });

document.addEventListener('visibilitychange', () => {
  if (document.hidden || Date.now() - lastAuto < REFRESH.cryptoMs) return;
  lastAuto = Date.now();
  refresh();
});

setInterval(renderStatus, 30_000);
schedule();
refresh();
initPWA();
if (hasData()) requestPersistence();
