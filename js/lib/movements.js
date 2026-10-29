/**
 * Movimientos — everything that happened, in order, with its day and hour.
 *
 * The manager asks "who changed Rafael to two comidas, and when?" and "what
 * did the counter do this morning?". Some of that the database already knew —
 * a payment has its receipt, a debt its bill, a pause its record, a message
 * its thread, a new client the moment they were registered. What it did not
 * keep was the rest: one comida became two and the one was simply written
 * over. So every such change now leaves a line in `movements` (see
 * js/data/movements.js), and this file is the words for both: what each
 * change says, and how the lines from every source become one list.
 *
 * A movement is `{ ms, exact, day, kind, clientId, clientName, text, by }` —
 * when, whether that hour is real (an old record may only know its day), what
 * kind, about whom, what happened in words, and who did it.
 */

import { sameDiet } from './diet.js';
import { formatDay, today as todayKey } from './dates.js';

/**
 * The kinds, as the filter offers them. A movement belongs to one; the
 * filter's chips are these, in this order.
 */
export const KINDS = [
  { key: 'pago', label: 'Pagos', icon: 'cash' },
  { key: 'deuda', label: 'Deudas y saldos', icon: 'wallet' },
  { key: 'comidas', label: 'Comidas y días', icon: 'utensils' },
  { key: 'nota', label: 'Notas', icon: 'note' },
  { key: 'nocome', label: 'No puede comer', icon: 'noEat' },
  { key: 'ubicacion', label: 'Ubicación', icon: 'pin' },
  { key: 'datos', label: 'Datos', icon: 'edit' },
  { key: 'estado', label: 'Pausas y estado', icon: 'pause' },
  { key: 'alta', label: 'Altas y bajas', icon: 'userPlus' },
  { key: 'mensaje', label: 'Mensajes', icon: 'chat' },
  { key: 'programado', label: 'Programador', icon: 'clock' },
  { key: 'farma', label: 'Farmas y precios', icon: 'farm' },
];
export const kindOf = (key) => KINDS.find((one) => one.key === key) || KINDS[6];

/* --- Words --------------------------------------------------------------- */

const WEEK = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const STATUS = { active: 'activo', paused: 'en pausa', inactive: 'ya no pide' };
const PAY_EVERY = { 7: 'cada semana', 14: 'cada quincena' };

export const daysWord = (days) => {
  const list = [...new Set((days || []).map(Number))].sort((a, b) => a - b);
  if (!list.length) return 'ningún día';
  if (list.join() === '1,2,3,4,5,6') return 'lunes a sábado';
  if (list.join() === '0,1,2,3,4,5,6') return 'todos los días';
  if (list.join() === '1,2,3,4,5') return 'lunes a viernes';
  return [1, 2, 3, 4, 5, 6, 0].filter((d) => list.includes(d)).map((d) => WEEK[d]).join(', ');
};
const extrasWord = (extras) => {
  const parts = Object.entries(extras || {}).filter(([, n]) => Number(n) > 0)
    .sort((a, b) => ((Number(a[0]) + 6) % 7) - ((Number(b[0]) + 6) % 7))
    .map(([d, n]) => `${WEEK[Number(d)]} +${n}`);
  return parts.length ? parts.join(', ') : 'ninguno';
};
const quote = (text) => {
  const value = String(text || '').trim().replace(/\s+/g, ' ');
  if (!value) return '(nada)';
  return `«${value.length > 90 ? `${value.slice(0, 88)}…` : value}»`;
};
const plain = (value) => (value === undefined || value === null || value === '' ? '—' : String(value));
const dayWord = (key) => (key ? formatDay(key) : '—');
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const listChange = (label, before = [], after = []) => {
  const added = after.filter((one) => !before.some((was) => sameDiet(was, one) || was === one));
  const removed = before.filter((was) => !after.some((one) => sameDiet(was, one) || was === one));
  if (!added.length && !removed.length) return null;
  return `${label}: ${[...added.map((one) => `+ ${one}`), ...removed.map((one) => `− ${one}`)].join(' · ')}`;
};

