/**
 * The run sheet.
 *
 * Grouped the way the van is actually driven: farm, then location. Nobody
 * delivers to "Ramírez" — they pull up at Casa 1 and hand over the whole
 * stack — so a location moves with one tap and the individual stops underneath
 * are there for the exceptions.
 *
 * The same tap is what each person sees in their app, so the tracking is a
 * by-product of the kitchen doing its normal work rather than extra data entry.
 */

import { h, mount } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { screen, topbarButton } from '../ui/shell.js';
import {
  card, button, badge, meter, emptyState, sectionLabel, skeletonRows,
  field, input, textarea, select, alert, searchInput, avatar, tagList,
} from '../ui/kit.js';
import { toastOk, toastBad, confirm, sheet } from '../ui/overlay.js';
import { go } from '../lib/router.js';
import { session } from '../data/session.js';
import { store, subscribe, setDay, activeClients, dayStats, unscheduled, clientById } from '../data/store.js';
import { tagsInUse } from '../data/clients.js';
import {
  setStatus, advanceAll, advanceMany, scheduleDay, updateDelivery, createDelivery, groupByPlace,
} from '../data/deliveries.js';
import { postSystemMessage } from '../data/chat.js';
import {
  deliveryMeta, nextDeliveryStatus, ADVANCE_LABEL, DELIVERY_FLOW, stripeClass,
} from '../lib/model.js';
import {
  today, addDays, dayRange, relativeDay, formatDayLong, weekdayShort, parseDay, formatDay,
} from '../lib/dates.js';
import { number, plural, matches } from '../lib/format.js';
import { dbMessage } from '../firebase.js';

