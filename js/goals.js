/**
 * Metas: quanto tempo falta para chegar a um valor, juntando um montante por mês
 * a uma rentabilidade anual estimada (juros compostos, mês a mês).
 */
export const DEFAULT_RATE = 7;
const MAX_MONTHS = 70 * 12;

/** Meses até `target` (0 se já lá está, null se não chega em 70 anos). */
export function monthsToGoal({ now, monthly = 0, rate = DEFAULT_RATE, target }) {
  if (!(target > 0)) return null;
  if (now >= target) return 0;
  const i = (1 + rate / 100) ** (1 / 12) - 1;
  let v = Math.max(0, now);
  for (let m = 1; m <= MAX_MONTHS; m++) {
    v = v * (1 + i) + Math.max(0, monthly);
    if (v >= target) return m;
  }
  return null;
}

/** Valor ao fim de `months` meses. */
export function futureValue({ now, monthly = 0, rate = DEFAULT_RATE, months }) {
  const i = (1 + rate / 100) ** (1 / 12) - 1;
  let v = Math.max(0, now);
  for (let m = 0; m < months; m++) v = v * (1 + i) + Math.max(0, monthly);
  return v;
}

/** Quanto por mês é preciso para chegar a `target` em `months` meses. */
export function monthlyNeeded({ now, rate = DEFAULT_RATE, target, months }) {
  if (!(months > 0) || !(target > 0)) return null;
  const i = (1 + rate / 100) ** (1 / 12) - 1;
  const grown = Math.max(0, now) * (1 + i) ** months;
  if (grown >= target) return 0;
  const factor = i === 0 ? months : ((1 + i) ** months - 1) / i;
  return (target - grown) / factor;
}

/** Data (AAAA-MM) daqui a `months` meses. */
export function addMonths(months, from = new Date()) {
  const d = new Date(from.getFullYear(), from.getMonth() + months, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Regra dos 4%: quanto se pode levantar por mês de forma sustentável com esse valor. */
export const fourPercentMonthly = value => (value * 0.04) / 12;
