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
  today, addDays, daysBetween, formatDayLong, capitalize, humanDelta, dayOf,
} from '../lib/dates.js';
import { toDate, errorText } from '../firebase.js';
import { t, tx } from '../lib/i18n.js';

const author = () => ({ uid: session.uid, name: session.displayName });

/** "lunes 26 de octubre" · "Monday, October 26" */
const dayWords = (day) => formatDayLong(day, { year: false });

/** A set left "applying" this long is not going to finish by itself. */
const STALE_MS = 15 * 60 * 1000;
const stale = (set) => (set.state === 'applying' || set.state === 'reverting')
  && Date.now() - (toDate(set.claimedAt)?.getTime() || 0) > STALE_MS;

/** "Juan Pérez — pasa a 2 comidas al día" */
export function setTitle(set) {
  const who = set.clientName || set.value?.name || set.farmName || '';
  const what = set.kind === 'start' ? t('empieza') : changeWords(set, store.farms);
  return who ? `${who} — ${what}` : capitalize(what);
}

/** "Desde el lunes 26 de octubre · hasta el viernes 30" */
export function setWhen(set) {
  const on = { day: dayWords(set.on) };
  const lead = set.kind === 'start' ? t('Empieza el {day}', on)
    : KINDS[set.kind]?.ends ? t('Desde el {day}', on) : t('El {day}', on);
  return `${lead}${set.until ? ` · ${t('hasta el {day}', { day: dayWords(set.until) })}` : ''}`;
}

/**
 * What came of it, in the screen's language. The Programador wrote it in
 * Spanish; "Casa 1, Casa 2 en Mucci Farms." has names on both sides, so it is
 * put into words here rather than by a pattern every stored line would meet.
 */
function resultWords(set) {
  const text = set.result?.text || '';
  const place = set.kind === 'place' && !set.result?.skipped && /^(.*) en (.*)\.$/.exec(text);
  return place ? t('{names} en {farm}.', { names: place[1], farm: place[2] }) : tx(text);
}