/**
 * Each field of a client a person can change, and how its change is said.
 * Anything not here — `updatedAt`, the status record, what billing keeps — is
 * not something somebody changed, so it is not a movement. Status is told by
 * its own record (`statusFrom`), so it is not here either.
 */
const FIELDS = {
  mealsPerDay: { kind: 'comidas', say: (a, b) => `Comidas al día: ${plain(a)} → ${plain(b)}` },
  deliveryDays: { kind: 'comidas', say: (a, b) => `Días que come: ${daysWord(a)} → ${daysWord(b)}` },
  extras: { kind: 'comidas', say: (a, b) => `Platos extra: ${extrasWord(a)} → ${extrasWord(b)}` },
  notes: { kind: 'nota', say: (a, b) => `Notas: ${quote(a)} → ${quote(b)}` },
  notaDelDia: { kind: 'nota', say: (a, b) => (b ? `Nota del día: ${quote(b)}` : 'Quitó la nota del día') },
  tags: { kind: 'nocome', say: (a, b) => listChange('No puede comer', a || [], b || []) },
  preferencias: { kind: 'nocome', say: (a, b) => listChange('Preferencias', a || [], b || []) },
  name: { kind: 'datos', say: (a, b) => `Nombre: ${plain(a)} → ${plain(b)}` },
  phone: { kind: 'datos', say: (a, b) => `Teléfono: ${plain(a)} → ${plain(b)}` },
  email: { kind: 'datos', say: (a, b) => `Correo: ${plain(a)} → ${plain(b)}` },
  payEvery: { kind: 'datos', say: (a, b) => `Paga: ${PAY_EVERY[a] || plain(a)} → ${PAY_EVERY[b] || plain(b)}` },
  cycleAnchor: { kind: 'datos', say: (a, b) => `Su quincena empieza: ${dayWord(a)} → ${dayWord(b)}` },
  deliveryWindow: { kind: 'datos', say: (a, b) => `Horario de entrega: ${plain(a)} → ${plain(b)}` },
  graceDays: { kind: 'datos', say: (a, b) => `Días de gracia: ${plain(a)} → ${plain(b)}` },
  endsOn: { kind: 'estado', say: (a, b) => (b ? `Último día: ${dayWord(a)} → ${dayWord(b)}` : 'Le quitó el último día') },
  startsOn: { kind: 'estado', say: (a, b) => (b ? `Empieza: ${dayWord(b)}` : 'Ya no tiene día de empezar') },
};

/**
 * What changed on a client, as movements: one per field, in words.
 *
 * @param {object} before  the client as it was
 * @param {object} patch   what is being written
 * @returns {{ kind: string, text: string }[]}
 */
export function clientChanges(before = {}, patch = {}) {
  const out = [];
  for (const [field, value] of Object.entries(patch)) {
    const spec = FIELDS[field];
    if (!spec || value === undefined) continue;
    const was = before?.[field];
    // Empty and missing are the same thing to whoever reads the list.
    if (same(was ?? '', value ?? '') || (Array.isArray(value) && same(was || [], value))) continue;
    const text = spec.say(was, value);
    if (text) out.push({ kind: spec.kind, text });
  }
  // Where somebody is, as one line rather than four fields.
  const moved = (patch.farmId !== undefined && patch.farmId !== before?.farmId)
    || (patch.locationId !== undefined && patch.locationId !== before?.locationId);
  if (moved) {
    const from = [before?.farmName, before?.locationName].filter(Boolean).join(' · ') || '—';
    const to = [patch.farmName ?? before?.farmName, patch.locationName ?? before?.locationName]
      .filter(Boolean).join(' · ') || '—';
    out.push({ kind: 'ubicacion', text: `Ubicación: ${from} → ${to}` });
  }
  return out;
}

