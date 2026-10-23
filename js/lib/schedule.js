/**
 * El Programador — changes left for a future day.
 *
 * "Two comidas from Monday." "Casa 3 from the 28th." "No pasta from the 1st
 * to the 10th." "He pays $140 on Friday." The office writes it down once, with
 * its date, and the first computer open on that day — a kitchen machine at six
 * in the morning, or one left on overnight — carries it out. Nothing depends
 * on somebody remembering.
 *
 * This file is the arithmetic: what each kind of change does to a client, and
 * how it is put back when it has an end ("hasta"). It reads nothing and writes
 * nothing; `js/data/schedule.js` does the reading and the writing, in
 * transactions, so two computers waking at once carry a change out once.
 *
 * **A set** is one change, on one day, to one thing:
 *
 *   on      the day it takes effect ("YYYY-MM-DD")
 *   until   optional: the last day it holds. The morning after, it goes back
 *           to what it was — but only what nobody touched in between. If
 *           somebody changed the same thing by hand meanwhile, that was a
 *           decision too, and it is not overwritten; the set says so.
 *   kind    what it does — see KINDS
 *   value   what it sets
 *   before  what was there when it was applied, kept for "until"
 *   state   pending → active (applied, waiting for "until") → done;
 *           or cancelled, failed, remind (a reminder waiting to be seen)
 */

import { addDays, today as todayKey } from './dates.js';
import { sameDiet } from './diet.js';

/**
 * Every kind of change, in the order the office is offered them.
 *
 *   client  it is about one person, chosen first
 *   ends    it can have an "until"
 *   group   where it sits on the first screen: the person's plan, their
 *           status, new things, money
 */
export const KINDS = {
  meals:    { label: 'Comidas al día', sub: '1, 2 o 3', icon: 'utensils', client: true, ends: true, group: 'plan' },
  days:     { label: 'Días que come', sub: 'Calendario semanal', icon: 'calendar', client: true, ends: true, group: 'plan' },
  location: { label: 'Cambio de ubicación', sub: 'Otra casa u otra farma', icon: 'pin', client: true, ends: true, group: 'plan' },
  diet:     { label: 'No puede comer', sub: 'Agregar o quitar', icon: 'noEat', client: true, ends: true, group: 'plan' },
  info:     { label: 'Teléfono o notas', sub: 'Sus datos', icon: 'edit', client: true, ends: true, group: 'plan' },
  status:   { label: 'Pausar o reactivar', sub: 'O darlo de baja', icon: 'pause', client: true, ends: true, group: 'who' },
  start:    { label: 'Cliente nuevo', sub: 'Que empieza otro día', icon: 'userPlus', client: false, ends: true, group: 'who' },
  farm:     { label: 'Farma nueva', sub: 'Con sus ubicaciones', icon: 'farm', client: false, ends: false, group: 'new' },
  place:    { label: 'Ubicación nueva', sub: 'En una farma', icon: 'pin', client: false, ends: false, group: 'new' },
  charge:   { label: 'Agregar deuda', sub: 'Un cargo ese día', icon: 'plus', client: true, ends: false, group: 'money' },
  payment:  { label: 'Registrar un pago', sub: 'Con su recibo', icon: 'cash', client: true, ends: false, group: 'money' },
  balance:  { label: 'Corregir saldo', sub: 'Dejarlo en lo correcto', icon: 'edit', client: true, ends: false, group: 'money' },
  reminder: { label: 'Recordatorio', sub: 'Un aviso ese día', icon: 'bell', client: true, ends: false, group: 'money' },
};

/** Kinds whose change lives on the client document and goes back on "until". */
const ON_CLIENT = new Set(['meals', 'days', 'location', 'diet', 'info', 'status', 'start']);
export const isClientChange = (kind) => ON_CLIENT.has(kind);

const STATUS_WORD = { active: 'activo', paused: 'en pausa', inactive: 'dado de baja' };
const sorted = (days) => [...new Set((days || []).map(Number))].sort((a, b) => a - b);
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const WEEK = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const daysWord = (days) => {
  const list = sorted(days);
  if (list.join() === '1,2,3,4,5,6') return 'lunes a sábado';
  if (list.join() === '0,1,2,3,4,5,6') return 'todos los días';
  if (list.join() === '1,2,3,4,5') return 'lunes a viernes';
  return [1, 2, 3, 4, 5, 6, 0].filter((d) => list.includes(d)).map((d) => WEEK[d]).join(', ') || 'ningún día';
};
const meals = (n) => `${n} ${Number(n) === 1 ? 'comida' : 'comidas'}`;