export function renderRoute(context) {
  const requested = context.query.date;
  if (requested) setDay(requested);

  // With a few hundred stops a day, finding one person means searching for
  // them; the group headers are for driving, this is for answering the phone.
  let term = '';

  const draw = () => {
    const stats = dayStats();
    screen({
      title: 'Ruta',
      subtitle: `${formatDayLong(store.day)} · ${plural(store.deliveries.length, 'parada', 'paradas')}`,
      tab: 'route',
      actions: [topbarButton('plus', { label: 'Agregar parada', onClick: addStop })],
      sunken: true,
      sticky: h('div.stack',
        dayStrip(),
        store.deliveries.length > 8
          ? h('div.searchbar.searchbar--sunken', searchInput({
              placeholder: 'Buscar persona, ubicación o rancho…',
              value: term,
              onInput: (value) => { term = value; redraw(); },
            }))
          : null),
      body: store.loaded.deliveries ? body(stats) : skeletonRows(5),
    });
  };

  /** Redraws only the results, so typing never steals focus from the box. */
  function redraw() {
    const host = document.querySelector('.page > .page__inner');
    if (!host) return draw();
    host.replaceWith(body(dayStats()));
  }

  /* --- Day picker ---------------------------------------------------------- */

  function dayStrip() {
    const days = dayRange(addDays(today(), -3), addDays(today(), 4));
    const strip = h('div.daystrip',
      days.map((day) => {
        const isToday = day === today();
        const active = day === store.day;
        return h(`button.day${active ? '.is-active' : ''}${isToday ? '.is-today' : ''}`, {
          type: 'button', onclick: () => { setDay(day); },
        },
        h('div.day__w', weekdayShort(day)),
        h('div.day__n', parseDay(day).getDate()),
        isToday ? h('div.day__pip') : null);
      }));
    queueMicrotask(() => strip.querySelector('.is-active')?.scrollIntoView({ inline: 'center', block: 'nearest' }));
    return strip;
  }

  /* --- Body ---------------------------------------------------------------- */

  function body(stats) {
    const rows = store.deliveries.filter((row) => matches(
      [row.clientName, row.farmName, row.locationName, row.driver], term));
    const pending = unscheduled();

    if (!store.deliveries.length) {
      return h('div.page__inner', emptyRoute(pending));
    }

    if (!rows.length) {
      return h('div.page__inner.stack.stack-4',
        progressCard(stats),
        emptyState({
          icon: 'search',
          title: 'Sin resultados',
          text: `Ninguna parada coincide con “${term}”.`,
        }));
    }

    return h('div.page__inner.stack.stack-4',
      progressCard(stats),
      pending.length ? pendingNotice(pending) : null,
      groupByPlace(rows).map(farmSection));
  }

  /* --- Farm → location ----------------------------------------------------- */

  function farmSection(farm) {
    const rows = farm.locations.flatMap((place) => place.rows);
    const done = rows.filter((row) => row.status === 'delivered').length;

    return h('div.stack.stack-3',
      sectionLabel(farm.farmName,
        h('span.t-sm.c-soft', `${done}/${rows.length}`)),
      h('div.stack.stack-3.tile-grid', farm.locations.map(locationCard)));
  }

  /**
   * One location: the group header carries the tap that moves everybody in it,
   * and the stops are listed underneath for the ones that go differently.
   */
  function locationCard(place) {
    const rows = place.rows;
    const meals = rows.reduce((sum, row) => sum + (Number(row.meals) || 0), 0);
    const movable = rows.filter((row) => nextDeliveryStatus(row.status));
    const done = rows.filter((row) => row.status === 'delivered').length;
    const problems = rows.filter((row) => row.status === 'issue').length;
    // The label follows the stop furthest behind: that is the work left here.
    const trailing = movable.reduce(
      (worst, row) => (deliveryRank(row.status) < deliveryRank(worst) ? row.status : worst),
      movable[0]?.status);

    return h('div.place',
      h('div.place__head',
        h('div.grow', { style: { minWidth: 0 } },
          h('div.row', { style: { gap: '6px' } },
            h('span.c-faint', icon('pin')),
            h('div.w-650.truncate', place.locationName)),
          h('div.t-sm.c-soft', [
            plural(rows.length, 'persona', 'personas'),
            plural(meals, 'comida', 'comidas'),
            done ? `${done} ${done === 1 ? 'entregada' : 'entregadas'}` : null,
            problems ? `${problems} con problema` : null,
          ].filter(Boolean).join(' · '))),

        movable.length
          ? button(ADVANCE_LABEL[trailing] || 'Avanzar', {
              variant: trailing === 'en_route' ? 'ok' : 'primary', size: 'sm',
              icon: deliveryMeta(nextDeliveryStatus(trailing)).icon,
              onClick: () => advancePlace(place, movable),
            })
          : badge('Listo', 'ok', 'check')),

      h('div.place__rows', rows.map(stopCard)));
  }

  async function advancePlace(place, movable) {
    if (movable.length === 1) {
      const [row] = movable;
      await advance(row, nextDeliveryStatus(row.status));
      return;
    }
    try {
      const moved = await advanceMany(movable, author());
      toastOk(`${place.locationName}: ${moved} ${moved === 1 ? 'parada avanzada' : 'paradas avanzadas'}`);
    } catch (error) { toastBad(dbMessage(error)); }
  }

  function progressCard(stats) {
    const bulk = nextBulkAction(store.deliveries);
    return card(h('div.stack.stack-3',
      h('div.row.row--between',
        h('div',
          h('div.t-xs.upper.c-faint.w-700', 'Avance del día'),
          h('div.t-xl.w-700', `${stats.done} de ${stats.servable} entregas`)),
        h('div.t-2xl.w-700.c-brand', `${stats.percent}%`)),
      meter(stats.percent, { tone: stats.percent === 100 ? 'ok' : null, large: true }),
      h('div.t-sm.c-soft',
        `${number(stats.meals)} comidas · ${number(stats.mealsDelivered)} ya entregadas`),
      dietSummary(),
      bulk
        ? button(`${bulk.label} (${bulk.count})`, {
            variant: 'dark', block: true, icon: bulk.icon,
            onClick: () => runBulk(bulk),
          })
        : stats.percent === 100
          ? alert('Ruta completa. Buen trabajo.', 'ok')
          : null));
  }

  /** Who is missing from today's route, counted by farm rather than listed. */
  /**
   * What has to be left out of today's cooking, counted.
   *
   * The cook needs this before plating, not while handing boxes over — three
   * portions without chicken is a decision made at the stove. Counting the
   * stops rather than the roster means somebody paused or not served today
   * does not inflate it.
   */
  function dietSummary() {
    const served = store.deliveries
      .filter((row) => row.status !== 'skipped')
      .map((row) => clientById(row.clientId))
      .filter(Boolean);

    const counts = tagsInUse(served);
    if (!counts.length) return null;

    return h('div.row.row--wrap', { style: { gap: '6px' } },
      h('span.t-xs.upper.c-faint.w-700', { style: { marginRight: '2px' } }, 'Hoy sin:'),
      counts.map((entry) => h('span.tag',
        icon('ban'), `${entry.tag} · ${entry.count}`)));
  }

  function pendingNotice(pending) {
    const byFarm = new Map();
    for (const client of pending) {
      const name = client.farmName || 'Sin rancho';
      byFarm.set(name, (byFarm.get(name) || 0) + 1);
    }
    const summary = [...byFarm.entries()]
      .map(([name, count]) => `${name} (${count})`).join(' · ');

    return card(h('div.row.row--top',
      h('span', { style: { color: 'var(--warn-500)' } }, icon('alert')),
      h('div.grow',
        h('div.w-600', `${pending.length} sin programar`),
        h('div.t-sm.c-soft', summary)),
      button('Agregar', { variant: 'ghost', size: 'sm', onClick: generate })), { className: 'card--tight' });
  }

  function emptyRoute(pending) {
    const servable = pending.length;
    return emptyState({
      icon: 'route',
      title: 'Sin entregas este día',
      text: servable
        ? `${servable} ${servable === 1 ? 'persona recibe' : 'personas reciben'} comida ${relativeDay(store.day).toLowerCase()}. Genera la ruta para empezar.`
        : 'Nadie tiene servicio programado para este día.',
      action: servable
        ? button('Generar la ruta', { icon: 'calendar', onClick: generate })
        : button('Agregar una parada', { variant: 'ghost', icon: 'plus', onClick: addStop }),
    });
  }

  /* --- Stop card ----------------------------------------------------------- */

  function stopCard(row) {
    const meta = deliveryMeta(row.status);
    const next = nextDeliveryStatus(row.status);
    const client = clientById(row.clientId);

    return h(`div.stop${row.status === 'delivered' ? '.is-delivered' : ''}${row.status === 'issue' ? '.is-issue' : ''}${row.status === 'skipped' ? '.is-skipped' : ''}`,
      h(`div.${stripeClass(meta.tone).split(' ').join('.')}`),

      h('div.grow', { style: { minWidth: 0 } },
        h('div.w-600.truncate', row.clientName),
        h('div.t-xs.c-soft.truncate',
          [plural(row.meals, 'comida', 'comidas'), meta.short, row.driver]
            .filter(Boolean).join(' · ')),
        // Loud, and never truncated away: this is the one line on the screen
        // that, missed, hands somebody a plate they cannot eat.
        tagList(client?.tags, { className: 'tags--loud' }),
        row.notes ? h('div.t-xs.c-warn.truncate', row.notes) : null),

      next
        ? button('', {
            variant: next === 'delivered' ? 'ok' : 'soft', size: 'sm',
            icon: deliveryMeta(next).icon,
            onClick: () => advance(row, next),
          })
        : row.status === 'delivered'
          ? h('span.stop__done', icon('check'))
          : button('', {
              variant: 'ghost', size: 'sm', icon: 'refresh',
              onClick: () => advance(row, 'scheduled'),
            }),

      button('', {
        variant: 'quiet', size: 'sm', icon: 'more',
        onClick: () => options(row, client),
      }));
  }

  /* --- Actions ------------------------------------------------------------- */

  const author = () => ({ uid: session.uid, name: session.displayName });

  async function advance(row, next) {
    try {
      await setStatus(row, next, author());
      if (next === 'delivered') toastOk(`${row.clientName}: entregado`);
    } catch (error) { toastBad(dbMessage(error)); }
  }

  async function runBulk(bulk) {
    if (!await confirm({
      title: bulk.label,
      message: `Se aplicará a ${bulk.count} ${bulk.count === 1 ? 'parada' : 'paradas'} que están en “${deliveryMeta(bulk.from).label}”.`,
      confirmLabel: bulk.label, icon: bulk.icon,
    })) return;
    try {
      const moved = await advanceAll(store.deliveries, bulk.from, author());
      toastOk(`${moved} ${moved === 1 ? 'parada actualizada' : 'paradas actualizadas'}`);
    } catch (error) { toastBad(dbMessage(error)); }
  }

  async function generate() {
    try {
      const { created } = await scheduleDay(activeClients(), store.day, author());
      toastOk(created ? `${created} ${created === 1 ? 'entrega creada' : 'entregas creadas'}` : 'No hay nada que generar.');
    } catch (error) { toastBad(dbMessage(error)); }
  }

  async function addStop() {
    const candidates = activeClients()
      .filter((client) => !store.deliveries.some((row) => row.clientId === client.id));

    if (!candidates.length) { toastBad('Todos los clientes activos ya están en la ruta.'); return; }

    const picked = await sheet({
      title: 'Agregar parada',
      build: (close) => {
        const rows = h('div.stack.stack-2');
        const paint = (search) => mount(rows, candidates
          .filter((client) => matches([client.name, client.farmName, client.locationName], search))
          .slice(0, 30)
          .map((client) => h('button.item.item--tap-target', {
            type: 'button',
            style: { border: '1px solid var(--border)', borderRadius: 'var(--r-md)' },
            onclick: () => close(client),
          },
          avatar(client.name, { size: 'sm' }),
          h('div.item__main',
            h('div.item__title', client.name),
            h('div.item__meta', [
              client.farmName, client.locationName,
              plural(client.mealsPerDay, 'comida', 'comidas'),
            ].filter(Boolean).join(' · '))))));
        paint('');

        return h('div.stack.stack-3',
          h('p.t-sm.c-soft', `Se agregará a la ruta de ${formatDay(store.day)}.`),
          searchInput({ placeholder: 'Buscar…', onInput: paint }),
          rows);
      },
    });
    if (!picked) return;

    try {
      await createDelivery(picked, store.day, author());
      toastOk('Parada agregada');
    } catch (error) { toastBad(dbMessage(error)); }
  }

  /** Per-stop menu: meals, driver, notes, problem, skip. */
  async function options(row, client) {
    await sheet({
      title: `${row.clientName}${row.locationName ? ` · ${row.locationName}` : ''}`,
      build: (close) => {
        let meals = row.meals;
        let driver = row.driver || '';
        let notes = row.notes || '';

        return h('div.stack.stack-4',
          (client?.tags || []).length
            ? h('div.stack.stack-2',
                h('div.t-xs.upper.c-faint.w-700', 'No puede comer'),
                tagList(client.tags, { className: 'tags--loud' }))
            : null,
          field({
            label: 'Comidas',
            control: input({
              value: meals, type: 'number', inputmode: 'numeric', min: '0',
              oninput: (e) => { meals = Number(e.target.value); },
            }),
          }),
          field({
            label: 'Chofer',
            control: input({ value: driver, placeholder: 'Quién lleva esta entrega', oninput: (e) => { driver = e.target.value; } }),
          }),
          field({
            label: 'Nota del día',
            control: textarea({ value: notes, rows: 2, placeholder: 'Cambio de horario, portón cerrado…', oninput: (e) => { notes = e.target.value; } }),
          }),

          button('Guardar cambios', {
            variant: 'primary', block: true,
            onClick: async () => {
              try {
                await updateDelivery(row.id, { meals, driver, notes });
                toastOk('Entrega actualizada');
                close(true);
              } catch (error) { toastBad(dbMessage(error)); }
            },
          }),

          h('div.divider'),

          h('div.stack.stack-2',
            button('Ver ficha del cliente', {
              variant: 'ghost', block: true, icon: 'users',
              onClick: () => { close(); go(`/clients/${row.clientId}`); },
            }),
            row.farmId ? button('Ver rancho', {
              variant: 'ghost', block: true, icon: 'farm',
              onClick: () => { close(); go(`/farms/${row.farmId}`); },
            }) : null,
            client ? button('Enviar mensaje', {
              variant: 'ghost', block: true, icon: 'chat',
              onClick: () => { close(); go(`/chat/${row.clientId}`); },
            }) : null,
            row.status !== 'issue' ? button('Reportar problema', {
              variant: 'danger-soft', block: true, icon: 'alert',
              onClick: async () => { close(); await reportIssue(row); },
            }) : null,
            row.status !== 'skipped' ? button('Sin servicio hoy', {
              variant: 'ghost', block: true, icon: 'ban',
              onClick: async () => {
                close();
                try {
                  await setStatus(row, 'skipped', author());
                  toastOk('Marcado sin servicio');
                } catch (error) { toastBad(dbMessage(error)); }
              },
            }) : null));
      },
    });
  }

  /** A problem is worth a message: the farm should not have to call and ask. */
  async function reportIssue(row) {
    const result = await sheet({
      title: 'Reportar problema',
      build: (close) => {
        let reason = 'Retraso en la entrega';
        let detail = '';
        let notify = true;

        const notifyBox = h('input', { type: 'checkbox', checked: true, onchange: (e) => { notify = e.target.checked; } });

        return h('div.stack.stack-4',
          field({
            label: '¿Qué pasó?',
            control: select({
              value: reason,
              options: [
                'Retraso en la entrega',
                'No se pudo entregar',
                'Faltaron comidas',
                'Problema con el vehículo',
                'Nadie recibió en el rancho',
                'Otro',
              ].map((value) => ({ value, label: value })),
              onchange: (e) => { reason = e.target.value; },
            }),
          }),
          field({
            label: 'Detalle',
            control: textarea({ rows: 3, placeholder: 'Lo que quieras que quede registrado.', oninput: (e) => { detail = e.target.value; } }),
          }),
          h('label.switch',
            h('div.grow',
              h('div.w-600', 'Avisar al rancho'),
              h('div.t-sm.c-soft', 'Se envía un mensaje en su chat.')),
            notifyBox,
            h('span.switch__track')),
          button('Registrar problema', {
            variant: 'danger', block: true,
            onClick: () => close({ reason, detail, notify }),
          }));
      },
    });
    if (!result) return;

    const note = [result.reason, result.detail].filter(Boolean).join(' — ');
    try {
      await setStatus(row, 'issue', author(), { notes: note });
      if (result.notify) {
        await postSystemMessage(row.clientId,
          `Aviso sobre la entrega de ${formatDay(row.date)}: ${note}. Cualquier duda, escríbanos por aquí.`,
          { meta: { kind: 'delivery_issue', date: row.date }, notify: true });
      }
      toastOk('Problema registrado');
    } catch (error) { toastBad(dbMessage(error)); }
  }

  return subscribe(draw);
}

/* --- Helpers ----------------------------------------------------------------- */

/** How far along the flow a status is — used to find a group's laggard. */
const deliveryRank = (status) => {
  const at = DELIVERY_FLOW.indexOf(status);
  return at < 0 ? DELIVERY_FLOW.length : at;
};

/** The one bulk move that makes sense right now, if any. */
function nextBulkAction(rows) {
  for (const from of ['scheduled', 'preparing', 'en_route']) {
    const count = rows.filter((row) => row.status === from).length;
    if (count) {
      const next = DELIVERY_FLOW[DELIVERY_FLOW.indexOf(from) + 1];
      return { from, count, label: ADVANCE_LABEL[from], icon: deliveryMeta(next).icon };
    }
  }
  return null;
}
