/**
 * Cifra da sincronização: a frase-passe gera (PBKDF2-SHA256) uma chave AES-256-GCM e, à parte,
 * a chave de acesso ao Worker. Os dados são comprimidos (gzip) e cifrados antes de sair do dispositivo.
 */
export const ITERATIONS = 310_000;

const enc = new TextEncoder(), dec = new TextDecoder();

export function b64(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export const unb64 = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
const b64url = buf => b64(buf).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export const randomSalt = () => b64(crypto.getRandomValues(new Uint8Array(16)));

/** { key: chave AES (base64), auth: chave de acesso ao Worker (base64url) } */
export async function deriveKeys(passphrase, salt, iterations = ITERATIONS) {
  const base = await crypto.subtle.importKey('raw', enc.encode(String(passphrase).normalize('NFC')), 'PBKDF2', false, ['deriveBits']);
  const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: unb64(salt), iterations }, base, 512));
  return { key: b64(bits.slice(0, 32)), auth: b64url(bits.slice(32)) };
}

const aes = key => crypto.subtle.importKey('raw', unb64(key), 'AES-GCM', false, ['encrypt', 'decrypt']);
const canZip = () => typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';

async function pipe(bytes, stream) {
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
}

/** Comprime e cifra um texto: { iv, ct } em base64. O 1.º byte indica se vai comprimido. */
export async function seal(text, key) {
  const raw = enc.encode(text);
  const body = canZip() ? await pipe(raw, new CompressionStream('gzip')) : raw;
  const plain = new Uint8Array(body.length + 1);
  plain[0] = canZip() ? 1 : 0;
  plain.set(body, 1);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aes(key), plain);
  return { iv: b64(iv), ct: b64(ct) };
}

/** Decifra { iv, ct }; lança erro se a chave estiver errada ou os dados tiverem sido alterados. */
export async function open({ iv, ct }, key) {
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, await aes(key), unb64(ct)));
  const body = plain.subarray(1);
  return dec.decode(plain[0] === 1 ? await pipe(body, new DecompressionStream('gzip')) : body);
}

export async function sha256(text) {
  return b64(await crypto.subtle.digest('SHA-256', enc.encode(text)));
}