/** What a set does, in words: "pasa a 2 comidas". */
export function changeWords(set, farms = []) {
  const v = set.value || {};
  switch (set.kind) {
    case 'meals': return `pasa a ${meals(v.mealsPerDay)} al día`;
    case 'days': return `come ${daysWord(v.deliveryDays)}`;
    case 'location': {
      const farm = farms.find((one) => one.id === v.farmId);
      const place = (farm?.locations || []).find((one) => one.id === v.locationId);
      return `se cambia a ${[farm?.name || v.farmName, place?.name || v.locationName].filter(Boolean).join(' · ')}`;
    }
    case 'diet': return [
      (v.add || []).length ? `no puede comer: ${v.add.join(', ')}` : '',
      (v.remove || []).length ? `ya puede comer: ${v.remove.join(', ')}` : '',
    ].filter(Boolean).join(' · ');
    case 'info': return [
      v.phone !== undefined ? `teléfono ${v.phone || '(sin teléfono)'}` : '',
      v.notes !== undefined ? `notas: «${v.notes || 'ninguna'}»` : '',
    ].filter(Boolean).join(' · ');
    case 'status': return v.status === 'active' ? 'vuelve a estar activo'
      : v.status === 'paused' ? 'se pone en pausa' : 'se da de baja';
    case 'start': return 'empieza';
    case 'farm': return `se da de alta la farma ${v.name}${(v.locations || []).length ? ` (${v.locations.join(', ')})` : ''}`;
    case 'place': return `se agrega ${v.names?.length > 1 ? 'las ubicaciones' : 'la ubicación'} ${(v.names || []).join(', ')}`
      + `${set.farmName ? ` a ${set.farmName}` : ''}`;
    case 'charge': return `se le carga $${Number(v.amount || 0).toFixed(2)} — ${v.reason || ''}`;
    case 'payment': return `se registra su pago de $${Number(v.amount || 0).toFixed(2)}`;
    case 'balance': return `su saldo queda en $${Number(v.target || 0).toFixed(2)} — ${v.note || ''}`;
    case 'reminder': return v.amount ? `recordatorio: paga $${Number(v.amount).toFixed(2)}${v.note ? ` — ${v.note}` : ''}`
      : `recordatorio: ${v.note || ''}`;
    default: return '';
  }
}

/**
 * What applying a set does to its client.
 *
 * @param {object} set
 * @param {object} client   as it is now
 * @param {object} [ctx]
 * @param {object[]} [ctx.farms]
 * @returns {{ patch: object, before: object, log?: object } | { skip: string }}
 *   `patch` goes on the client; `before` is kept on the set for "until";
 *   `log` is a status entry to append. `skip` says why nothing happens.
 */
export function applyChange(set, client, { farms = [] } = {}) {
  if (!client) return { skip: 'Ese cliente ya no existe.' };
  const v = set.value || {};

  switch (set.kind) {
    case 'meals': {
      const n = Math.max(1, Math.min(6, Math.round(Number(v.mealsPerDay) || 0)));
      return { patch: { mealsPerDay: n }, before: { mealsPerDay: Number(client.mealsPerDay) || 1 } };
    }
    case 'days': {
      return {
        patch: { deliveryDays: sorted(v.deliveryDays) },
        before: { deliveryDays: sorted(client.deliveryDays) },
      };
    }
    case 'location': {
      const farm = farms.find((one) => one.id === v.farmId);
      const place = (farm?.locations || []).find((one) => one.id === v.locationId);
      if (!farm || !place) return { skip: 'Esa ubicación ya no existe.' };
      const patch = {
        farmId: farm.id, farmName: farm.name || '', locationId: place.id, locationName: place.name,
      };
      // Another farm brings that farm's delivery window and days of grace, as
      // moving somebody by hand does; their pay day and their days stay theirs.
      if (farm.id !== client.farmId) {
        patch.deliveryWindow = farm.deliveryWindow || client.deliveryWindow || '';
        if (farm.graceDays !== undefined) patch.graceDays = farm.graceDays;
      }
      const before = Object.fromEntries(Object.keys(patch).map((key) => [key, client[key] ?? '']));
      return { patch, before };
    }
    case 'diet': {
      const tags = Array.isArray(client.tags) ? client.tags : [];
      const remove = (v.remove || []).filter(Boolean);
      const add = (v.add || []).filter(Boolean);
      const kept = tags.filter((tag) => !remove.some((one) => sameDiet(one, tag)));
      // Written the way it is already written on them, if it is already there.
      const added = add.filter((one) => !kept.some((tag) => sameDiet(tag, one)));
      const removed = tags.filter((tag) => remove.some((one) => sameDiet(one, tag)));
      return {
        patch: { tags: [...kept, ...added] },
        // What this set itself added and took away, so "until" undoes exactly that.
        before: { added, removed },
      };
    }
    case 'info': {
      const patch = {};
      if (v.phone !== undefined) patch.phone = String(v.phone || '').trim();
      if (v.notes !== undefined) patch.notes = String(v.notes || '').trim();
      const before = Object.fromEntries(Object.keys(patch).map((key) => [key, client[key] ?? '']));
      return { patch, before };
    }
    case 'status': {
      const status = ['active', 'paused', 'inactive'].includes(v.status) ? v.status : 'paused';
      if (client.status === status) return { skip: `Ya estaba ${STATUS_WORD[status]}.` };
      const patch = { status };
      // Brought back after a last day that went by: that day is over.
      if (status === 'active' && client.endsOn && client.endsOn < set.on) patch.endsOn = '';
      return {
        patch, before: { status: client.status || 'active' },
        log: { on: set.on, status, prog: set.id || '' },
      };
    }
    case 'start': {
      // Registered ahead, on pause, waiting for this morning.
      if (client.status === 'active') return { skip: 'Ya estaba activo.' };
      const patch = { status: 'active' };
      // With an end, the last day is the "until": the morning after, the pause
      // that "Hasta cuándo come" already does puts them on pause by itself.
      if (set.until) patch.endsOn = set.until;
      return {
        patch, before: { status: client.status || 'paused' },
        log: { on: set.on, status: 'active', prog: set.id || '' },
      };
    }
    default:
      return { skip: 'No es un cambio de cliente.' };
  }
}

