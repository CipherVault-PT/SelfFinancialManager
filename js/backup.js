import { state, exportJSON, hasData } from './store.js';
import { todayISO } from './format.js';
import { saveFile } from './ui/dom.js';
import { deriveKeys, seal, open, randomSalt, ITERATIONS } from './sync/crypto.js';

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

const SEALED = 'aurora-backup';
export const MIN_BACKUP_PASS = 8;

/**
 * Cifra um backup (AES-256-GCM, chave PBKDF2): com uma palavra-passe nova ou com a chave da
 * sincronização ({ key, salt, iter }), que abre com a mesma frase-passe. Sem nenhuma, fica em claro.
 */
export async function sealBackup(text, { password, keyring } = {}) {
  let k = keyring;
  if (password != null) {
    const salt = randomSalt();
    k = { salt, iter: ITERATIONS, key: (await deriveKeys(password, salt)).key };
  }
  if (!k) return text;
  return JSON.stringify({ format: SEALED, v: 1, kdf: 'PBKDF2-SHA256', salt: k.salt, iter: k.iter, sync: password == null, ...(await seal(text, k.key)) });
}

/** Cabeçalho de um backup cifrado, ou null se o ficheiro estiver em claro. */
export function sealedInfo(text) {
  try {
    const d = JSON.parse(text);
    return d?.format === SEALED && typeof d.ct === 'string' ? d : null;
  } catch {
    return null;
  }
}

/** Devolve o JSON do backup; null se precisar de palavra-passe. Lança erro se estiver errada. */
export async function openBackup(text, { password, keyring } = {}) {
  const d = sealedInfo(text);
  if (!d) return text;
  if (!(d.iter >= 100_000 && d.iter <= 5_000_000) || typeof d.salt !== 'string') throw new Error('Ficheiro inválido');
  let key = null;
  if (password != null) key = (await deriveKeys(password, d.salt, d.iter)).key;
  else if (keyring?.key && keyring.salt === d.salt && keyring.iter === d.iter) key = keyring.key;
  if (!key) return null;
  try {
    return await open(d, key);
  } catch {
    throw new Error('Palavra-passe errada');
  }
}

/** Guarda o backup (folha de partilha no telemóvel ou descarga). Devolve false se o utilizador cancelar. */
export async function saveBackup(opts = {}) {
  const sealed = opts.password != null || !!opts.keyring;
  const text = await sealBackup(exportJSON(), opts);
  if (!(await saveFile(text, `aurora-backup-${todayISO()}${sealed ? '-cifrado' : ''}.json`, 'application/json'))) return false;
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
