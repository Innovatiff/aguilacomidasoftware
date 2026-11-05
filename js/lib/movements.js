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
import { t, english } from './i18n.js';

/**
 * The kinds, as the filter offers them. A movement belongs to one; the
 * filter's chips are these, in this order. The labels are Spanish keys: the
 * screen shows them with `t(kind.label)`.
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

// Spanish and English, chosen at each call: the same words are written to the
// database in Spanish (inside `inSpanish`) and shown on an English screen.
const WEEK = {
  es: ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'],
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
};
const week = () => (english() ? WEEK.en : WEEK.es);
const STATUS = { active: 'activo', paused: 'en pausa', inactive: 'ya no pide' };
const PAY_EVERY = { 7: 'cada semana', 14: 'cada quincena' };

export const daysWord = (days) => {
  const list = [...new Set((days || []).map(Number))].sort((a, b) => a - b);
  if (!list.length) return t('ningún día');
  if (list.join() === '1,2,3,4,5,6') return t('lunes a sábado');
  if (list.join() === '0,1,2,3,4,5,6') return t('todos los días');
  if (list.join() === '1,2,3,4,5') return t('lunes a viernes');
  return [1, 2, 3, 4, 5, 6, 0].filter((d) => list.includes(d)).map((d) => week()[d]).join(', ');
};
const extrasWord = (extras) => {
  const parts = Object.entries(extras || {}).filter(([, n]) => Number(n) > 0)
    .sort((a, b) => ((Number(a[0]) + 6) % 7) - ((Number(b[0]) + 6) % 7))
    .map(([d, n]) => `${week()[Number(d)]} +${n}`);
  return parts.length ? parts.join(', ') : t('ninguno');
};
const quote = (text) => {
  const value = String(text || '').trim().replace(/\s+/g, ' ');
  if (!value) return t('(nada)');
  const cut = value.length > 90 ? `${value.slice(0, 88)}…` : value;
  return english() ? `“${cut}”` : `«${cut}»`;
};
const plain = (value) => (value === undefined || value === null || value === '' ? '—' : String(value));
const dayWord = (key) => (key ? formatDay(key) : '—');
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const listChange = (label, before = [], after = []) => {
  const added = after.filter((one) => !before.some((was) => sameDiet(was, one) || was === one));
  const removed = before.filter((was) => !after.some((one) => sameDiet(was, one) || was === one));
  if (!added.length && !removed.length) return null;
  return `${t(label)}: ${[...added.map((one) => `+ ${one}`), ...removed.map((one) => `− ${one}`)].join(' · ')}`;
};

/**
 * Each field of a client a person can change, and how its change is said.
 * Anything not here — `updatedAt`, the status record, what billing keeps — is
 * not something somebody changed, so it is not a movement. Status is told by
 * its own record (`statusFrom`), so it is not here either.
 */
