import { ACCENTS } from '../config.js';

export function applyAccent(id) {
  const c = ACCENTS.find(x => x.id === id) ?? ACCENTS[0];
  const r = document.documentElement.style;
  r.setProperty('--brass', c.a);
  r.setProperty('--brass-2', c.a2);
  r.setProperty('--accent-rgb', c.rgb);
  return c.id;
}