/* --- One list from every source -------------------------------------------- */

const msOf = (value) => {
  if (!value) return 0;
  if (typeof value === 'number') return value;
  if (value instanceof Date) return value.getTime();
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  if (typeof value.seconds === 'number') return value.seconds * 1000;
  return 0;
};
const startOf = (day) => new Date(`${day}T00:00:00`).getTime();
const dayOfMs = (ms) => {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const money = (n) => `$${Number(n || 0).toFixed(2).replace(/\.00$/, '')}`;
const METHOD = {
  cash: 'efectivo', debit: 'débito', transfer: 'transferencia', cheque: 'cheque', card: 'tarjeta', other: 'otro',
};

/**
 * Every movement in a span, newest day first and, inside a day, newest first.
 *
 * @param {object}   input
 * @param {object}   input.range      `{ start, end }`
 * @param {object[]} input.logged     what `movements` holds for the span
 * @param {object[]} input.receipts   payments of the span (each with `at`)
 * @param {object[]} input.invoices   bills of the span; only hand-written debts count
 * @param {object[]} input.clients    everybody: their registration and their status record
 * @param {object[]} input.messages   messages of the span, each with its `clientId`
 */
export function movementsFrom({
  range, logged = [], receipts = [], invoices = [], clients = [], messages = [],
}) {
  const inRange = (day) => day && day >= range.start && day <= range.end;
  const nameOf = new Map(clients.map((client) => [client.id, client.name]));
  const out = [];

  for (const one of logged) {
    const ms = msOf(one.at) || Number(one.ms) || 0;
    out.push({
      id: `m:${one.id}`, ms, exact: !!ms, day: one.day || dayOfMs(ms), kind: one.kind,
      clientId: one.clientId || '', clientName: one.clientName || nameOf.get(one.clientId) || '',
      farmId: one.farmId || '', farmName: one.farmName || '', text: one.text, by: one.by || '',
    });
  }

  for (const receipt of receipts) {
    if (!inRange(receipt.date)) continue;
    const ms = msOf(receipt.at) || startOf(receipt.date);
    const amount = Number(receipt.amount) || 0;
    // Filed under the day it was paid; a payment written down days later says so.
    const late = msOf(receipt.at) && dayOfMs(ms) !== receipt.date ? ` · anotado el ${formatDay(dayOfMs(ms))}` : '';
    const text = amount < 0 || receipt.reversalOf
      ? `Canceló un pago: ${money(Math.abs(amount))}${receipt.reversalOf ? ` (${receipt.reversalOf})` : ''}`
      : `Pago de ${money(amount)} · ${METHOD[receipt.method] || 'efectivo'}${receipt.folio ? ` · ${receipt.folio}` : ''}`
        + `${receipt.held ? ' · por revisar' : ''}${late}`;
    out.push({
      id: `r:${receipt.id}`, ms, exact: !!msOf(receipt.at), day: receipt.date, kind: 'pago',
      clientId: receipt.clientId || '', receiptId: receipt.id,
      clientName: receipt.clientName || nameOf.get(receipt.clientId) || '', text, by: receipt.takenByName || '',
    });
  }

  for (const bill of invoices) {
    if (bill.kind !== 'charge' || !inRange(bill.periodStart)) continue;
    const ms = msOf(bill.issuedAt) || startOf(bill.periodStart);
    out.push({
      id: `i:${bill.id}`, ms, exact: !!msOf(bill.issuedAt), day: bill.periodStart, kind: 'deuda',
      clientId: bill.clientId || '', invoiceId: bill.id,
      clientName: bill.clientName || nameOf.get(bill.clientId) || '',
      text: `Deuda de ${money(bill.amount)}${bill.reason ? ` — ${bill.reason}` : ''}`
        + `${bill.status === 'void' || bill.voided ? ' · cancelada' : ''}`,
      by: bill.issuedByName || '',
    });
  }

  for (const client of clients) {
    const made = msOf(client.createdAt);
    if (made && inRange(dayOfMs(made))) {
      out.push({
        id: `a:${client.id}`, ms: made, exact: true, day: dayOfMs(made), kind: 'alta', clientId: client.id,
        clientName: client.name,
        text: `Alta: ${[client.farmName, client.locationName].filter(Boolean).join(' · ') || 'sin farma'}`
          + ` · ${client.mealsPerDay || 1} ${Number(client.mealsPerDay) === 1 ? 'comida' : 'comidas'}`
          + `${client.startsOn && client.startsOn > dayOfMs(made) ? ` · empieza el ${formatDay(client.startsOn)}` : ''}`,
        by: client.createdByName || '',
      });
    }
    for (const entry of Array.isArray(client.statusLog) ? client.statusLog : []) {
      if (!entry?.on) continue;
      // Filed under the moment it was done; the day it counts from is said in
      // the words when it is another one.
      const exact = !!Number(entry.at);
      const ms = exact ? Number(entry.at) : startOf(entry.on);
      const day = exact ? dayOfMs(ms) : entry.on;
      if (!inRange(day)) continue;
      const word = STATUS[entry.status] || entry.status;
      out.push({
        id: `s:${client.id}:${entry.on}:${entry.tag || entry.at || entry.status}`, ms, exact, day, kind: 'estado',
        clientId: client.id, clientName: client.name,
        text: entry.auto ? `Quedó ${word} solo: su último día fue el ${formatDay(client.endsOn || entry.on)}`
          : `${entry.status === 'active' ? 'Activo' : entry.status === 'paused' ? 'En pausa' : 'Ya no pide'}`
            + `${entry.on !== day ? ` desde el ${formatDay(entry.on)}` : ''}`
            + `${entry.prog ? ' (Programador)' : ''}`,
        by: entry.by || (entry.auto ? 'Automático' : entry.prog ? 'Programador' : ''),
      });
    }
  }

  for (const message of messages) {
    const ms = msOf(message.at);
    if (!ms || !inRange(dayOfMs(ms)) || message.senderRole === 'system') continue;
    const name = nameOf.get(message.clientId) || '';
    out.push({
      id: `c:${message.clientId}:${message.id}`, ms, exact: true, day: dayOfMs(ms), kind: 'mensaje',
      clientId: message.clientId,
      clientName: name,
      text: `${message.senderRole === 'client' ? 'Escribió' : 'Le escribieron'}: ${quote(message.text)}`,
      by: message.senderRole === 'client' ? name : message.senderName || 'La cocina',
    });
  }

  // By day first, so a day's heading holds all of its own; then by the hour.
  return out.sort((a, b) => String(b.day).localeCompare(String(a.day)) || b.ms - a.ms
    || String(a.id).localeCompare(String(b.id)));
}

/** The movements a filter and a search leave. */
export function filterMovements(list, { kinds = [], term = '' } = {}) {
  const fold = (text) => String(text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const words = fold(term).split(/\s+/).filter(Boolean);
  return list.filter((one) => (!kinds.length || kinds.includes(one.kind))
    && words.every((word) => fold(`${one.clientName} ${one.text} ${one.by}`).includes(word)));
}

/** How many of each kind, for the counts on the chips. */
export const countByKind = (list) => list.reduce((acc, one) => {
  acc[one.kind] = (acc[one.kind] || 0) + 1;
  return acc;
}, {});

/** "Hoy", "Ayer", or the date — the heading over each day's movements. */
export const dayHeading = (day, now = todayKey()) => {
  if (day === now) return 'Hoy';
  const y = new Date(`${now}T12:00:00`);
  y.setDate(y.getDate() - 1);
  return day === dayOfMs(y.getTime()) ? 'Ayer' : formatDay(day);
};
