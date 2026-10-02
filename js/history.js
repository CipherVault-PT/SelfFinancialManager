import { state } from './store.js';
import { agg } from './calc.js';
import { todayISO } from './format.js';

const MAX_POINTS = 400;

/** Regista o património do dia, sempre em EUR (um ponto por dia). */
export function recordHistory() {
  const { netWorth } = agg('EUR');
  if (!(netWorth > 0)) return;
  const d = todayISO();
  const last = state.history.at(-1);
  if (last?.d === d) last.v = netWorth;
  else state.history.push({ d, v: netWorth });
  if (state.history.length > MAX_POINTS) state.history = state.history.slice(-MAX_POINTS);
}
