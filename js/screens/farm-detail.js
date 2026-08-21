/**
 * One farm: its people, grouped by the location they stand in.
 *
 * Locations are managed here rather than in a settings screen because they are
 * only ever created in the moment someone is being registered — "he's in Casa
 * 3" — and walking away to another screen to make Casa 3 first is how a roster
 * ends up with everybody in "General".
 */

import { h } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { screen, topbarButton } from '../ui/shell.js';
import {
  card, button, badge, avatar, itemRow, list, sectionLabel, defList, defRow,
  emptyState, alert, loading, field, input, statGrid, stat,
} from '../ui/kit.js';
import { toastOk, toastBad, sheet, confirm } from '../ui/overlay.js';
import { go } from '../lib/router.js';
import {
  store, subscribe, farmById, clientsOfFarm, farmStats, billingFor, deliveryFor,
} from '../data/store.js';
import { watchFarm, addLocation, renameLocation, removeLocation } from '../data/farms.js';
import { clientStatusMeta, deliveryMeta } from '../lib/model.js';
import { money, number, plural, phone as fmtPhone, telHref } from '../lib/format.js';
import { formatDayLong, today } from '../lib/dates.js';
import { dbMessage } from '../firebase.js';

export function renderFarmDetail(context) {
  const farmId = context.params.id;
  let farm = farmById(farmId);

  const stops = [
    watchFarm(farmId, (row) => { farm = row; draw(); }, () => draw()),
    subscribe(() => { farm = farmById(farmId) || farm; draw(); }),
  ];

  function draw() {
    if (!farm) {
      screen({
        title: 'Rancho',
        backTo: '/farms',
        tab: 'clients',
        body: store.loaded.farms
          ? h('div.page__inner', alert('Este rancho ya no existe.', 'bad'))
          : loading(),
      });
      return;
    }

    screen({
      title: farm.name,
      subtitle: clientStatusMeta(farm.status).label,
      backTo: '/farms',
      tab: 'clients',
      actions: [topbarButton('edit', {
        label: 'Editar rancho', onClick: () => go(`/farms/${farmId}/edit`),
      })],
      body: body(),
      fab: h('button.fab', {
        type: 'button', onclick: () => go(`/clients/new?farm=${farmId}`),
      }, icon('userPlus'), 'Cliente'),
    });
  }

  function body() {
    const stats = farmStats(farmId);
    const roster = clientsOfFarm(farmId);

    return h('div.page__inner.page__inner--flow.stack.stack-4',
      headCard(),
      statGrid([
        stat({ label: 'Clientes', value: number(stats.active), foot: stats.total !== stats.active ? `${stats.total} registrados` : 'activos' }),
        stat({
          label: 'Adeudo', value: money(stats.balance, { round: true }),
          tone: stats.balance > 0 ? 'bad' : 'ok',
          foot: stats.balance > 0 ? 'Suma de sus clientes' : 'Al corriente',
          onClick: () => go('/billing'),
        }),
      ]),
      locationsCard(),
      h('div.span-all', rosterSection(roster)),
      termsCard());
  }

  /* --- Cards --------------------------------------------------------------- */

  function headCard() {
    return card(h('div.stack.stack-3',
      h('div.row',
        avatar(farm.name, { size: 'lg' }),
        h('div.grow',
          h('div.t-lg.w-700', farm.name),
          farm.contactName ? h('div.t-sm.c-soft', farm.contactName) : null,
          h('div', { style: { marginTop: '6px' } },
            badge(clientStatusMeta(farm.status).label, clientStatusMeta(farm.status).tone,
              clientStatusMeta(farm.status).icon)))),

      farm.address
        ? h('div.row.row--top.t-sm.c-soft',
            h('span', { style: { color: 'var(--ink-400)', flex: 'none' } }, icon('pin')),
            h('span', farm.address))
        : null,

      farm.notes ? h('div.t-sm.c-soft', farm.notes) : null,

      farm.phone
        ? h('div.btn-group',
            h('a.btn.btn--ghost.btn--sm', { href: telHref(farm.phone) },
              icon('phone'), fmtPhone(farm.phone)))
        : null));
  }

  /**
   * Locations. A farm with none is broken by definition — nobody can be
   * registered there — so the empty state is an alert, not a shrug.
   */
  function locationsCard() {
    const places = farm.locations || [];

    return h('div.stack.stack-3',
      sectionLabel('Ubicaciones', h('button.btn.btn--quiet.btn--sm', {
        type: 'button', onclick: newLocation,
      }, icon('plus'), 'Agregar')),

      places.length
        ? list(places.map((place) => {
            const here = clientsOfFarm(farmId).filter((c) => c.locationId === place.id);
            return itemRow({
              lead: h('span.item__ico', icon('pin')),
              title: place.name,
              meta: here.length
                ? `${plural(here.length, 'cliente', 'clientes')} · ${number(here.reduce((sum, c) => sum + (Number(c.mealsPerDay) || 0), 0))} comidas/día`
                : 'Sin clientes todavía',
              onClick: () => locationMenu(place, here),
            });
          }), { card: true })
        : card(alert('Este rancho no tiene ubicaciones. Agrega al menos una para poder '
            + 'registrar clientes aquí.', 'warn')));
  }

  function rosterSection(roster) {
    if (!roster.length) {
      return h('div.stack.stack-3',
        sectionLabel('Clientes'),
        emptyState({
          icon: 'userPlus',
          title: 'Todavía no hay clientes',
          text: (farm.locations || []).length
            ? 'Registra a la gente que come en este rancho.'
            : 'Primero agrega una ubicación; nadie puede registrarse sin un lugar donde está.',
          action: (farm.locations || []).length
            ? button('Registrar cliente', { icon: 'userPlus', onClick: () => go(`/clients/new?farm=${farmId}`) })
            : button('Agregar ubicación', { icon: 'plus', onClick: newLocation }),
        }));
    }

    // Grouped by location, in the order the farm lists them, with anyone whose
    // location was removed surfacing at the end instead of disappearing.
    const groups = (farm.locations || []).map((place) => ({
      name: place.name,
      rows: roster.filter((client) => client.locationId === place.id),
    })).filter((group) => group.rows.length);

    const known = new Set((farm.locations || []).map((place) => place.id));
    const orphans = roster.filter((client) => !known.has(client.locationId));
    if (orphans.length) groups.push({ name: 'Sin ubicación', rows: orphans, orphan: true });

    return h('div.stack.stack-4',
      sectionLabel(`Clientes · ${roster.length}`, h('button.btn.btn--quiet.btn--sm', {
        type: 'button', onclick: () => go(`/clients/new?farm=${farmId}`),
      }, icon('plus'), 'Nuevo')),

      groups.map((group) => h('div.stack.stack-2',
        h('div.row.row--between', { style: { padding: '0 2px' } },
          h('div.row', { style: { gap: '6px' } },
            h('span.c-faint', icon('pin')),
            h('div.w-650', group.name)),
          group.orphan
            ? badge('Revisar', 'bad')
            : h('span.t-sm.c-soft', plural(group.rows.length, 'cliente', 'clientes'))),
        list(group.rows.map(clientRow), { card: true }))));
  }

  function termsCard() {
    return h('div.stack.stack-3',
      sectionLabel('Servicio del rancho', h('button.btn.btn--quiet.btn--sm', {
        type: 'button', onclick: () => go(`/farms/${farmId}/edit`),
      }, icon('edit'), 'Editar')),
      card(h('div.stack.stack-3',
        defList([
          defRow('Días de servicio', serviceDays(farm.deliveryDays)),
          defRow('Horario', farm.deliveryWindow || '—'),
          defRow('Inicio del ciclo', formatDayLong(farm.cycleAnchor || today())),
          defRow('Días de gracia', farm.graceDays === 0 ? 'Mismo día' : `${farm.graceDays} días`),
          defRow('Comidas al registrar', plural(farm.defaultMealsPerDay || 1, 'comida', 'comidas')),
        ]),
        h('p.t-xs.c-faint', 'Se aplica a todos los clientes del rancho; al cambiarlo se '
          + 'actualizan sus fichas. El precio de la quincena no es del rancho: sale del plan '
          + 'de cada quien, en Ajustes → Precios.'))));
  }

  /* --- Rows ---------------------------------------------------------------- */

  function clientRow(client) {
    const billing = billingFor(client);
    const stop = deliveryFor(client.id);
    const owes = (billing?.balance || 0) > 0;
    const status = clientStatusMeta(client.status);

    return itemRow({
      lead: avatar(client.name, { size: 'sm' }),
      title: client.name,
      meta: plural(client.mealsPerDay, 'comida/día', 'comidas/día'),
      end: [
        owes ? badge(money(billing.balance, { round: true }), billing.status === 'overdue' ? 'bad' : 'warn') : null,
        client.status !== 'active'
          ? badge(status.label, status.tone)
          : (!owes && stop ? badge(deliveryMeta(stop.status).short, deliveryMeta(stop.status).tone) : null),
      ].filter(Boolean),
      onClick: () => go(`/clients/${client.id}`),
    });
  }

  /* --- Location actions ---------------------------------------------------- */

  async function newLocation() {
    const name = await askName({ title: 'Nueva ubicación', label: 'Nombre de la ubicación' });
    if (!name) return;
    try {
      await addLocation(farm, name);
      toastOk('Ubicación agregada');
    } catch (error) { toastBad(error?.message || dbMessage(error)); }
  }

  async function locationMenu(place, here) {
    await sheet({
      title: place.name,
      build: (close) => h('div.stack.stack-3',
        h('p.t-sm.c-soft', here.length
          ? `${plural(here.length, 'cliente registrado', 'clientes registrados')} en esta ubicación.`
          : 'Todavía no hay nadie en esta ubicación.'),

        button('Registrar cliente aquí', {
          variant: 'primary', block: true, icon: 'userPlus',
          onClick: () => { close(); go(`/clients/new?farm=${farmId}&location=${place.id}`); },
        }),
        button('Cambiar el nombre', {
          variant: 'ghost', block: true, icon: 'edit',
          onClick: async () => {
            close();
            const name = await askName({
              title: 'Cambiar el nombre', label: 'Nombre de la ubicación', value: place.name,
            });
            if (!name || name === place.name) return;
            try {
              await renameLocation(farm, place.id, name);
              toastOk('Ubicación actualizada');
            } catch (error) { toastBad(error?.message || dbMessage(error)); }
          },
        }),
        button('Eliminar ubicación', {
          variant: 'danger-soft', block: true, icon: 'ban',
          onClick: async () => {
            close();
            if (here.length) {
              toastBad(`Primero mueve los ${here.length} clientes que están aquí.`);
              return;
            }
            if (!await confirm({
              title: `Eliminar ${place.name}`,
              message: 'La ubicación desaparece del rancho. Los clientes no se tocan.',
              confirmLabel: 'Eliminar', tone: 'danger', icon: 'alert',
            })) return;
            try {
              await removeLocation(farm, place.id);
              toastOk('Ubicación eliminada');
            } catch (error) { toastBad(error?.message || dbMessage(error)); }
          },
        })),
    });
  }

  draw();
  return () => stops.forEach((stop) => stop?.());
}

/* --- Small pieces ------------------------------------------------------------ */

function askName({ title, label, value = '' }) {
  return sheet({
    title,
    build: (close) => {
      let text = value;
      const control = input({
        value, placeholder: 'Casa 1, Bloque Norte, Invernadero 3…',
        oninput: (event) => { text = event.target.value; },
        onkeydown: (event) => { if (event.key === 'Enter') { event.preventDefault(); close(text.trim()); } },
      });
      queueMicrotask(() => control.focus());
      return h('div.stack.stack-4',
        field({ label, control }),
        button('Guardar', { variant: 'primary', block: true, onClick: () => close(text.trim()) }));
    },
  });
}

function serviceDays(days) {
  if (!days?.length) return '—';
  const names = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  return [1, 2, 3, 4, 5, 6, 0].filter((day) => days.includes(day)).map((day) => names[day]).join(', ');
}
