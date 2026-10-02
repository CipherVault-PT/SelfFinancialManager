import { state } from './store.js';
import { closedM, qty } from './calc.js';
import { rates } from './fx.js';
import { fetchJSON } from './net.js';
import { todayISO } from './format.js';

const DAY = 86_400_000;
const CENT = 0.005;
export const TAX_RATE = 0.28;
export const LONG_TERM_DAYS = 365;

const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);
const shiftDate = (d, n) => new Date(Date.parse(d) + n * DAY).toISOString().slice(0, 10);

/**
 * Câmbio de referência do BCE (1 EUR = x cur) na data, ou no dia útil anterior mais próximo.
 * Sem histórico usa o câmbio atual e marca o valor como aproximado.
 */
export function histRate(date, cur, hist = state.cache.fxHist || {}) {
  if (cur === 'EUR') return { rate: 1, exact: true };
  if (date) {
    for (let i = 0; i <= 10; i++) {
      const r = hist[shiftDate(date, -i)]?.[cur];
      if (r > 0) return { rate: r, exact: i <= 4 };
    }
  }
  return { rate: rates()[cur], exact: false };
}

/**
 * Uma linha por cada compra vendida (FIFO), com valores em EUR:
 * o valor de realização de cada venda é repartido pelas unidades de cada compra.
 * group: 'securities' (ações/ETFs), 'crypto' (< 365 dias) ou 'cryptoLong' (≥ 365 dias, excluída).
 */
export function taxLines(closed = state.closed) {
  const out = [];
  for (const s of closed) {
    const total = qty(s);
    if (!(total > 0)) continue;
    const proceeds = closedM(s, s.currency).proceeds;
    const saleDate = s.closedAt || null;
    const sale = histRate(saleDate, s.currency);
    (s.lots ?? []).forEach((l, i) => {
      if (!(l.shares > 0)) return;
      const acqDate = l.date || s.openedAt || null;
      const acq = histRate(acqDate, s.currency);
      const acqEUR = l.cost / acq.rate;
      const saleEUR = (proceeds * (l.shares / total)) / sale.rate;
      const days = acqDate && saleDate ? daysBetween(acqDate, saleDate) : null;
      const group = s.kind === 'crypto' ? (days != null && days >= LONG_TERM_DAYS ? 'cryptoLong' : 'crypto') : 'securities';
      out.push({
        id: `${s.id}:${i}`, saleId: s.id, name: s.name, symbol: s.symbol || '', platform: s.platform || '', kind: s.kind,
        units: l.shares, acqDate, saleDate, acqEUR, saleEUR, gain: saleEUR - acqEUR, days, group,
        approxFx: s.currency !== 'EUR' && !(acq.exact && sale.exact),
        missingDate: !acqDate || !saleDate,
      });
    });
  }
  return out.sort((a, b) => (a.saleDate || '').localeCompare(b.saleDate || '') || (a.acqDate || '').localeCompare(b.acqDate || ''));
}

export const taxYears = lines =>
  [...new Set(lines.map(l => l.saleDate?.slice(0, 4)).filter(Boolean))].sort().reverse();

/** Ano por omissão: o anterior (o que se declara no IRS) se tiver vendas, senão o mais recente. */
export function defaultTaxYear(years, now = new Date()) {
  const prev = String(now.getFullYear() - 1);
  return years.includes(prev) ? prev : years[0];
}

const blank = () => ({ count: 0, gains: 0, losses: 0, net: 0, acquired: 0, realized: 0, tax: 0 });

export function taxSummary(lines, year) {
  const rows = lines.filter(l => l.saleDate?.startsWith(String(year)));
  const groups = { securities: blank(), crypto: blank(), cryptoLong: blank() };
  for (const l of rows) {
    const g = groups[l.group];
    g.count++;
    g.acquired += l.acqEUR;
    g.realized += l.saleEUR;
    if (l.gain >= 0) g.gains += l.gain; else g.losses -= l.gain;
  }
  for (const [k, g] of Object.entries(groups)) {
    g.net = g.gains - g.losses;
    g.tax = k === 'cryptoLong' ? 0 : Math.max(0, g.net) * TAX_RATE;
  }
  return {
    year: String(year), lines: rows, groups,
    taxTotal: groups.securities.tax + groups.crypto.tax,
    shortTermGains: rows.filter(l => l.group === 'securities' && l.days != null && l.days < LONG_TERM_DAYS && l.gain > CENT).length,
    approxFx: rows.filter(l => l.approxFx).length,
    missingDate: rows.filter(l => l.missingDate).length,
  };
}

/** Vai buscar os câmbios históricos do BCE (Frankfurter) para as vendas em contas fora do euro. */
export async function ensureFxHistory(closed = state.closed) {
  const foreign = closed.filter(s => s.currency && s.currency !== 'EUR');
  if (!foreign.length) return false;
  const curs = [...new Set(foreign.map(s => s.currency))];
  const hist = (state.cache.fxHist ||= {});
  const today = todayISO();
  const dates = foreign
    .flatMap(s => [s.closedAt, s.openedAt, ...(s.lots ?? []).map(l => l.date)])
    .filter(d => d && d <= today && curs.some(c => !histRate(d, c, hist).exact))
    .sort();
  if (!dates.length) return false;
  const url = `https://api.frankfurter.app/${shiftDate(dates[0], -7)}..${dates.at(-1)}?from=EUR&to=${curs.join(',')}`;
  const d = await fetchJSON(url, { timeout: 12_000 });
  for (const [day, r] of Object.entries(d?.rates ?? {})) hist[day] = { ...hist[day], ...r };
  return true;
}

const num2 = v => (Number.isFinite(v) ? v.toFixed(2).replace('.', ',') : '');
const qtyTxt = v => v.toFixed(8).replace(/0+$/, '').replace(/\.$/, '').replace('.', ',');

function cell(v) {
  let s = String(v ?? '');
  if (/^[=+@]/.test(s)) s = `'${s}`; // evita fórmulas ao abrir no Excel
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function lineNotes(l) {
  return [
    l.group === 'cryptoLong' && 'cripto ≥ 365 dias (excluída)',
    l.group === 'securities' && l.days != null && l.days < LONG_TERM_DAYS && '< 365 dias',
    l.approxFx && 'câmbio aproximado',
    l.missingDate && 'data em falta',
  ].filter(Boolean).join(', ');
}

/** CSV para Excel PT (separador ";", vírgula decimal, UTF-8 com BOM). */
export function taxCSV(lines) {
  const head = ['Ativo', 'Símbolo', 'Corretora', 'Tipo', 'Quantidade', 'Data aquisição', 'Valor aquisição (EUR)',
    'Data realização', 'Valor realização (EUR)', 'Mais/menos-valia (EUR)', 'Dias detido', 'Observações'];
  const rows = lines.map(l => [
    l.name, l.symbol, l.platform, l.kind === 'crypto' ? 'Cripto' : 'Ação/ETF', qtyTxt(l.units),
    l.acqDate || '', num2(l.acqEUR), l.saleDate || '', num2(l.saleEUR), num2(l.gain), l.days ?? '', lineNotes(l),
  ]);
  return `﻿${[head, ...rows].map(r => r.map(cell).join(';')).join('\r\n')}\r\n`;
}
