/**
 * The run sheet.
 *
 * One tap per stop moves it forward — programado → en cocina → en camino →
 * entregado — because this screen is used with one hand while carrying trays.
 * The same tap is what the farm sees in its app, so the tracking is a
 * by-product of the kitchen doing its normal work rather than extra data entry.
 */

import { h } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { screen, topbarButton } from '../ui/shell.js';
import {
  card, button, badge, meter, emptyState, sectionLabel, skeletonRows,
  field, input, textarea, select, alert,
} from '../ui/kit.js';
import { toastOk, toastBad, confirm, sheet } from '../ui/overlay.js';
import { go } from '../lib/router.js';
import { session } from '../data/session.js';
import { store, subscribe, setDay, activeClients, dayStats, unscheduled, clientById } from '../data/store.js';
import { setStatus, advanceAll, scheduleDay, updateDelivery, createDelivery } from '../data/deliveries.js';
import { postSystemMessage } from '../data/chat.js';
import {
  deliveryMeta, nextDeliveryStatus, ADVANCE_LABEL, DELIVERY_FLOW, stripeClass,
} from '../lib/model.js';
import {
  today, addDays, dayRange, relativeDay, formatDayLong, weekdayShort, parseDay, formatDay,
} from '../lib/dates.js';
import { number, plural } from '../lib/format.js';
import { dbMessage } from '../firebase.js';

export function renderRoute(context) {
  const requested = context.query.date;
  if (requested) setDay(requested);

  const draw = () => {
    const stats = dayStats();
    screen({
      title: 'Ruta',
      subtitle: formatDayLong(store.day),
      tab: 'route',
      actions: [topbarButton('plus', { label: 'Agregar parada', onClick: addStop })],
      sunken: true,
      sticky: dayStrip(),
      body: store.loaded.deliveries ? body(stats) : skeletonRows(5),
    });
  };

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
    const rows = store.deliveries;
    const pending = unscheduled();

    if (!rows.length) {
      return h('div.page__inner', emptyRoute(pending));
    }

    const groups = groupByStatus(rows);

    return h('div.page__inner.stack.stack-4',
      progressCard(stats),
      pending.length ? pendingNotice(pending) : null,
      groups.map(([status, items]) => h('div.stack.stack-3',
        sectionLabel(`${deliveryMeta(status).label} · ${items.length}`),
        h('div.stack.stack-3', items.map(stopCard)))));
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
      bulk
        ? button(`${bulk.label} (${bulk.count})`, {
            variant: 'dark', block: true, icon: bulk.icon,
            onClick: () => runBulk(bulk),
          })
        : stats.percent === 100
          ? alert('Ruta completa. Buen trabajo.', 'ok')
          : null));
  }

  function pendingNotice(pending) {
    return card(h('div.row.row--top',
      h('span', { style: { color: 'var(--warn-500)' } }, icon('alert')),
      h('div.grow',
        h('div.w-600', `${pending.length} sin programar`),
        h('div.t-sm.c-soft', pending.map((c) => c.name).join(', '))),
      button('Agregar', { variant: 'ghost', size: 'sm', onClick: generate })), { className: 'card--tight' });
  }

  function emptyRoute(pending) {
    const servable = pending.length;
    return emptyState({
      icon: 'route',
      title: 'Sin entregas este día',
      text: servable
        ? `${servable} ${servable === 1 ? 'rancho recibe' : 'ranchos reciben'} comida ${relativeDay(store.day).toLowerCase()}. Genera la ruta para empezar.`
        : 'Ningún rancho activo tiene servicio programado para este día.',
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

    return h(`div.route-card${row.status === 'delivered' ? '.is-delivered' : ''}${row.status === 'issue' ? '.is-issue' : ''}${row.status === 'skipped' ? '.is-skipped' : ''}`,
      h('div.route-card__top',
        h(`div.${stripeClass(meta.tone).split(' ').join('.')}`),
        h('div.grow', { style: { minWidth: 0 } },
          h('div.row.row--between',
            h('div.w-650.truncate', row.clientName),
            badge(meta.short, meta.tone, meta.icon)),
          h('div.t-sm.c-soft.truncate', { style: { marginTop: '2px' } },
            [plural(row.meals, 'comida', 'comidas'), row.window, row.driver]
              .filter(Boolean).join(' · ')),
          row.notes ? h('div.t-xs.c-warn.truncate', { style: { marginTop: '2px' } }, row.notes) : null)),

      h('div.route-card__bar',
        next
          ? button(ADVANCE_LABEL[row.status] || 'Avanzar', {
              variant: next === 'delivered' ? 'ok' : 'primary', size: 'sm',
              icon: deliveryMeta(next).icon,
              onClick: () => advance(row, next),
            })
          : row.status === 'delivered'
            ? button('Entregado', { variant: 'ghost', size: 'sm', icon: 'check', disabled: true })
            : button('Reactivar', {
                variant: 'ghost', size: 'sm', icon: 'refresh',
                onClick: () => advance(row, 'scheduled'),
              }),
        button('', {
          variant: 'ghost', size: 'sm', icon: 'more', className: 'route-card__more',
          onClick: () => options(row, client),
        })));
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

    if (!candidates.length) { toastBad('Todos los ranchos activos ya están en la ruta.'); return; }

    const picked = await sheet({
      title: 'Agregar parada',
      build: (close) => h('div.stack.stack-2',
        h('p.t-sm.c-soft', `Se agregará a la ruta de ${formatDay(store.day)}.`),
        candidates.map((client) => h('button.item', {
          type: 'button',
          style: { border: '1px solid var(--border)', borderRadius: 'var(--r-md)' },
          onclick: () => close(client),
        },
        h('div.item__main',
          h('div.item__title', client.name),
          h('div.item__meta', plural(client.mealsPerDay, 'comida', 'comidas')))))),
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
      title: row.clientName,
      build: (close) => {
        let meals = row.meals;
        let driver = row.driver || '';
        let notes = row.notes || '';

        return h('div.stack.stack-4',
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
            button('Ver rancho', {
              variant: 'ghost', block: true, icon: 'users',
              onClick: () => { close(); go(`/clients/${row.clientId}`); },
            }),
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

/** Stops grouped by status, in the order the day actually moves. */
function groupByStatus(rows) {
  const order = ['issue', 'en_route', 'preparing', 'scheduled', 'delivered', 'skipped'];
  const map = new Map(order.map((status) => [status, []]));
  for (const row of rows) (map.get(row.status) || map.get('scheduled')).push(row);
  return [...map.entries()].filter(([, items]) => items.length);
}

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