const change = (label, a, b) => t('{label}: {from} → {to}', { label: t(label), from: a, to: b });
const FIELDS = {
  mealsPerDay: { kind: 'comidas', say: (a, b) => change('Comidas al día', plain(a), plain(b)) },
  deliveryDays: { kind: 'comidas', say: (a, b) => change('Días que come', daysWord(a), daysWord(b)) },
  extras: { kind: 'comidas', say: (a, b) => change('Platos extra', extrasWord(a), extrasWord(b)) },
  notes: { kind: 'nota', say: (a, b) => change('Notas', quote(a), quote(b)) },
  notaDelDia: {
    kind: 'nota',
    say: (a, b) => (b ? t('Nota del día: {note}', { note: quote(b) }) : t('Quitó la nota del día')),
  },
  tags: { kind: 'nocome', say: (a, b) => listChange('No puede comer', a || [], b || []) },
  preferencias: { kind: 'nocome', say: (a, b) => listChange('Preferencias', a || [], b || []) },
  name: { kind: 'datos', say: (a, b) => change('Nombre', plain(a), plain(b)) },
  phone: { kind: 'datos', say: (a, b) => change('Teléfono', plain(a), plain(b)) },
  email: { kind: 'datos', say: (a, b) => change('Correo', plain(a), plain(b)) },
  payEvery: {
    kind: 'datos',
    say: (a, b) => change('Paga', PAY_EVERY[a] ? t(PAY_EVERY[a]) : plain(a), PAY_EVERY[b] ? t(PAY_EVERY[b]) : plain(b)),
  },
  cycleAnchor: { kind: 'datos', say: (a, b) => change('Su quincena empieza', dayWord(a), dayWord(b)) },
  deliveryWindow: { kind: 'datos', say: (a, b) => change('Horario de entrega', plain(a), plain(b)) },
  graceDays: { kind: 'datos', say: (a, b) => change('Días de gracia', plain(a), plain(b)) },
  endsOn: {
    kind: 'estado',
    say: (a, b) => (b ? change('Último día', dayWord(a), dayWord(b)) : t('Le quitó el último día')),
  },
  startsOn: {
    kind: 'estado',
    say: (a, b) => (b ? t('Empieza: {day}', { day: dayWord(b) }) : t('Ya no tiene día de empezar')),
  },
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
    out.push({ kind: 'ubicacion', text: change('Ubicación', from, to) });
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
const method = (key) => t(METHOD[key] || 'efectivo');

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
      farmId: one.farmId || '', farmName: one.farmName || '', text: storedText(one.text), by: storedText(one.by || ''),
    });
  }

  for (const receipt of receipts) {
    if (!inRange(receipt.date)) continue;
    const ms = msOf(receipt.at) || startOf(receipt.date);
    const amount = Number(receipt.amount) || 0;
    // Filed under the day it was paid; a payment written down days later says so.
    const late = msOf(receipt.at) && dayOfMs(ms) !== receipt.date
      ? ` · ${t('anotado el {day}', { day: formatDay(dayOfMs(ms)) })}` : '';
    const text = amount < 0 || receipt.reversalOf
      ? t('Canceló un pago: {amount}', { amount: money(Math.abs(amount)) })
        + `${receipt.reversalOf ? ` (${receipt.reversalOf})` : ''}`
      : t('Pago de {amount} · {method}', { amount: money(amount), method: method(receipt.method) })
        + `${receipt.folio ? ` · ${receipt.folio}` : ''}${receipt.held ? ` · ${t('por revisar')}` : ''}${late}`;
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
      text: t('Deuda de {amount}', { amount: money(bill.amount) }) + `${bill.reason ? ` — ${bill.reason}` : ''}`
        + `${bill.status === 'void' || bill.voided ? ` · ${t('cancelada')}` : ''}`,
      by: bill.issuedByName || '',
    });
  }

  for (const client of clients) {
    const made = msOf(client.createdAt);
    if (made && inRange(dayOfMs(made))) {
      out.push({
        id: `a:${client.id}`, ms: made, exact: true, day: dayOfMs(made), kind: 'alta', clientId: client.id,
        clientName: client.name,
        text: t('Alta: {place}', {
          place: [client.farmName, client.locationName].filter(Boolean).join(' · ') || t('sin farma'),
        })
          + ` · ${client.mealsPerDay || 1} ${t(Number(client.mealsPerDay) === 1 ? 'comida' : 'comidas')}`
          + `${client.startsOn && client.startsOn > dayOfMs(made)
            ? ` · ${t('empieza el {day}', { day: formatDay(client.startsOn) })}` : ''}`,
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
      const word = STATUS[entry.status] || entry.status || '';
      out.push({
        id: `s:${client.id}:${entry.on}:${entry.tag || entry.at || entry.status}`, ms, exact, day, kind: 'estado',
        clientId: client.id, clientName: client.name,
        text: entry.auto
          ? t('Quedó {status} solo: su último día fue el {day}', { status: t(word), day: formatDay(client.endsOn || entry.on) })
          : t(entry.status === 'active' ? 'Activo' : entry.status === 'paused' ? 'En pausa' : 'Ya no pide')
            + `${entry.on !== day ? ` ${t('desde el {day}', { day: formatDay(entry.on) })}` : ''}`
            + `${entry.prog ? ` (${t('Programador')})` : ''}`,
        by: entry.by ? storedText(entry.by) : (entry.auto ? t('Automático') : entry.prog ? t('Programador') : ''),
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
      text: `${t(message.senderRole === 'client' ? 'Escribió' : 'Le escribieron')}: ${quote(message.text)}`,
      by: message.senderRole === 'client' ? name : message.senderName || t('La cocina'),
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
  if (day === now) return t('Hoy');
  const y = new Date(`${now}T12:00:00`);
  y.setDate(y.getDate() - 1);
  return day === dayOfMs(y.getTime()) ? t('Ayer') : formatDay(day);
};

/* --- Lines written in Spanish, read in English ----------------------------- */

const ES_MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre',
  'octubre', 'noviembre', 'diciembre'];
const EN_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September',
  'October', 'November', 'December'];
const ES_DAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const EN_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Longest first, so "Quitó la nota del día" is said before "Nota del día" is.
// Every line the panel writes to `movements` is made of these.
const PHRASES = [
  ['Borró al cliente (se había dado de alta por error)', 'Deleted the client (registered by mistake)'],
  ['Programador (regresó) · ', 'Scheduler (reverted) · '],
  ['Programador · ', 'Scheduler · '],
  ['Canceló lo programado', 'Cancelled a scheduled change'],
  ['Programó', 'Scheduled'],
  ['Quitó la nota del día', 'Removed today’s note'],
  ['Le quitó el último día', 'Removed the last day'],
  ['Ya no tiene día de empezar', 'No longer has a start date'],
  ['Su quincena empieza', 'Two-week period starts'],
  ['Precios por quincena', 'Prices per two-week period'],
  ['Corrigió una cuenta', 'Corrected an invoice'],
  ['Bajó el saldo', 'Lowered the balance'],
  ['Quitó una deuda de', 'Removed a debt of'],
  ['Borró una farma sin clientes', 'Deleted a farm with no clients'],
  ['Días de entrega cambiados', 'Delivery days changed'],
  ['Comidas por defecto', 'Default meals'],
  ['Paga por defecto', 'Default payment schedule'],
  ['Horario de entrega', 'Delivery window'],
  ['Comidas al día', 'Meals per day'],
  ['comidas al día', 'meals per day'],
  ['comida al día', 'meal per day'],
  ['Días que come', 'Meal days'],
  ['Días de gracia', 'Grace days'],
  ['Platos extra', 'Extra meals'],
  ['Nota del día', 'Today’s note'],
  ['No puede comer', 'Can’t eat'],
  ['no puede comer', 'can’t eat'],
  ['ya puede comer', 'can eat again'],
  ['Preferencias', 'Preferences'],
  ['Último día', 'Last day'],
  ['Farma nueva', 'New farm'],
  ['Farma activa', 'Farm active'],
  ['Farma inactiva', 'Farm inactive'],
  ['ubicaciones nuevas', 'new locations'],
  ['ubicación nueva', 'new location'],
  ['quitó la ubicación', 'removed the location'],
  ['Ubicación', 'Location'],
  ['Dirección', 'Address'],
  ['Contacto', 'Contact'],
  ['Teléfono', 'Phone'],
  ['teléfono', 'phone'],
  ['(sin teléfono)', '(no phone)'],
  ['Correo', 'Email'],
  ['Nombre', 'Name'],
  ['Estado', 'Status'],
  ['Notas', 'Notes'],
  ['notas', 'notes'],
  ['Empieza', 'Starts'],
  ['Paga', 'Pays'],
  ['cada quincena', 'every two weeks'],
  ['cada semana', 'every week'],
  ['ningún día', 'no days'],
  ['todos los días', 'every day'],
  ['lunes a sábado', 'Monday to Saturday'],
  ['lunes a viernes', 'Monday to Friday'],
  ['ninguno', 'none'],
  ['ninguna', 'none'],
  ['(nada)', '(none)'],
  ['vuelve a estar activo', 'becomes active again'],
  ['se pone en pausa', 'goes on pause'],
  ['se da de baja', 'is removed'],
  ['se da de alta la farma', 'registers the farm'],
  ['se agrega las ubicaciones', 'adds the locations'],
  ['se agrega la ubicación', 'adds the location'],
  ['se le carga', 'is charged'],
  ['se registra su pago de', 'records their payment of'],
  ['su saldo queda en', 'balance set to'],
  ['recordatorio: paga', 'reminder: pays'],
  ['recordatorio', 'reminder'],
  ['se cambia a', 'moves to'],
  ['pasa a', 'switches to'],
  ['desde el', 'from'],
  ['hasta el', 'until'],
  ['empieza', 'starts'],
  ['comidas', 'meals'],
  ['comida', 'meal'],
  ['Programador', 'Scheduler'],
  ['Automático', 'Automatic'],
];
const ABBR = { lun: 'Mon', mar: 'Tue', 'mié': 'Wed', jue: 'Thu', vie: 'Fri', 'sáb': 'Sat', dom: 'Sun' };
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const word = (text) => new RegExp(`(?<![\\p{L}])${escape(text)}(?![\\p{L}])`, 'gu');
const RULES = PHRASES.map(([es, en]) => [word(es), en]);

function englishBits(part) {
  let out = part
    // "5 de noviembre" → "November 5"; "el 5 de noviembre" → "on November 5" where it stands alone.
    .replace(new RegExp(`(\\d{1,2}) de (${ES_MONTHS.join('|')})`, 'g'),
      (whole, d, month) => `${EN_MONTHS[ES_MONTHS.indexOf(month)]} ${d}`);
  for (const [pattern, en] of RULES) out = out.replace(pattern, en);
  out = out
    .replace(new RegExp(`(?<![\\p{L}])(${ES_DAYS.join('|')})(?![\\p{L}])`, 'gu'),
      (whole) => EN_DAYS[ES_DAYS.indexOf(whole)])
    .replace(/(?<![\p{L}])(lun|mar|mié|jue|vie|sáb|dom)(?=,|\s\+|$)/gu, (whole) => ABBR[whole])
    .replace(/(?<![\p{L}])el (?=[A-Z][a-z]+ \d)/gu, 'on ');
  return out;
}

/**
 * A line the panel wrote to `movements`, in the screen's language.
 *
 * Lines are kept in Spanish whatever the screen showed when they were written
 * (other computers read them). In English each is put back together from the
 * words it is made of; what a person typed — a note in «quotes», a name — is
 * left as it was written.
 */
export function storedText(text) {
  if (!english() || !text) return text || '';
  return String(text).split(/(«[^»]*»)/).map((part) => (part.startsWith('«') && part.endsWith('»')
    ? `“${part.slice(1, -1)}”`
    : englishBits(part))).join('');
}
