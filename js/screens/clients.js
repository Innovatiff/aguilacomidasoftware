/**
 * Clientes — the roster, and everything you do to somebody on it.
 *
 * This is where the kitchen spends its day, so it is built to answer the four
 * questions that actually get asked, in the order they get asked:
 *
 *   who owes me money · who is behind · who is active · who is broken
 *
 * Two things happen here that nobody has to remember to do. Fortnights that
 * closed without a bill are found and offered in one tap, because a period
 * that quietly ends unbilled is food already cooked and never charged. And
 * everybody overdue can be reminded at once, because opening twenty chats to
 * type the same sentence is how reminders stop being sent.
 *
 * Every row carries its own actions — charge, pause, message — so managing
 * somebody never costs a round trip through their file and back.
 */

import { h } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { screen, topbarButton, lifetime } from '../ui/shell.js';
import {
  searchInput, chips, list, avatar, badge, emptyState, button, card, select,
  sectionLabel, statGrid, stat, skeletonRows, alert, dataErrorCard, tagList,
} from '../ui/kit.js';
import { toastOk, toastBad, confirm, sheet } from '../ui/overlay.js';
import { openChargeSheet } from '../ui/charge-sheet.js';
import { openDebtSheet } from '../ui/debt-sheet.js';
import { go } from '../lib/router.js';
import { session } from '../data/session.js';
import {
  store, subscribe, roster, invoicesFor, firstError, startStore,
} from '../data/store.js';
import { matchesSearch, setClientStatus, setEndsOn } from '../data/clients.js';
import { pendingBilling, issueAll, byFarm } from '../data/cycles.js';
import { postSystemMessage } from '../data/chat.js';
import { owedBreakdown } from '../lib/billing.js';
import { money, moneyFull, number, plural } from '../lib/format.js';
import {
  formatDay, formatDayLong, today, addDays, humanDelta, daysBetween,
} from '../lib/dates.js';
import { dbMessage } from '../firebase.js';

/** What each state looks like on a row, and what to call it. */
const STATE = {
  overdue:  { label: 'Vencido',     tone: 'bad' },
  due:      { label: 'Por pagar',   tone: 'warn' },
  covered:  { label: 'Pagado',      tone: 'ok' },
  clear:    { label: 'Al corriente', tone: 'ok' },
  paused:   { label: 'En pausa',    tone: 'warn' },
  inactive: { label: 'Inactivo',    tone: 'muted' },
};

const FILTERS = [
  { value: 'all',      label: 'Todos',      match: () => true },
  { value: 'overdue',  label: 'Vencidos',   match: (row) => row.state === 'overdue' },
  { value: 'debt',     label: 'Deben',      match: (row) => row.owed > 0 },
  { value: 'pending',  label: 'Falta este periodo',
    match: (row) => row.serving === 'active' && !row.covered },
  { value: 'covered',  label: 'Pagados',    match: (row) => row.covered },
  { value: 'active',   label: 'Activos',    match: (row) => row.serving === 'active' },
  { value: 'paused',   label: 'En pausa',   match: (row) => row.client.status === 'paused' },
  { value: 'inactive', label: 'Inactivos',  match: (row) => row.client.status === 'inactive' },
  { value: 'diet',     label: 'Con restricciones',
    match: (row) => (row.client.tags || []).length > 0 },
  // The migration list: everybody still on their rancho's placeholder cycle
  // rather than on a day somebody confirmed. It empties as payments come in.
  { value: 'nocycle',  label: 'Sin periodo fijo',
    match: (row) => row.serving !== 'inactive' && !row.cycleSet },
  { value: 'gaps',     label: 'Revisar',    match: (row) => row.hasGap },
];

/** Filters about money list the biggest debt first; the rest go alphabetical. */
const MONEY_FILTERS = new Set(['overdue', 'debt', 'pending']);

