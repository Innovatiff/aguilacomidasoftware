/**
 * Programador — the list of changes left for a future day.
 *
 * What opens first is the list, because the question asked in front of this
 * screen is "what is already planned?" before it is "plan something":
 *
 *   - **Para revisar**: a reminder whose day came, or a change that could not
 *     be carried out — each with what to do about it.
 *   - **Próximos**: everything still waiting, by day, soonest first.
 *   - **Con fecha de regreso**: carried out, and going back on its day.
 *   - **Hechos** and **cancelados**: the record of what was planned, by whom,
 *     and what happened.
 *
 * «Programar» opens the questions (js/ui/schedule-flow.js). Tapping a row says
 * everything about it, with Cancelar while it is still waiting.
 */

import { h } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { screen } from '../ui/shell.js';
import {
  itemRow, list, badge, emptyState, button, sectionLabel, alert, skeletonRows, defList, defRow,
} from '../ui/kit.js';
import { sheet, toastOk, toastBad, confirm } from '../ui/overlay.js';
import { go } from '../lib/router.js';
import { store, subscribe } from '../data/store.js';
import { session } from '../data/session.js';
import {
  watchScheduleHistory, cancelSet, closeSet, retrySet, endNow,
} from '../data/schedule.js';
import { openScheduleFlow } from '../ui/schedule-flow.js';
import { KINDS, changeWords } from '../lib/schedule.js';
import {
  today, addDays, daysBetween, formatDay, formatDayLong, weekdayName, capitalize, humanDelta, dayOf,
} from '../lib/dates.js';
import { toDate, errorText } from '../firebase.js';

const author = () => ({ uid: session.uid, name: session.displayName });

/** A set left "applying" this long is not going to finish by itself. */
const STALE_MS = 15 * 60 * 1000;
const stale = (set) => (set.state === 'applying' || set.state === 'reverting')
  && Date.now() - (toDate(set.claimedAt)?.getTime() || 0) > STALE_MS;

/** "Juan Pérez — pasa a 2 comidas al día" */
export function setTitle(set) {
  const who = set.clientName || set.value?.name || set.farmName || '';
  const what = set.kind === 'start' ? 'empieza' : changeWords(set, store.farms);
  return who ? `${who} — ${what}` : capitalize(what);
}

/** "Desde el lunes 26 de octubre · hasta el viernes 30" */
export function setWhen(set) {
  const on = `${weekdayName(set.on)} ${formatDay(set.on)}`;
  const lead = set.kind === 'start' ? 'Empieza el'
    : KINDS[set.kind]?.ends ? 'Desde el' : 'El';
  return `${lead} ${on}${set.until ? ` · hasta el ${weekdayName(set.until)} ${formatDay(set.until)}` : ''}`;
}

const STATE = {
  pending: ['Programado', 'brand'],
  applying: ['Aplicándose', 'warn'],
  reverting: ['Regresando', 'warn'],
  active: ['Aplicado', 'ok'],
  done: ['Hecho', 'ok'],
  remind: ['Para hoy', 'info'],
  failed: ['No se pudo', 'bad'],
  cancelled: ['Cancelado', 'muted'],
};