/**
 * What putting a set back does, the morning after its "until".
 *
 * Only what is still as the set left it. A field somebody changed by hand in
 * the meantime is skipped, and named, so the office can see why it did not go
 * back.
 *
 * @returns {{ patch: object, skipped: string[], log?: object }}
 */
export function revertChange(set, client, { farms = [] } = {}) {
  const b = set.before || {};
  const back = addDays(set.until, 1);
  if (!client) return { patch: {}, skipped: ['el cliente ya no existe'] };
  const skipped = [];
  const patch = {};
  const keep = (field, now, was, label) => {
    if (same(now, set.applied?.[field])) patch[field] = was;
    else skipped.push(label);
  };

  switch (set.kind) {
    case 'meals': keep('mealsPerDay', Number(client.mealsPerDay), b.mealsPerDay, 'las comidas'); break;
    case 'days': keep('deliveryDays', sorted(client.deliveryDays), sorted(b.deliveryDays), 'los días'); break;
    case 'location': {
      const still = client.farmId === set.applied?.farmId && client.locationId === set.applied?.locationId;
      const farm = farms.find((one) => one.id === b.farmId);
      const place = (farm?.locations || []).find((one) => one.id === b.locationId);
      if (!still) skipped.push('la ubicación');
      else if (!farm || !place) skipped.push('la ubicación de antes, que ya no existe');
      else Object.assign(patch, b, { farmName: farm.name || b.farmName, locationName: place.name });
      break;
    }
    case 'diet': {
      const tags = Array.isArray(client.tags) ? client.tags : [];
      const kept = tags.filter((tag) => !(b.added || []).some((one) => sameDiet(one, tag)));
      const returned = (b.removed || []).filter((one) => !kept.some((tag) => sameDiet(tag, one)));
      patch.tags = [...kept, ...returned];
      break;
    }
    case 'info':
      if ('phone' in b) keep('phone', client.phone ?? '', b.phone, 'el teléfono');
      if ('notes' in b) keep('notes', client.notes ?? '', b.notes, 'las notas');
      break;
    case 'status': {
      if (client.status === set.applied?.status) {
        patch.status = b.status;
        return { patch, skipped, log: { on: back, status: b.status, prog: set.id || '' } };
      }
      skipped.push('el estado');
      break;
    }
    default: break;
  }
  return { patch, skipped };
}

/** Sets whose day has come and that have not been carried out. */
export const dueNow = (sets, day = todayKey()) => (sets || [])
  .filter((set) => set.state === 'pending' && set.on && set.on <= day)
  .sort((a, b) => a.on.localeCompare(b.on) || String(a.id).localeCompare(String(b.id)));

/** Sets carried out whose "until" has passed: to be put back. */
export const dueBack = (sets, day = todayKey()) => (sets || [])
  .filter((set) => set.state === 'active' && set.until && set.until < day)
  .sort((a, b) => a.until.localeCompare(b.until));

/** Waiting for somebody: a reminder that came up, or one that failed. */
export const needsEyes = (sets) => (sets || [])
  .filter((set) => set.state === 'remind' || set.state === 'failed');

/**
 * What the kitchen should hear about ahead: changes to who eats, what and
 * where, coming in the next `days` days — newest day last.
 */
export const comingUp = (sets, day = todayKey(), days = 7) => (sets || [])
  .filter((set) => set.state === 'pending' && set.on > day && set.on <= addDays(day, days)
    && isClientChange(set.kind) && set.kind !== 'info')
  .sort((a, b) => a.on.localeCompare(b.on));
