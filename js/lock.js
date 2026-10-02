import { STORAGE_KEY } from './config.js';

/**
 * Bloqueio da app com PIN e, opcionalmente, impressão digital/Face ID (WebAuthn).
 * Protege contra quem pegue no dispositivo desbloqueado; não cifra os dados.
 * Fica fora do estado da app: não vai nos backups e sobrevive a "Apagar tudo".
 */
export const LOCK_KEY = `${STORAGE_KEY}_lock`;
const ITERATIONS = 150_000;
const MAX_FAILS = 5;
export const AFTER_OPTS = [[0, 'Logo'], [1, '1 min'], [5, '5 min'], [15, '15 min']];

function read() {
  try {
    const c = JSON.parse(localStorage.getItem(LOCK_KEY));
    return c && typeof c.hash === 'string' && typeof c.salt === 'string' ? c : null;
  } catch { return null; }
}

function write(c) {
  try {
    if (c) localStorage.setItem(LOCK_KEY, JSON.stringify(c));
    else localStorage.removeItem(LOCK_KEY);
  } catch { /* armazenamento indisponível */ }
}

export const lockConfig = () => read();
export const lockEnabled = () => !!read();
export const validPin = pin => /^\d{4,8}$/.test(String(pin));

const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = s => Uint8Array.from(atob(s), ch => ch.charCodeAt(0));
const random = n => crypto.getRandomValues(new Uint8Array(n));

async function derive(pin, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  return b64(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256));
}

/** Cria ou muda o PIN (guarda só o hash PBKDF2 com sal aleatório). */
export async function setPin(pin) {
  if (!validPin(pin)) throw new Error('O PIN tem de ter 4 a 8 algarismos');
  const prev = read(), salt = random(16);
  write({
    v: 1, len: String(pin).length, salt: b64(salt), iter: ITERATIONS, hash: await derive(String(pin), salt, ITERATIONS),
    after: prev?.after ?? 1, cred: prev?.cred ?? null, fails: 0, until: 0,
  });
}

/** Milissegundos que faltam para poder tentar outra vez (depois de 5 erros seguidos). */
export const waitMs = (now = Date.now()) => Math.max(0, (read()?.until || 0) - now);

export async function checkPin(pin) {
  const c = read();
  if (!c) return true;
  if (waitMs() > 0) return false;
  const ok = (await derive(String(pin), unb64(c.salt), c.iter)) === c.hash;
  const cur = read() ?? c;
  if (ok) { cur.fails = 0; cur.until = 0; } else {
    cur.fails = (cur.fails || 0) + 1;
    if (cur.fails % MAX_FAILS === 0) cur.until = Date.now() + 30_000 * 2 ** (cur.fails / MAX_FAILS - 1);
  }
  write(cur);
  return ok;
}

export const failsLeft = () => MAX_FAILS - ((read()?.fails || 0) % MAX_FAILS);

export function disableLock() { write(null); }

export function setAfter(min) {
  const c = read();
  if (c) { c.after = Math.max(0, +min || 0); write(c); }
}

/* ---------- impressão digital / Face ID ---------- */

export async function bioAvailable() {
  try {
    return !!globalThis.PublicKeyCredential && window.isSecureContext
      && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch { return false; }
}

export async function enrollBio() {
  const c = read();
  if (!c) throw new Error('Ativa primeiro o PIN');
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge: random(32),
      rp: { name: 'Aurora Investments' },
      user: { id: random(16), name: 'aurora', displayName: 'Aurora' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
      timeout: 60_000,
    },
  });
  c.cred = b64(cred.rawId);
  write(c);
}

export async function checkBio() {
  const c = read();
  if (!c?.cred) return false;
  try {
    await navigator.credentials.get({
      publicKey: {
        challenge: random(32), timeout: 60_000, userVerification: 'required',
        allowCredentials: [{ type: 'public-key', id: unb64(c.cred), transports: ['internal'] }],
      },
    });
    const cur = read();
    if (cur) { cur.fails = 0; cur.until = 0; write(cur); }
    return true;
  } catch { return false; }
}

export function removeBio() {
  const c = read();
  if (c) { c.cred = null; write(c); }
}

/** "Esqueci-me do PIN": apaga os dados deste dispositivo (incluindo a cópia para desfazer) e o bloqueio. */
export function forgetEverything() {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith(STORAGE_KEY)) localStorage.removeItem(k);
  } catch { /* armazenamento indisponível */ }
}