const STATE = {
  pending: [t('Programado'), 'brand'],
  applying: [t('Aplicándose'), 'warn'],
  reverting: [t('Regresando'), 'warn'],
  active: [t('Aplicado'), 'ok'],
  done: [t('Hecho'), 'ok'],
  remind: [t('Para hoy'), 'info'],
  failed: [t('No se pudo'), 'bad'],
  cancelled: [t('Cancelado'), 'muted'],
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
      title: t('Programador'),
      subtitle: t('Cambios que se hacen solos en su día'),
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
        t('Falta publicar las reglas del Programador. En la consola de Firebase: Firestore → Reglas, pega el archivo firestore.rules completo y Publicar. Hasta entonces no se puede guardar ni aplicar nada programado.'),
        'bad', 'lock'));
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
        title: t('Todavía no hay nada programado'),
        text: t('Deja un cambio para el día en que empieza —dos comidas desde el lunes, otra ubicación desde el 28, sin pasta del 1 al 10, un pago el viernes— y el sistema lo hace solo ese día.'),
        action: button(t('Programar un cambio'), { variant: 'primary', size: 'lg', icon: 'plus', onClick: () => plan() }),
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
        h('p.t-sm.c-soft', t('Cada cambio se hace solo en su día: lo aplica la primera computadora que se abra —la de la oficina o la de la cocina—, antes de empacar.')),
        button(t('Programar un cambio'), { variant: 'primary', icon: 'plus', onClick: () => plan() })),

      review.length
        ? h('div.stack.stack-2', sectionLabel(t('Para revisar · {count}', { count: review.length })),
          list(review.map((set) => row(set, day)), { card: true }))
        : null,

      coming.length
        ? h('div.stack.stack-3', sectionLabel(t('Próximos · {count}', { count: coming.length })),
          [...byDay.entries()].map(([on, rows]) => h('div.stack.stack-2',
            h('div.sched__day', capitalize(dayWords(on)),
              h('span.c-soft', ` · ${on === day ? t('hoy') : humanDelta(daysBetween(day, on))}`)),
            list(rows.map((set) => row(set, day)), { card: true }))))
        : h('div.stack.stack-2', sectionLabel(t('Próximos')),
          h('p.t-sm.c-soft', t('Nada esperando su día.'))),

      back.length
        ? h('div.stack.stack-2', sectionLabel(t('Aplicados, con fecha de regreso · {count}', { count: back.length })),
          list(back.map((set) => row(set, day)), { card: true }))
        : null,

      done.length
        ? h('div.stack.stack-2', sectionLabel(t('Hechos')),
          list(done.map((set) => row(set, day)), { card: true }))
        : null,

      cancelled.length
        ? h('div.stack.stack-2', sectionLabel(t('Cancelados')),
          list(cancelled.map((set) => row(set, day)), { card: true }))
        : null);
  }

  function row(set, day) {
    const [word, tone] = stale(set) ? [t('Revisar'), 'bad'] : STATE[set.state] || STATE.pending;
    const meta = [
      setWhen(set),
      set.state === 'active' && set.until ? t('regresa el {day}', { day: dayWords(addDays(set.until, 1)) }) : '',
      set.state === 'failed' ? tx(set.error) : '',
      set.result?.skipped ? resultWords(set) : '',
      set.createdByName ? t('programó {name}', { name: set.createdByName }) : '',
    ].filter(Boolean).join(' · ');
    return itemRow({
      lead: h(`span.sched__ico.sched__ico--${KINDS[set.kind]?.group || 'plan'}`, icon(KINDS[set.kind]?.icon || 'clock')),
      title: setTitle(set),
      meta,
      end: badge(set.state === 'pending' && set.on === day ? t('Hoy') : word, tone),
      onClick: () => details(set),
    });
  }

  async function details(set) {
    const choice = await sheet({
      title: KINDS[set.kind]?.label || t('Programado'),
      build: (close) => h('div.stack.stack-4',
        defList([
          defRow(t('Qué'), capitalize(setTitle(set))),
          defRow(t('Cuándo'), setWhen(set)),
          set.until ? defRow(t('Después'), set.kind === 'start'
            ? t('El {day} queda en pausa', { day: dayWords(addDays(set.until, 1)) })
            : t('El {day} regresa a como estaba', { day: dayWords(addDays(set.until, 1)) })) : null,
          defRow(t('Estado'), (STATE[set.state] || STATE.pending)[0]),
          set.result?.text ? defRow(t('Resultado'), resultWords(set)) : null,
          set.error ? defRow(t('Por qué no'), tx(set.error)) : null,
          defRow(t('Lo programó'), `${set.createdByName || '—'}${dayOf(set.createdAt) ? ` · ${formatDayLong(dayOf(set.createdAt))}` : ''}`),
          set.appliedByName ? defRow(t('Lo aplicó'), set.appliedByName) : null,
        ].filter(Boolean)),
        set.state === 'pending'
          ? button(t('Cancelar'), { variant: 'danger-soft', block: true, icon: 'ban', onClick: () => close('cancel') })
          : null,
        set.state === 'active' && set.until
          ? button(t('Regresarlo ya'), { variant: 'soft', block: true, icon: 'refresh', onClick: () => close('end') })
          : null,
        set.state === 'failed'
          ? button(t('Intentar otra vez'), { variant: 'primary', block: true, icon: 'refresh', onClick: () => close('retry') })
          : null,
        set.state === 'remind' || set.state === 'failed' || stale(set)
          ? button(set.state === 'remind' ? t('Hecho') : t('Ya lo revisé'), {
            variant: 'soft', block: true, icon: 'check', onClick: () => close('close'),
          })
          : null,
        set.clientId
          ? button(t('Ver su ficha'), { variant: 'ghost', block: true, icon: 'users', onClick: () => close('client') })
          : null),
    });
    if (!choice) return;
    try {
      if (choice === 'cancel') {
        if (!await confirm({
          title: t('Cancelar lo programado'),
          message: t('{what}. {when}. No se va a hacer.', { what: capitalize(setTitle(set)), when: setWhen(set) }),
          confirmLabel: t('Sí, cancelarlo'), tone: 'danger', icon: 'ban',
        })) return;
        await cancelSet(set, author());
        toastOk(t('Cancelado'));
      } else if (choice === 'end') {
        await endNow(set);
        toastOk(t('Regresa en un momento'));
      } else if (choice === 'retry') {
        await retrySet(set);
        toastOk(t('Se intenta otra vez'));
      } else if (choice === 'close') {
        await closeSet(set, author());
        toastOk(t('Listo'));
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

