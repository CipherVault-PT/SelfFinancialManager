import { state, exportJSON, hasData } from './store.js';
import { todayISO } from './format.js';
import { saveFile } from './ui/dom.js';

const DAY = 86_400_000;
export const BACKUP_EVERY_DAYS = 30;
const FIRST_REMINDER_DAYS = 3;
const SNOOZE_DAYS = 7;

/** Dias desde o último backup (null se nunca foi feito). */
export const daysSinceBackup = (now = Date.now()) =>
  state.settings.lastBackup ? Math.floor((now - state.settings.lastBackup) / DAY) : null;

/** Mostra o lembrete: nunca houve backup (após 3 dias de uso) ou o último tem mais de 30 dias. */
export function backupDue(now = Date.now()) {
  const s = state.settings;
  if (!hasData() || now < (s.backupSnoozeUntil || 0)) return false;
  if (s.lastBackup) return now - s.lastBackup > BACKUP_EVERY_DAYS * DAY;
  return now - (s.createdAt || now) > FIRST_REMINDER_DAYS * DAY;
}

export function snoozeBackup(now = Date.now()) {
  state.settings.backupSnoozeUntil = now + SNOOZE_DAYS * DAY;
}

/** Guarda o backup (folha de partilha no telemóvel ou descarga). Devolve false se o utilizador cancelar. */
export async function saveBackup() {
  if (!(await saveFile(exportJSON(), `aurora-backup-${todayISO()}.json`, 'application/json'))) return false;
  state.settings.lastBackup = Date.now();
  state.settings.backupSnoozeUntil = 0;
  return true;
}

/** Pede ao browser para não apagar os dados automaticamente (ex: falta de espaço). */
export async function requestPersistence() {
  try {
    if (!navigator.storage?.persist) return null;
    return (await navigator.storage.persisted()) || (await navigator.storage.persist());
  } catch {
    return null;
  }
}

export async function isPersisted() {
  try {
    return navigator.storage?.persisted ? await navigator.storage.persisted() : null;
  } catch {
    return null;
  }
}