export function renderSchedule() {
  let history = [];
  let historyError = null;

  const stops = [
    watchScheduleHistory((rows) => { history = rows; draw(); },
      (error) => { historyError = error; draw(); }),
    subscribe(() => draw()),
  ];

  function all() {
    // The open ones from the store — the same list the computers run — and
    // the rest from the history.
    const byId = new Map(history.map((set) => [set.id, set]));
    for (const set of store.schedule) byId.set(set.id, set);
    return [...byId.values()];
  }

  function draw() {
    screen({
      title: 'Programador',
      subtitle: 'Cambios que se hacen solos en su día',
      tab: 'programador',
      body: body(),
    });
  }

  function plan(client = null) {
    openScheduleFlow({ client, author: author() });
  }

  function body() {
    const refused = [store.scheduleError, historyError]
      .find((error) => error?.code === 'permission-denied');
    if (refused) {
      return h('div.page__inner.stack.stack-4', alert(
        'Falta publicar las reglas del Programador. En la consola de Firebase: Firestore → Reglas, '
        + 'pega el archivo firestore.rules completo y Publicar. Hasta entonces no se puede guardar ni '
        + 'aplicar nada programado.', 'bad', 'lock'));
    }
    if (!store.loaded.schedule && !history.length) return skeletonRows(4);

    const sets = all();
    const day = today();
    const review = sets.filter((set) => set.state === 'remind' || set.state === 'failed' || stale(set));
    const coming = sets.filter((set) => set.state === 'pending')
      .sort((a, b) => a.on.localeCompare(b.on));
    const back = sets.filter((set) => set.state === 'active')
      .sort((a, b) => String(a.until).localeCompare(String(b.until)));
    const done = sets.filter((set) => set.state === 'done')
      .sort((a, b) => (toDate(b.doneAt)?.getTime() || 0) - (toDate(a.doneAt)?.getTime() || 0)).slice(0, 30);
    const cancelled = sets.filter((set) => set.state === 'cancelled').slice(0, 10);

    if (!sets.length) {
      return h('div.page__inner', emptyState({
        icon: 'clock',
        title: 'Todavía no hay nada programado',
        text: 'Deja un cambio para el día en que empieza —dos comidas desde el lunes, otra ubicación '
          + 'desde el 28, sin pasta del 1 al 10, un pago el viernes— y el sistema lo hace solo ese día.',
        action: button('Programar un cambio', { variant: 'primary', size: 'lg', icon: 'plus', onClick: () => plan() }),
      }));
    }

    // Soonest first, a heading for each day.
    const byDay = new Map();
    for (const set of coming) {
      if (!byDay.has(set.on)) byDay.set(set.on, []);
      byDay.get(set.on).push(set);
    }

    return h('div.page__inner.stack.stack-5',
      h('div.sched__intro',
        h('p.t-sm.c-soft', 'Cada cambio se hace solo en su día: lo aplica la primera computadora '
          + 'que se abra —la de la oficina o la de la cocina—, antes de empacar.'),
        button('Programar un cambio', { variant: 'primary', icon: 'plus', onClick: () => plan() })),

      review.length
        ? h('div.stack.stack-2', sectionLabel(`Para revisar · ${review.length}`),
          list(review.map((set) => row(set, day)), { card: true }))
        : null,

      coming.length
        ? h('div.stack.stack-3', sectionLabel(`Próximos · ${coming.length}`),
          [...byDay.entries()].map(([on, rows]) => h('div.stack.stack-2',
            h('div.sched__day', capitalize(`${weekdayName(on)} ${formatDay(on)}`),
              h('span.c-soft', ` · ${on === day ? 'hoy' : humanDelta(daysBetween(day, on))}`)),
            list(rows.map((set) => row(set, day)), { card: true }))))
        : h('div.stack.stack-2', sectionLabel('Próximos'),
          h('p.t-sm.c-soft', 'Nada esperando su día.')),

      back.length
        ? h('div.stack.stack-2', sectionLabel(`Aplicados, con fecha de regreso · ${back.length}`),
          list(back.map((set) => row(set, day)), { card: true }))
        : null,

      done.length
        ? h('div.stack.stack-2', sectionLabel('Hechos'),
          list(done.map((set) => row(set, day)), { card: true }))
        : null,

      cancelled.length
        ? h('div.stack.stack-2', sectionLabel('Cancelados'),
          list(cancelled.map((set) => row(set, day)), { card: true }))
        : null);
  }

  function row(set, day) {
    const [word, tone] = stale(set) ? ['Revisar', 'bad'] : STATE[set.state] || STATE.pending;
    const meta = [
      setWhen(set),
      set.state === 'active' && set.until ? `regresa el ${weekdayName(addDays(set.until, 1))} ${formatDay(addDays(set.until, 1))}` : '',
      set.state === 'failed' ? set.error : '',
      set.result?.skipped ? set.result.text : '',
      set.createdByName ? `programó ${set.createdByName}` : '',
    ].filter(Boolean).join(' · ');
    return itemRow({
      lead: h(`span.sched__ico.sched__ico--${KINDS[set.kind]?.group || 'plan'}`, icon(KINDS[set.kind]?.icon || 'clock')),
      title: setTitle(set),
      meta,
      end: badge(set.state === 'pending' && set.on === day ? 'Hoy' : word, tone),
      onClick: () => details(set),
    });
  }

  async function details(set) {
    const choice = await sheet({
      title: KINDS[set.kind]?.label || 'Programado',
      build: (close) => h('div.stack.stack-4',
        defList([
          defRow('Qué', capitalize(setTitle(set))),
          defRow('Cuándo', setWhen(set)),
          set.until ? defRow('Después', `El ${weekdayName(addDays(set.until, 1))} ${formatDay(addDays(set.until, 1))} `
            + `${set.kind === 'start' ? 'queda en pausa' : 'regresa a como estaba'}`) : null,
          defRow('Estado', (STATE[set.state] || STATE.pending)[0]),
          set.result?.text ? defRow('Resultado', set.result.text) : null,
          set.error ? defRow('Por qué no', set.error) : null,
          defRow('Lo programó', `${set.createdByName || '—'}${dayOf(set.createdAt) ? ` · ${formatDayLong(dayOf(set.createdAt))}` : ''}`),
          set.appliedByName ? defRow('Lo aplicó', set.appliedByName) : null,
        ].filter(Boolean)),
        set.state === 'pending'
          ? button('Cancelar', { variant: 'danger-soft', block: true, icon: 'ban', onClick: () => close('cancel') })
          : null,
        set.state === 'active' && set.until
          ? button('Regresarlo ya', { variant: 'soft', block: true, icon: 'refresh', onClick: () => close('end') })
          : null,
        set.state === 'failed'
          ? button('Intentar otra vez', { variant: 'primary', block: true, icon: 'refresh', onClick: () => close('retry') })
          : null,
        set.state === 'remind' || set.state === 'failed' || stale(set)
          ? button(set.state === 'remind' ? 'Hecho' : 'Ya lo revisé', {
            variant: 'soft', block: true, icon: 'check', onClick: () => close('close'),
          })
          : null,
        set.clientId
          ? button('Ver su ficha', { variant: 'ghost', block: true, icon: 'users', onClick: () => close('client') })
          : null),
    });
    if (!choice) return;
    try {
      if (choice === 'cancel') {
        if (!await confirm({
          title: 'Cancelar lo programado',
          message: `${capitalize(setTitle(set))}. ${setWhen(set)}. No se va a hacer.`,
          confirmLabel: 'Sí, cancelarlo', tone: 'danger', icon: 'ban',
        })) return;
        await cancelSet(set, author());
        toastOk('Cancelado');
      } else if (choice === 'end') {
        await endNow(set);
        toastOk('Regresa en un momento');
      } else if (choice === 'retry') {
        await retrySet(set);
        toastOk('Se intenta otra vez');
      } else if (choice === 'close') {
        await closeSet(set, author());
        toastOk('Listo');
      } else if (choice === 'client') {
        go(`/clients/${set.clientId}`);
      }
    } catch (error) { toastBad(errorText(error)); }
  }

  draw();
  return () => stops.forEach((stop) => stop?.());
}

/** For a client's file: what is planned for them, still to happen. */
export const plannedFor = (clientId) => store.schedule
  .filter((set) => set.clientId === clientId && ['pending', 'active', 'remind'].includes(set.state))
  .sort((a, b) => a.on.localeCompare(b.on));