export function renderClients(context) {
  // The billing scan below outlives a quick visit, so the screen has to be able
  // to say it is gone.
  const life = lifetime();
  let term = '';
  let filter = context.query.filter || 'all';
  let farmId = context.query.farm || '';
  let pending = null;          // closed fortnights waiting to be billed
  let scanning = false;

  const author = () => ({ uid: session.uid, name: session.displayName });

  const draw = () => {
    const failure = firstError();

    screen({
      title: 'Clientes',
      subtitle: `${store.clients.length} en ${plural(store.farms.length, 'rancho', 'ranchos')}`,
      tab: 'clients',
      actions: [
        topbarButton('cash', { label: 'Cobrar en la tienda', onClick: () => go('/cobrar') }),
        topbarButton('receipt', { label: 'Cobranza', onClick: () => go('/billing') }),
      ],
      sticky: h('div.searchbar',
        // Wraps rather than squeezing: on a phone the farm picker drops under
        // the search box instead of leaving it three words wide.
        h('div.row.row--wrap',
          h('div', { style: { flex: '3 1 220px', minWidth: 0 } }, searchInput({
            placeholder: 'Buscar por nombre, rancho o ubicación…',
            value: term,
            onInput: (value) => { term = value; redraw(); },
          })),
          store.farms.length > 1
            ? h('div', { style: { flex: '1 1 160px', minWidth: 0 } }, select({
                value: farmId,
                options: [
                  { value: '', label: 'Todos los ranchos' },
                  ...store.farms.map((farm) => ({ value: farm.id, label: farm.name })),
                ],
                onchange: (event) => { farmId = event.target.value; draw(); },
              }))
            : null),
        h('div', { style: { marginTop: '10px' } },
          chips(filterChips(), filter, (value) => { filter = value; draw(); }))),
      body: failure
        ? h('div.page__inner', dataErrorCard(failure.error, { onRetry: () => startStore() }))
        : store.loaded.clients ? body() : skeletonRows(6),
      fab: h('button.fab', { type: 'button', onclick: () => go('/clients/new') },
        icon('userPlus'), 'Cliente'),
    });
  };

  /** Redraws the results only, so typing never steals focus from the box. */
  function redraw() {
    const host = document.getElementById('roster');
    if (!host) return draw();
    host.replaceWith(results());
  }

  /* --- Data ---------------------------------------------------------------- */

  const all = () => roster().filter((row) => !farmId || row.client.farmId === farmId);

  function visible() {
    const rule = FILTERS.find((f) => f.value === filter) || FILTERS[0];
    const rows = all()
      .filter((row) => matchesSearch(row.client, term))
      .filter(rule.match);

    return MONEY_FILTERS.has(filter)
      ? rows.sort((a, b) => b.owed - a.owed || byName(a, b))
      : rows.sort(byName);
  }

  const byName = (a, b) =>
    String(a.client.name).localeCompare(String(b.client.name), 'es');

  function filterChips() {
    const rows = all();
    return FILTERS.map((f) => ({
      value: f.value,
      label: f.label,
      count: rows.filter(f.match).length,
    }));
  }

  /* --- Body ---------------------------------------------------------------- */

  function body() {
    const rows = all();
    const owed = rows.reduce((sum, row) => sum + row.owed, 0);
    const overdue = rows.filter((row) => row.state === 'overdue');

    return h('div.page__inner.stack.stack-4',
      billingBanner(),
      overdue.length ? remindBanner(overdue) : null,

      statGrid([
        stat({
          label: 'Activos',
          value: number(rows.filter((row) => row.serving === 'active').length),
          foot: `${rows.length} en total`,
          onClick: () => { filter = 'active'; draw(); },
        }),
        stat({
          label: 'Deben',
          value: money(owed, { round: true }),
          foot: `${plural(rows.filter((row) => row.owed > 0).length, 'cliente', 'clientes')}`,
          tone: owed > 0 ? 'accent' : 'ok',
          onClick: () => { filter = 'debt'; draw(); },
        }),
        stat({
          label: 'Al corriente',
          value: number(rows.filter((row) => row.owed <= 0 && row.serving !== 'inactive').length),
          foot: `${rows.filter((row) => row.covered).length} con su periodo pagado`,
          tone: 'ok',
          onClick: () => { filter = 'covered'; draw(); },
        }),
      ], 3),

      results());
  }

  function results() {
    const rows = visible();
    if (!rows.length) return h('div', { id: 'roster' }, empty());

    return h('div.stack.stack-3', { id: 'roster' },
      sectionLabel(`${plural(rows.length, 'cliente', 'clientes')}`,
        MONEY_FILTERS.has(filter)
          ? h('span.t-sm.c-soft', money(rows.reduce((sum, row) => sum + row.owed, 0), { round: true }))
          : null),
      list(rows.map(clientRow), { card: true }));
  }

  function empty() {
    if (term) {
      return emptyState({
        icon: 'search', title: 'Sin resultados',
        text: `Ningún cliente coincide con “${term}”.`,
      });
    }
    if (!store.clients.length) {
      return emptyState({
        icon: 'users',
        title: 'Todavía no hay clientes',
        text: store.farms.length
          ? 'Entra a un rancho y registra a su gente ahí.'
          : 'Registra primero un rancho: los clientes viven dentro de uno.',
        action: button(store.farms.length ? 'Registrar cliente' : 'Registrar rancho', {
          icon: 'userPlus',
          onClick: () => go(store.farms.length ? '/clients/new' : '/farms/new'),
        }),
      });
    }
    return emptyState({
      icon: 'check', title: 'Nadie en este filtro',
      text: filter === 'overdue' ? 'Nadie tiene pagos vencidos.' : 'Prueba con otro filtro.',
    });
  }

  /* --- Row ----------------------------------------------------------------- */

  /**
   * Not a single tappable row: the name opens the file, but charging and
   * managing are right here, because those are what the row is usually opened
   * for and a round trip through the file costs four taps.
   */
  function clientRow(row) {
    const { client } = row;
    const meta = STATE[row.state] || STATE.clear;
    const owes = row.owed > 0;

    return h('div.crow',
      h('button.crow__main', {
        type: 'button',
        onclick: () => go(`/clients/${client.id}`),
      },
      avatar(client.name),
      h('div.item__main',
        h('div.item__title.truncate', client.name),
        h('div.item__meta.truncate',
          [client.farmName, client.locationName].filter(Boolean).join(' · ') || 'Sin ubicación'),
        // What they cannot eat, on the row itself: the kitchen asks this far
        // more often than it opens anybody's file.
        tagList(client.tags, { max: 3 })),
      h('div.crow__state',
        owes
          ? h('span.w-700', money(row.owed, { round: true }))
          : null,
        badge(meta.label, meta.tone),
        h('span.t-xs.c-faint.truncate', standing(row)))),

      h('div.crow__acts',
        client.status === 'inactive' ? null : button('', {
          variant: owes ? 'primary' : 'soft', size: 'sm', icon: 'cash',
          className: 'crow__pay', onClick: () => charge(row),
        }),
        button('', { variant: 'quiet', size: 'sm', icon: 'more', onClick: () => manage(row) })));
  }

  /** The one line under the badge: what this person's fortnight looks like. */
  function standing(row) {
    if (row.hasGap) {
      const [first] = [
        row.gaps.noPlace && 'sin ubicación',
        row.gaps.noPlan && 'sin precio en su plan',
      ].filter(Boolean);
      return `Revisar: ${first}`;
    }
    // A last day already written down is the most important thing about this
    // person today: it changes who cooks for them tomorrow.
    if (row.endsOn && row.serving === 'active') {
      return `Termina ${humanDelta(row.daysLeft)} · ${formatDay(row.endsOn)}`;
    }
    if (row.owed > 0) {
      const due = row.billing?.dueDate;
      return `${owedBreakdown(row.billing?.outstanding)} · ${row.state === 'overdue'
        ? `venció ${humanDelta(daysBetween(today(), due))}`
        : `vence ${formatDay(due)}`}`;
    }
    if (row.serving === 'inactive') {
      return row.endsOn ? `Terminó el ${formatDay(row.endsOn)}` : 'Ya no recibe comida';
    }
    if (row.serving === 'paused') return 'Sin entregas por ahora';
    if (row.covered) return `Pagado hasta ${formatDay(row.paidThrough)}`;
    return `Paga el ${formatDay(row.payDay)}`;
  }

  /* --- Automation ---------------------------------------------------------- */

  /**
   * Fortnights that ended without a bill.
   *
   * Looked for once when the roster opens rather than waiting to be asked:
   * this is the money most easily lost, and the only reason it was ever lost
   * is that pressing the button was somebody's job to remember.
   */
  function billingBanner() {
    if (!store.loaded.clients || !store.loaded.pricing) return null;

    if (pending === null && !scanning) {
      scanning = true;
      pendingBilling(store.clients, store.pricing)
        .then((found) => { pending = found; })
        .catch(() => { pending = { rows: [], total: 0, periods: 0, unpriced: [], skipped: {} }; })
        .finally(() => {
          scanning = false;
          // Reading every client's periods takes a moment, and the manager does
          // not wait for it — she taps somebody and is three screens away by
          // the time it lands. Painting then would drag the roster back over
          // whatever she opened.
          if (life.alive()) draw();
        });
      return null;
    }
    if (!pending?.rows.length) return null;

    return actionBanner({
      tone: 'brand', icon: 'receipt',
      title: `${plural(pending.rows.length, 'factura por emitir', 'facturas por emitir')}`,
      text: `${plural(pending.periods, 'periodo cerrado', 'periodos cerrados')} sin facturar · `
        + `${moneyFull(pending.total)} que todavía no se cobran.`,
      cta: 'Revisar y emitir',
      onClick: reviewPending,
    });
  }

  function remindBanner(overdue) {
    const total = overdue.reduce((sum, row) => sum + row.owed, 0);
    return actionBanner({
      tone: 'bad', icon: 'alert',
      title: `${plural(overdue.length, 'cliente con pago vencido', 'clientes con pago vencido')}`,
      text: `${money(total)} vencidos. Puedes recordarles a todos de una vez.`,
      cta: 'Recordar a todos',
      onClick: () => remindAll(overdue),
    });
  }

  const actionBanner = ({ tone, icon: ico, title, text, cta, onClick }) =>
    h('div.card.card--tight', {
      style: { borderColor: `var(--${tone}-500)`, borderLeftWidth: '4px' },
    },
    h('div.row.row--top',
      h('span', { style: { color: `var(--${tone}-500)`, marginTop: '2px' } }, icon(ico)),
      h('div.grow',
        h('div.w-600', title),
        h('div.t-sm.c-soft', { style: { marginTop: '1px' } }, text)),
      button(cta, { variant: 'soft', size: 'sm', onClick })));

  /** Shows the whole run before writing a single bill. */
  async function reviewPending() {
    const { rows, total, unpriced, skipped } = pending;
    const left = (skipped?.paid || 0) + (skipped?.notYet || 0) + (skipped?.ended || 0);

    const ok = await sheet({
      title: 'Periodos sin facturar',
      build: (close) => h('div.stack.stack-4',
        alert(`Se emitirán ${plural(rows.length, 'factura', 'facturas')} por ${moneyFull(total)}, `
          + 'al precio del plan de cada quien.', 'brand', 'receipt'),
        unpriced.length
          ? alert(`${plural(unpriced.length, 'cliente queda', 'clientes quedan')} fuera por no tener `
            + 'precio en su plan. Ponlo en Ajustes → Precios.', 'warn')
          : null,
        card(h('div.stack.stack-2', byFarm(rows).map((farm) => h('div.row.row--between',
          h('span.truncate', farm.name),
          h('span.w-600', `${plural(farm.count, 'factura', 'facturas')} · ${money(farm.amount)}`))))),

        // What the scan chose not to bill, and why. A run that quietly drops
        // half its work reads as if there was never anything there.
        left
          ? h('div.stack.stack-1',
              h('div.t-xs.upper.c-faint.w-700', 'Se dejaron fuera'),
              skipped.paid
                ? h('p.t-sm.c-soft', `${plural(skipped.paid, 'periodo ya cubierto', 'periodos ya cubiertos')} `
                  + 'por lo que pagaron antes del sistema.')
                : null,
              skipped.notYet
                ? h('p.t-sm.c-soft', `${plural(skipped.notYet, 'periodo anterior', 'periodos anteriores')} `
                  + 'a la fecha en que esas personas empezaron a comer aquí.')
                : null,
              skipped.ended
                ? h('p.t-sm.c-soft', `${plural(skipped.ended, 'periodo posterior', 'periodos posteriores')} `
                  + 'al último día de personas que ya terminaron.')
                : null)
          : null,

        h('p.t-xs.c-faint', 'Sólo se factura a quien recibió comida en el periodo, cada quien '
          + 'con el suyo: semanal o quincenal. Un periodo que ya tenía factura no se toca.'),
        button('Emitir las facturas', {
          variant: 'primary', block: true, onClick: () => close(true),
        })),
    });
    if (!ok) return;

    try {
      const issued = await issueAll(rows, author());
      pending = null;
      toastOk(`${plural(issued, 'factura emitida', 'facturas emitidas')}`);
      // Writing a few hundred bills takes a while; the toast still belongs to
      // her wherever she is, but the roster only paints if it is still hers.
      if (life.alive()) draw();
    } catch (error) {
      toastBad(dbMessage(error));
    }
  }

  /** One message each, sent in one go, saying what they owe and by when. */
  async function remindAll(overdue) {
    const ok = await confirm({
      title: 'Recordar a todos',
      message: `Se enviará un mensaje a ${plural(overdue.length, 'cliente', 'clientes')} con su saldo `
        + 'y su fecha vencida. Les llega en su app, en su propio chat.',
      confirmLabel: 'Enviar recordatorios',
      icon: 'chat',
    });
    if (!ok) return;

    let sent = 0;
    for (const row of overdue) {
      const due = row.billing?.dueDate;
      try {
        await postSystemMessage(row.client.id,
          `Recordatorio: tiene ${money(row.owed)} pendientes de pago`
          + `${due ? `, vencidos desde el ${formatDay(due)}` : ''}. `
          + 'Puede pagar en la cocina cuando guste; ahí mismo le damos su recibo.',
          { meta: { kind: 'reminder', amount: row.owed }, notify: true });
        sent += 1;
      } catch {
        // One failed message must not stop the other nineteen.
      }
    }
    toastOk(`${plural(sent, 'recordatorio enviado', 'recordatorios enviados')}`);
  }

  /* --- Per-client actions --------------------------------------------------- */

  async function charge(row) {
    const receipt = await openChargeSheet({
      client: row.client,
      invoices: invoicesFor(row.client.id),
      pricing: store.pricing,
      author: author(),
    });
    if (receipt) go(`/receipts/${receipt.id}`);
  }

  /** Money they owe that no fortnight produced — a bag of something, a repair. */
  async function addDebt(row) {
    await openDebtSheet({
      client: row.client,
      invoices: invoicesFor(row.client.id),
      author: author(),
    });
  }

  /** Everything you can do to somebody without leaving the list. */
  async function manage(row) {
    const { client } = row;

    await sheet({
      title: client.name,
      build: (close) => h('div.stack.stack-3',
        h('p.t-sm.c-soft',
          [client.farmName, client.locationName].filter(Boolean).join(' · ')
          + ` · ${plural(client.mealsPerDay, 'comida', 'comidas')}/día`),

        row.owed > 0
          ? alert(`Debe ${money(row.owed)} en ${owedBreakdown(row.billing?.outstanding)}.`,
              row.state === 'overdue' ? 'bad' : 'warn')
          : row.covered
            ? alert(`Pagado hasta el ${formatDay(row.paidThrough)}.`, 'ok')
            : null,

        button('Cobrar', {
          variant: 'primary', block: true, icon: 'cash',
          onClick: () => { close(); charge(row); },
        }),
        button('Agregar una deuda', {
          variant: 'ghost', block: true, icon: 'plus',
          onClick: () => { close(); addDebt(row); },
        }),
        button('Ver ficha completa', {
          variant: 'ghost', block: true, icon: 'users',
          onClick: () => { close(); go(`/clients/${client.id}`); },
        }),
        button('Enviar mensaje', {
          variant: 'ghost', block: true, icon: 'chat',
          onClick: () => { close(); go(`/chat/${client.id}`); },
        }),
        button('Editar', {
          variant: 'ghost', block: true, icon: 'edit',
          onClick: () => { close(); go(`/clients/${client.id}/edit`); },
        }),

        h('div.divider'),

        // "Pagó y se va el jueves" — two taps, from the list, without opening
        // anybody's file. It is the thing a manager is told at the gate.
        h('div.stack.stack-2',
          h('div.t-xs.upper.c-faint.w-700',
            client.endsOn ? `Termina el ${formatDay(client.endsOn)}` : 'Último día que se le sirve'),
          h('div.row.row--wrap', { style: { gap: '6px' } },
            [['Hoy', 0], ['Mañana', 1], ['En 2 días', 2], ['En 3 días', 3], ['En 7 días', 7]].map(
              ([label, days]) => button(label, {
                variant: 'soft', size: 'sm',
                onClick: async () => { close(); await lastDay(client, addDays(today(), days)); },
              })),
            client.endsOn
              ? button('Quitar', {
                  variant: 'ghost', size: 'sm',
                  onClick: async () => { close(); await lastDay(client, ''); },
                })
              : null)),

        h('div.divider'),
        statusButton(client, close)),
    });
  }

  async function lastDay(client, endsOn) {
    try {
      await setEndsOn(client.id, endsOn);
      toastOk(endsOn
        ? `${client.name} termina el ${formatDayLong(endsOn)}`
        : `${client.name} sigue sin fecha de término`);
    } catch (error) { toastBad(dbMessage(error)); }
  }

  /**
   * Pausing and reactivating, from the row.
   *
   * Paused is the one that matters day to day — somebody goes home for three
   * weeks — and it is reversible, so it does not ask for confirmation.
   * Inactive ends the relationship, so it does.
   */
  function statusButton(client, close) {
    if (client.status === 'active') {
      return h('div.stack.stack-2',
        button('Poner en pausa', {
          variant: 'ghost', block: true, icon: 'pause',
          onClick: async () => { close(); await setStatus(client, 'paused', 'Cliente en pausa'); },
        }),
        button('Marcar inactivo', {
          variant: 'danger-soft', block: true, icon: 'ban',
          onClick: async () => {
            close();
            if (!await confirm({
              title: `Marcar inactivo a ${client.name}`,
              message: 'Deja de aparecer en las rutas y no se le vuelve a facturar. Lo que deba '
                + 'sigue registrado y su historial se conserva.',
              confirmLabel: 'Marcar inactivo', tone: 'danger', icon: 'ban',
            })) return;
            await setStatus(client, 'inactive', 'Cliente inactivo');
          },
        }));
    }

    return button(client.status === 'paused' ? 'Reactivar' : 'Volver a activar', {
      variant: 'ok', block: true, icon: 'play',
      onClick: async () => { close(); await setStatus(client, 'active', 'Cliente activo'); },
    });
  }

  async function setStatus(client, status, message) {
    try {
      await setClientStatus(client.id, status);
      toastOk(message);
    } catch (error) { toastBad(dbMessage(error)); }
  }

  return life.ending(subscribe(draw));
}
