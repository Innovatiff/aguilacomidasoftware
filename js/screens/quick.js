/**
 * Acción rápida — the counter.
 *
 * A grid of big tiles on the store's point-of-sale screen, each one an action
 * that runs as a short sequence of questions. It is a second face on the same
 * data, not a second app: every tile ends in the same functions the panel
 * calls, so a payment taken here and a payment taken there are the same
 * payment.
 *
 * The tiles are ordered by how often they are pressed, not by category.
 * Cobrar is first and twice the size of anything else, because at a counter it
 * is most of the day.
 *
 * Nothing here can do the things that are somebody's job to think about —
 * deleting a person, editing the price list, closing a fortnight for everybody.
 * Those stay in the panel, on the manager's screen, where there is room to read
 * what they are about to do.
 */

import { h, mount } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { screen } from '../ui/shell.js';
import { emptyState, button } from '../ui/kit.js';
import { go } from '../lib/router.js';
import { session } from '../data/session.js';
import { runFlow } from '../ui/flow.js';
import {
  posTile, posPick, posFind, posMoney, posDays, posSummary, posNote, posField, posText,
} from '../ui/pos-kit.js';
import {
  store, subscribe, billingFor, farmById, periodPrice, printContext, activeClients,
} from '../data/store.js';
import {
  createClient, updateClient, setClientStatus, setEndsOn, cycleIsSet, emptyClient,
} from '../data/clients.js';
import { takePayment, addCharge, adjustBalance } from '../data/invoices.js';
import { watchReceiptsOn, totalOf, cancelledIds } from '../data/receipts.js';
import { printReceipt } from '../ui/print.js';
import {
  periodOf, payDayAfter, payDayOnOrBefore, cycleFromPayment, isPayDay, payDaysInWords,
  PAY_EVERY, payEveryOf, periodWord, periodWordPlural, cadenceWord,
} from '../lib/billing.js';
import { periodCharge, tierFor } from '../lib/pricing.js';
import { money, plural } from '../lib/format.js';
import { kitchen } from '../lib/mode.js';
import { seatedPacker, sitDown, watchPackers } from '../data/packing.js';
import { abilitiesOf } from '../lib/packing.js';
import { createFarm, newLocationId } from '../data/farms.js';
import { paymentMethodMeta } from '../lib/model.js';
import {
  today, addDays, formatDay, formatDayLong, weekdayName, capitalize, WEEKDAYS_SHORT,
} from '../lib/dates.js';

/**
 * The width below which the counter screen is not offered.
 *
 * 900px is the panel's own breakpoint — the width at which the tab bar becomes
 * a rail — so the app has one idea of "small", not two. Below it this screen
 * cannot be what it is: the tiles are three across, the keypad is a grid of
 * twelve, and Atrás and Siguiente sit side by side at 62px tall. Squeezed onto
 * a phone all of that becomes exactly the cramped, mis-tappable thing it was
 * built to replace — and on a phone the ordinary panel is already good.
 *
 * `css/pos.css` hides the way in below the same number. Change both together.
 */
export const POS_MIN_WIDTH = 900;

const wideEnough = () => window.innerWidth >= POS_MIN_WIDTH;

/**
 * Whose name goes on what is done here.
 *
 * At the counter that is the signed-in account. In the kitchen everybody works
 * under the same account, so the account's name says nothing — the person who
 * typed their PIN does, and theirs is the name that goes on the farm they
 * registered or the client they put on pause.
 */
const author = () => {
  const person = kitchen() ? seatedPacker() : null;
  return { uid: session.uid, name: person?.name || session.displayName };
};
const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
const owedBy = (client) => billingFor(client)?.balance || 0;

export function renderQuick() {
  // On a kitchen computer this menu belongs to whoever typed their number.
  // Reached without one — a reload, a bookmark, somebody's first morning —
  // it sends them to the keypad rather than opening nameless.
  if (kitchen() && !seatedPacker()) { go('/empaque'); return undefined; }

  let panel = null;
  // The action running on top, if any — so a window that shrinks below the
  // threshold can close it rather than leave it squeezed.
  let flow = null;
  // What has come in today. A till closes on this number, and the tile grid
  // was leaving the room for it empty. The kitchen's menu takes no money and
  // shows no takings, so it does not read the receipts at all.
  let takings = [];

  const stopTill = kitchen()
    ? null
    : watchReceiptsOn(today(), (rows) => { takings = rows; paintTiles(); }, () => {});

  /*
   * Who is sitting at the kitchen computer, and what they are allowed — read
   * live, not remembered from when they typed their number.
   *
   * The manager changes a permission in the panel and the next tile this
   * person reaches for is already gone, without anybody having to log out.
   * Switched off or removed while still sitting here, they go back to the
   * keypad: a menu for somebody who no longer works here is not a menu that
   * should still be open.
   */
  const me = seatedPacker();
  let allowed = null;
  const stopUsers = kitchen()
    ? watchPackers((rows) => {
      // An empty list is the cache answering before the server has; a real
      // list always contains the person who just typed their number.
      if (!rows.length) return;
      const found = rows.find((row) => row.id === me?.id);
      if (!found || found.active === false) {
        sitDown(null);
        go('/empaque');
        return;
      }
      allowed = abilitiesOf(found);
      paintTiles();
    }, () => {})
    : null;

  /** Panel wording at the counter, kitchen wording in the kitchen. */
  const w = (panelWords, kitchenWords) => (kitchen() ? kitchenWords : panelWords);
  const mealsWord = (n) => plural(n, w('comida', 'pedido'), w('comidas', 'pedidos'));

  const stop = subscribe(() => {
    // Only the tile grid depends on the store; a flow running on top owns its
    // own copy of what it needs and must not be torn out from under a hand.
    if (panel && !document.querySelector('.pos--flow')) paintTiles();
  });

  /**
   * Two screens behind one address.
   *
   * Wide enough, and this is the counter. Too narrow — a phone, or a laptop
   * window dragged small — and it says so and points back, rather than drawing
   * a POS nobody can hit. Re-decided on resize because the second case is
   * something somebody does *while* it is open.
   */
  function apply() {
    if (wideEnough()) { mountPos(); return; }
    unmountPos();
    screen({
      title: kitchen() ? 'Empaque' : 'Acción rápida',
      backTo: kitchen() ? '/empaque' : '/',
      tab: 'home',
      body: h('div.page__inner', emptyState({
        icon: 'bolt',
        title: 'Es para la pantalla de la tienda',
        text: 'Acción rápida está hecha para la computadora del mostrador: botones grandes, '
          + 'un teclado numérico y una pregunta por pantalla. En el teléfono no cabe, y aquí '
          + 'el panel normal hace lo mismo con menos vueltas.',
        action: kitchen()
          ? button('Ir a Empaque', {
            variant: 'primary', block: true, icon: 'box', onClick: () => go('/empaque'),
          })
          : button('Ir a Clientes', {
            variant: 'primary', block: true, icon: 'users', onClick: () => go('/clients'),
          }),
      })),
    });
  }

  function mountPos() {
    if (panel) return;
    const cocina = kitchen();
    screen({ title: cocina ? 'Empaque' : 'Acción rápida', hideTabs: true, body: h('div') });

    panel = h('div.pos.pos--home',
      h('header.pos__bar',
        // In the panel the button on the left is the way out. On a kitchen
        // computer there is nothing to go out to, so the same slot says who
        // is sitting there — and pressing it is how the next person takes
        // over, which is the only thing anybody wants from it.
        cocina ? whoButton() : h('button.pos__exit', { type: 'button', onclick: () => go('/') },
          icon('chevronL'), h('span', 'Salir')),
        h('span.pos__mark', icon('eagle')),
        h('span.pos__title', cocina ? 'Empaque' : 'Acción rápida'),
        h('span.pos__day', capitalize(formatDayLong(today())))),
      h('div.pos__body', h('div.pos__inner', { id: 'quick-tiles' })));

    document.body.append(panel);
    paintTiles();
  }

  /** The name on the bar, and the way to hand the machine to somebody else. */
  function whoButton() {
    const me = seatedPacker();
    return h('button.pos__exit.pos__exit--who', {
      type: 'button',
      onclick: () => { sitDown(null); go('/empaque'); },
    },
    icon('users'),
    h('span.pos__me',
      h('strong', me?.name || 'Sin nombre'),
      h('em', 'Cambiar')));
  }

  function unmountPos() {
    flow?.close();
    flow = null;
    panel?.remove();
    panel = null;
  }

  /** Runs one action, remembering it so a shrinking window can close it. */
  function start(config) {
    flow = runFlow({ ...config, onExit: () => { flow = null; paintTiles(); } });
  }

  // Cheap and unthrottled would run on every pixel of a drag; a frame's delay
  // is invisible and turns a drag into one decision.
  let resizeTimer;
  const onResize = () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(apply, 150);
  };
  window.addEventListener('resize', onResize);

  apply();

  function paintTiles() {
    // The receipts listener is attached before the panel is built, and can
    // answer before it exists — from the local cache, on the second visit.
    if (!panel) return;
    const host = panel.querySelector('#quick-tiles');
    if (!host) return;
    const ready = store.loaded.clients && store.loaded.farms;

    const tileCharge = () => posTile({
      icon: 'cash', title: 'Cobrar',
      sub: 'Registrar un pago',
      hero: true,
      onClick: () => ready && flowCharge(),
    });
    const tileMeals = () => posTile({
      icon: 'utensils', title: 'Cambiar comidas', family: 'plan',
      sub: '1 ó 2 al día',
      onClick: () => ready && flowMeals(),
    });

    if (kitchen()) {
      mount(host, ...kitchenBoard(ready));
      return;
    }

    mount(host,
      h('h2.pos__q', '¿Qué vas a hacer?'),
      h('p.pos__hint', ready
        ? `${plural(store.clients.length, 'cliente', 'clientes')} · se cobra en ${payDaysInWords()}`
        : 'Cargando…'),

      // At the counter the top row is Cobrar, twice the size of anything else,
      // because at a counter that is most of the day.
      h('div.postiles.postiles--2', { style: { marginBottom: '14px' } },
        tileCharge(), tileMeals()),

      h('div.postiles.postiles--4',
        posTile({
          icon: 'calendar', title: 'Cambiar días', family: 'plan',
          sub: 'Qué días come',
          onClick: () => ready && flowWeek(),
        }),
        posTile({
          icon: 'clock', title: 'Cambiar periodo', family: 'plan',
          sub: 'Semanal o quincenal',
          onClick: () => ready && flowCycle(),
        }),
        // The two money corrections next to each other, and the three that
        // change who is eating next to each other. Four across, so the row
        // break falls between the two groups rather than through one.
        posTile({
          icon: 'plus', title: 'Agregar deuda', family: 'money',
          sub: 'Un cargo aparte',
          onClick: () => ready && flowDebt(),
        }),
        posTile({
          icon: 'edit', title: 'Corregir saldo', family: 'money',
          sub: 'Dejarlo en lo correcto',
          onClick: () => ready && flowBalance(),
        }),
        posTile({
          icon: 'userPlus', title: 'Nuevo cliente', family: 'who',
          sub: 'Dar de alta',
          onClick: () => ready && flowNew(),
        }),
        posTile({
          icon: 'pause', title: 'Pausar o reactivar', family: 'who',
          sub: 'Deja o vuelve a comer',
          onClick: () => ready && flowStatus(),
        }),
        posTile({
          icon: 'ban', title: 'Último día', family: 'who',
          sub: 'Hasta cuándo come',
          onClick: () => ready && flowLastDay(),
        })),

      tillStrip());
  }

  /**
   * The kitchen's menu: packing first, then what the kitchen looks after.
   *
   * It is a different menu from the counter's, not the same one with things
   * hidden. The kitchen takes no money, so there is no Cobrar, no debts or
   * balances and no takings strip; what it does is pack, register farms and
   * people, and keep each person's week of orders straight — so those are the
   * buttons, and in the kitchen's own words: pedidos, farmas.
   *
   * Laid out as two columns under Empacar, each a thing you can find without
   * reading: the farm and the schedule on the left — with Cantidad de pedidos
   * right under Calendario semanal, because they are the same question asked
   * two ways — and the people on the right.
   *
   * **Each person sees only what they are allowed.** A button somebody may not
   * use is not shown greyed out; it is not shown. A menu full of things you
   * cannot press is a menu you have to read every morning to find the ones you
   * can.
   */
  function kitchenBoard(ready) {
    const tile = {
      pack: () => posTile({
        icon: 'box', title: 'Empacar',
        sub: 'La comida de hoy, farma por farma',
        hero: true, band: true,
        onClick: () => go('/empaque'),
      }),
      newFarm: () => posTile({
        icon: 'farm', title: 'Nueva farma', family: 'plan',
        sub: 'Darla de alta con sus ubicaciones',
        onClick: () => ready && flowNewFarm(),
      }),
      week: () => posTile({
        icon: 'calendar', title: 'Calendario semanal', family: 'plan',
        sub: 'Qué días hay pedido',
        onClick: () => ready && flowWeek(),
      }),
      meals: () => posTile({
        icon: 'utensils', title: 'Cantidad de pedidos', family: 'plan',
        sub: '1 ó 2 al día',
        onClick: () => ready && flowMeals(),
      }),
      newClient: () => posTile({
        icon: 'userPlus', title: 'Nuevo cliente', family: 'who',
        sub: 'Dar de alta',
        onClick: () => ready && flowNew(),
      }),
      status: () => posTile({
        icon: 'pause', title: 'Pausar o reactivar', family: 'who',
        sub: 'Deja o vuelve a pedir',
        onClick: () => ready && flowStatus(),
      }),
      lastDay: () => posTile({
        icon: 'ban', title: 'Último día de pedido', family: 'who',
        sub: 'Hasta cuándo pide',
        onClick: () => ready && flowLastDay(),
      }),
    };

    // Until the user's record has loaded, nothing is offered — better a beat
    // of "cargando" than a button that vanishes as somebody reaches for it.
    if (!allowed) return [h('h2.pos__q', 'Un momento…'), h('p.pos__hint', 'Cargando tu menú.')];

    const ok = (key) => allowed[key] === true;
    const left = ['newFarm', 'week', 'meals'].filter(ok);
    const right = ['newClient', 'status', 'lastDay'].filter(ok);

    // Counted over the same people as the number beside it: a farm whose
    // people have all stopped ordering is not one the kitchen packs for.
    const eating = activeClients();
    const farmsCount = new Set(eating.map((client) => client.farmId)).size;

    const nothing = !ok('pack') && !left.length && !right.length;
    if (nothing) {
      return [
        h('h2.pos__q', `Hola, ${firstName(me)}`),
        h('div.posnote.posnote--warn', icon('alert'),
          h('div', 'Todavía no tienes nada asignado. Pídele al encargado que te dé '
            + 'permisos desde el panel.')),
      ];
    }

    // Two columns when there is something on both sides. When there is not,
    // what is left is laid out across instead, so one person's menu is never
    // a single column hugging the left edge of a wide screen.
    const both = left.length && right.length;
    const rest = [...left, ...right];

    return [
      h('h2.pos__q', `¿Qué vas a hacer, ${firstName(me)}?`),
      h('p.pos__hint', ready
        ? `${plural(eating.length, 'cliente', 'clientes')} en `
          + `${plural(farmsCount, 'farma', 'farmas')}`
        : 'Cargando…'),

      ok('pack')
        ? h('div.postiles.postiles--1', { style: { marginBottom: '14px' } }, tile.pack())
        : null,

      both
        ? h('div.poscols',
            h('div.poscol', left.map((key) => tile[key]())),
            h('div.poscol', right.map((key) => tile[key]())))
        : rest.length
          ? h(`div.postiles.postiles--${Math.min(3, rest.length)}`, rest.map((key) => tile[key]()))
          : null,
    ];
  }

  /**
   * Today's takings — and the way back to a receipt that never got printed.
   *
   * This is the case the counter actually hits: the payment went through, the
   * operator closed the screen, and the client is still standing there wanting
   * their paper. It is a button rather than a line for exactly that.
   */
  function tillStrip() {
    const voided = cancelledIds(takings);
    const live = takings.filter((r) => Number(r.amount) > 0 && !voided.has(r.id));
    // Split, because the number that has to match the drawer at closing time is
    // the cash one — the rest of the day's takings are in the bank, not in the
    // till. This is the whole reason the counter is asked how somebody paid.
    const cash = totalOf(live.filter((r) => (r.method || 'cash') === 'cash'));
    const rest = round2(totalOf(live) - cash);

    return h('button.postill', { type: 'button', onclick: () => live.length && showTill() },
      h('span.postill__k', 'Cobrado hoy'),
      h('span.postill__v', money(totalOf(takings), { round: true })),
      live.length
        ? h('span.postill__split',
            h('span.postill__part', `Efectivo ${money(cash, { round: true })}`),
            rest > 0.005
              ? h('span.postill__part', `Otros ${money(rest, { round: true })}`)
              : null)
        : null,
      h('span.postill__n', live.length
        ? `${plural(live.length, 'pago', 'pagos')} · tócalo para reimprimir`
        : 'Sin pagos todavía'));
  }

  /** The day's receipts, each one a press away from the printer. */
  function showTill() {
    const voided = cancelledIds(takings);
    const live = takings.filter((r) => Number(r.amount) > 0 && !voided.has(r.id));

    start({
      title: 'Recibos de hoy',
      steps: () => [{
        id: 'pick',
        title: 'Reimprimir un recibo',
        hint: 'Los pagos de hoy, del más reciente al más viejo.',
        ready: () => false,
        build: () => h('div.posresults', live.map((receipt) => h('button.posperson', {
          type: 'button',
          onclick: () => printReceipt(receipt, { ...printContext(receipt), copy: true }),
        },
        h('span.posperson__mark', icon('receipt')),
        h('span.posperson__who',
          h('span.posperson__name', receipt.clientName || '—'),
          h('span.posperson__where', `${receipt.folio || ''} · ${money(receipt.amount)}`)),
        h('span.posperson__owes.posperson__owes--ok', 'Imprimir')))),
      }],
      commit: async () => null,
      done: () => ({ what: 'Listo' }),
    });
  }

  /* --- The step everything starts with ----------------------------------- */

  /** "¿Quién es?" — the same first slide in almost every action. */
  const whoStep = (hint) => ({
    id: 'who',
    title: '¿Quién es?',
    hint: hint || 'Escribe su nombre y tócalo en la lista.',
    ready: (s) => !!s.client,
    build: (s, api) => posFind({
      clients: store.clients,
      value: s.client,
      balanceOf: owedBy,
      onPick: (client) => { s.client = client; api.revalidate(); },
    }),
  });

  /** The person's name and where they are, for a confirmation table. */
  /** Feeds the bar that keeps the chosen person on screen. */
  const subjectOf = (s) => (s.client
    ? {
        name: s.client.name,
        where: [s.client.farmName, s.client.locationName].filter(Boolean).join(' · '),
      }
    : null);

  const whoRows = (client) => [
    ['Cliente', client.name],
    ['Dónde', [client.farmName, client.locationName].filter(Boolean).join(' · ') || '—'],
  ];

  /* --- Cobrar ------------------------------------------------------------- */

  function flowCharge() {
    start({
      title: 'Cobrar',
      subject: subjectOf,
      state: { amount: 0, method: null, setCycle: false },
      steps: (s) => {
        const owed = s.client ? owedBy(s.client) : 0;
        const fortnight = s.client ? periodPrice(s.client) : 0;
        return [
          whoStep('Sin escribir nada sale primero el que más debe. Escribe su nombre '
            + 'para buscarlo.'),
          {
            id: 'amount',
            title: `¿Cuánto te dio ${firstName(s.client)}?`,
            hint: owed > 0
              ? `Debe ${money(owed)}.`
              : `No debe nada: esto le paga ${periodWordPlural(s.client)} por adelantado.`,
            ready: (st) => st.amount > 0,
            next: 'Siguiente',
            build: (st, api) => posMoney({
              value: st.amount || '',
              onChange: (v) => { st.amount = v; api.revalidate(); },
              quick: [
                owed > 0.005 ? { label: `Debe ${money(owed)}`, value: owed } : null,
                fortnight
                  ? { label: `1 ${periodWord(s.client)} ${money(fortnight)}`, value: fortnight }
                  : null,
                owed > 0.005 && fortnight
                  ? { label: `Las dos ${money(round2(owed + fortnight))}`, value: round2(owed + fortnight) }
                  : null,
              ].filter(Boolean),
            }),
          },
          {
            id: 'method',
            title: '¿Cómo pagó?',
            hint: 'Queda en el recibo y en su historial.',
            ready: (st) => !!st.method,
            build: (st, api) => posPick({
              columns: 2,
              value: st.method,
              onPick: (v) => { st.method = v; api.revalidate(); },
              advance: api.next,
              options: [
                { value: 'cash', label: 'Efectivo', sub: 'Billetes en mano', icon: 'cash' },
                { value: 'debit', label: 'Débito', sub: 'Tarjeta de débito', icon: 'card' },
              ],
            }),
          },
          {
            id: 'confirm',
            title: 'Revisa antes de cobrar',
            hint: 'Si algo está mal, regresa con Atrás.',
            last: true,
            next: `Cobrar ${money(s.amount)}`,
            build: (st) => h('div',
              posSummary([
                ...whoRows(st.client),
                ['Debía', owed > 0.005 ? money(owed) : 'Nada'],
                ['Cómo pagó', paymentMethodMeta(st.method).label],
                ['Recibes', money(st.amount)],
                // The question asked back across the counter, answered before
                // the money is taken rather than after.
                [owed - st.amount > 0.005 ? 'Queda debiendo' : 'Le queda a favor',
                  money(Math.abs(round2(owed - st.amount))), { total: true }],
              ]),
              cycleChoice(st)),
          },
        ];
      },
      commit: (s) => takePayment({
        client: s.client,
        pricing: store.pricing,
        amount: s.amount,
        method: s.method || 'cash',
        date: today(),
        setCycle: s.setCycle,
      }, author()),
      done: (s, receipt) => ({
        what: `Cobrado ${money(s.amount)}`,
        who: `${s.client.name} · ${paymentMethodMeta(s.method).label} · ${receipt.folio}`,
        // The thing the person on the other side of the counter is waiting
        // for. Offered rather than fired automatically: a print dialog that
        // opens by itself is one nobody expects, and a browser can refuse a
        // print that no click asked for.
        extra: h('button.posbtn.posbtn--go', {
          type: 'button',
          onclick: () => printReceipt(receipt, printContext(receipt)),
        }, icon('receipt'), h('span', 'Imprimir recibo')),
        note: s.setCycle
          ? `Su ${periodWord(s.client)} queda en `
            + `${weekdayName(cycleFromPayment(today()))}.`
          : null,
      }),
    });
  }

  /**
   * The one decision on the confirmation slide, and only when it matters.
   *
   * Most people at this counter already have a fortnight; asking them all
   * about it every time would be a question with the same answer 300 times.
   * It appears only for somebody whose cycle has never been set.
   */
  function cycleChoice(st) {
    if (cycleIsSet(st.client)) return null;
    st.setCycle = true;
    const anchor = cycleFromPayment(today());
    return posNote(
      `Es su primer pago aquí, así que su ${periodWord(st.client)} queda en `
      + `${weekdayName(anchor)}: empieza el ${formatDay(anchor)}.`, 'ok');
  }

  /* --- Comidas al día ----------------------------------------------------- */

  function flowMeals() {
    start({
      title: w('Cambiar comidas', 'Cantidad de pedidos'),
      subject: subjectOf,
      steps: (s) => [
        whoStep(),
        {
          id: 'meals',
          title: w('¿Cuántas comidas al día?', '¿Cuántos pedidos al día?'),
          hint: s.client ? `Ahora lleva ${mealsWord(s.client.mealsPerDay)}.` : '',
          ready: (st) => st.meals > 0,
          build: (st, api) => posPick({
            columns: 3,
            value: st.meals ?? st.client.mealsPerDay,
            onPick: (v) => { st.meals = v; api.revalidate(); },
            advance: api.next,
            options: [1, 2, 3].map((n) => ({
              value: n,
              label: String(n),
              sub: priceLabel(st.client, { mealsPerDay: n }),
            })),
          }),
        },
        {
          id: 'confirm',
          title: 'Revisa el cambio',
          last: true,
          build: (st) => h('div',
            posSummary([
              ...whoRows(st.client),
              ['Antes', `${mealsWord(st.client.mealsPerDay)} · ${priceLabel(st.client)}`],
              ['Ahora', `${mealsWord(st.meals)} · ${priceLabel(st.client, { mealsPerDay: st.meals })}`,
                { total: true }],
            ]),
            tierFor(store.pricing, st.meals)
              ? null
              : posNote('Ese plan no tiene precio en Ajustes, así que no se le podrá facturar '
                + 'hasta que se lo pongan.', 'warn')),
        },
      ],
      commit: (s) => updateClient(s.client.id, { mealsPerDay: s.meals }),
      done: (s) => ({
        what: `${mealsWord(s.meals)} al día`,
        who: s.client.name,
      }),
    });
  }

  /* --- Los días que come -------------------------------------------------- */

  function flowWeek() {
    start({
      title: w('Cambiar días', 'Calendario semanal'),
      subject: subjectOf,
      steps: (s) => [
        whoStep(),
        {
          id: 'days',
          title: w('¿Qué días come?', '¿Qué días tiene pedido?'),
          hint: 'Toca un día para prenderlo o apagarlo. El precio se ajusta solo.',
          ready: (st) => (st.days || st.client.deliveryDays || []).length > 0,
          build: (st, api) => {
            st.days = st.days || [...(st.client.deliveryDays || [])];
            const price = h('div.posnote.posnote--ok', icon('info'), h('div'));
            const paintPrice = () => mount(price.lastChild,
              `Su ${periodWord(st.client)} costaría `
              + `${priceLabel(st.client, { deliveryDays: st.days })}.`);
            paintPrice();
            return h('div',
              posDays({
                days: st.days,
                onChange: (days) => { st.days = days; paintPrice(); api.revalidate(); },
              }),
              price);
          },
        },
        {
          id: 'confirm',
          title: 'Revisa el cambio',
          last: true,
          build: (st) => posSummary([
            ...whoRows(st.client),
            ['Antes', dayWords(st.client.deliveryDays)],
            ['Ahora', dayWords(st.days)],
            [`Su ${periodWord(st.client)}`,
              priceLabel(st.client, { deliveryDays: st.days }), { total: true }],
          ]),
        },
      ],
      commit: (s) => updateClient(s.client.id, { deliveryDays: s.days }),
      done: (s) => ({
        what: w('Días actualizados', 'Calendario actualizado'),
        who: `${s.client.name} · ${dayWords(s.days)}`,
      }),
    });
  }

  /* --- El día de pago ----------------------------------------------------- */

  function flowCycle() {
    start({
      title: 'Cambiar periodo',
      subject: subjectOf,
      steps: (s) => [
        whoStep(),
        {
          id: 'every',
          title: '¿Cada cuánto paga?',
          hint: s.client
            ? `Ahora paga ${cadenceWord(s.client)}.`
            : '',
          ready: (st) => !!st.payEvery,
          build: (st, api) => posPick({
            columns: 2,
            value: st.payEvery ?? payEveryOf(st.client),
            onPick: (v) => { st.payEvery = v; api.revalidate(); },
            advance: api.next,
            options: [
              {
                value: PAY_EVERY.FORTNIGHT,
                label: 'Cada quincena',
                sub: `14 días · ${priceLabel(st.client, { payEvery: PAY_EVERY.FORTNIGHT })}`,
                icon: 'calendar',
              },
              {
                value: PAY_EVERY.WEEK,
                label: 'Cada semana',
                sub: `7 días · ${priceLabel(st.client, { payEvery: PAY_EVERY.WEEK })}`,
                icon: 'clock',
              },
            ],
          }),
        },
        {
          id: 'day',
          title: `¿Qué día empieza su ${periodWord({ payEvery: s.payEvery })}?`,
          hint: `Se cobra en ${payDaysInWords()}. Normalmente es el día que pagó.`,
          ready: (st) => !!st.anchor,
          build: (st, api) => posPick({
            columns: 3,
            value: st.anchor,
            onPick: (v) => { st.anchor = v; api.revalidate(); },
            advance: api.next,
            options: nearbyPayDays().map((day) => ({
              value: day,
              label: capitalize(weekdayName(day)),
              sub: `${formatDay(day)}${day === today() ? ' · hoy' : ''}`,
            })),
          }),
        },
        {
          id: 'confirm',
          title: 'Revisa el periodo',
          last: true,
          build: (st) => {
            const after = { ...st.client, cycleAnchor: st.anchor, payEvery: st.payEvery };
            const period = periodOf(after);
            const word = periodWord(after);
            return h('div',
              posSummary([
                ...whoRows(st.client),
                ['Antes', `${capitalize(cadenceWord(st.client))} · ${priceLabel(st.client)}`],
                ['Ahora', `${capitalize(cadenceWord(after))} · ${priceLabel(after)}`],
                [`${capitalize(word)} en curso`,
                  `${formatDay(period.start)} - ${formatDay(period.end)}`],
                ['Paga otra vez',
                  `${weekdayName(payDayAfter(period))} ${formatDay(payDayAfter(period))}`,
                  { total: true }],
              ]),
              // First, because it is the line that stops an argument: half as
              // much twice as often is the same food at the same rate per
              // plate, and the amount on the next line looks wrong without it.
              st.payEvery !== payEveryOf(st.client)
                ? posNote('Es la misma comida y el mismo precio por plato: cambia cada cuándo '
                  + 'se cobra, no cuánto cuesta comer.', 'warn')
                : null,
              posNote(`De aquí en adelante su ${word} corre cada ${st.payEvery} días desde ese `
                + 'día. Pagar tarde no se lo mueve.', 'ok'));
          },
        },
      ],
      commit: (s) => updateClient(s.client.id, {
        cycleAnchor: s.anchor, payEvery: s.payEvery, cycleSetOn: today(),
      }),
      done: (s) => ({
        what: `Paga ${cadenceWord({ payEvery: s.payEvery })}`,
        who: `${s.client.name} · desde el ${formatDay(s.anchor)}`,
      }),
    });
  }

  /* --- Alta de cliente ---------------------------------------------------- */

  function flowNew() {
    start({
      title: 'Nuevo cliente',
      state: { name: '', farmId: '', locationId: '', meals: 1 },
      steps: (s) => {
        const farm = farmById(s.farmId);
        return [
          {
            id: 'name',
            title: '¿Cómo se llama?',
            hint: 'Nombre y apellido, como lo va a buscar el que cobre.',
            ready: (st) => st.name.trim().length > 1,
            build: (st, api) => posField('Nombre completo', posText({
              value: st.name,
              placeholder: 'Ej. José Hernández',
              onChange: (v) => { st.name = v; api.revalidate(); },
            })),
          },
          {
            id: 'farm',
            title: w('¿En qué rancho está?', '¿En qué farma está?'),
            ready: (st) => !!st.farmId,
            build: (st, api) => posPick({
              columns: 2,
              value: st.farmId,
              onPick: (v) => { st.farmId = v; st.locationId = ''; api.refresh(); },
              advance: api.next,
              options: store.farms.map((one) => ({
                value: one.id, label: one.name,
                sub: plural((one.locations || []).length, 'ubicación', 'ubicaciones'),
              })),
            }),
          },
          {
            id: 'place',
            title: w('¿En qué parte del rancho?', '¿En qué parte de la farma?'),
            hint: farm ? `Ubicaciones de ${farm.name}.` : '',
            ready: (st) => !!st.locationId,
            build: (st, api) => ((farm?.locations || []).length
              ? posPick({
                  columns: 2,
                  value: st.locationId,
                  onPick: (v) => { st.locationId = v; api.revalidate(); },
                  advance: api.next,
                  options: farm.locations.map((loc) => ({ value: loc.id, label: loc.name })),
                })
              : posNote(w('Ese rancho no tiene ubicaciones todavía. Se agregan desde el panel, '
                + 'en Ranchos.', 'Esa farma no tiene ubicaciones todavía. Pídele al encargado '
                + 'que se las agregue desde el panel.'), 'bad')),
          },
          {
            id: 'meals',
            title: w('¿Cuántas comidas al día?', '¿Cuántos pedidos al día?'),
            ready: (st) => st.meals > 0,
            build: (st, api) => posPick({
              columns: 3,
              value: st.meals,
              onPick: (v) => { st.meals = v; api.revalidate(); },
              advance: api.next,
              options: [1, 2, 3].map((n) => ({
                value: n,
                label: String(n),
                sub: `${money(tierFor(store.pricing, n)?.price || 0)} / quincena`,
              })),
            }),
          },
          {
            id: 'confirm',
            title: 'Revisa antes de darlo de alta',
            hint: w('Come de lunes a sábado y paga cada quincena. Los días y el periodo se '
              + 'ajustan después si hace falta.', 'Tiene pedido de lunes a sábado. Los días se '
              + 'cambian después con Calendario semanal si hace falta.'),
            last: true,
            next: 'Dar de alta',
            build: (st) => posSummary([
              ['Nombre', st.name.trim()],
              [w('Rancho', 'Farma'), farm?.name || '—'],
              ['Ubicación', (farm?.locations || []).find((l) => l.id === st.locationId)?.name || '—'],
              [w('Comidas', 'Pedidos'), `${mealsWord(st.meals)} al día`],
              ['Su quincena', money(tierFor(store.pricing, st.meals)?.price || 0), { total: true }],
            ]),
          },
        ];
      },
      commit: (s) => createClient(
        { ...emptyClient(farmById(s.farmId)), name: s.name.trim(), locationId: s.locationId, mealsPerDay: s.meals },
        farmById(s.farmId), author()),
      done: (s) => ({ what: 'Cliente dado de alta', who: s.name.trim() }),
    });
  }

  /* --- Nueva farma -------------------------------------------------------- */

  /**
   * A farm, from the kitchen: its name and its locations, and nothing else.
   *
   * That is all the kitchen needs to start registering people there today.
   * Everything a farm also has — who to call, the delivery window, when it is
   * billed — takes the values every new farm starts with and is filled in from
   * the panel by somebody sitting down; the last slide says so, so nobody
   * leaves thinking the farm is finished when it is only started.
   *
   * At least one location, because a person cannot be registered at a farm
   * that has nowhere to put them, and the next thing anybody does after this
   * is register a person.
   */
  function flowNewFarm() {
    const sameName = (a, b) => String(a || '').trim().toLowerCase()
      === String(b || '').trim().toLowerCase();

    start({
      title: 'Nueva farma',
      state: { name: '', places: [] },
      steps: () => [
        {
          id: 'name',
          title: '¿Cómo se llama la farma?',
          hint: 'Como la conocen en la cocina. Ej. #332 Morsea.',
          ready: (st) => st.name.trim().length > 1
            && !store.farms.some((farm) => sameName(farm.name, st.name)),
          build: (st, api) => {
            // The warning is redrawn as they type, not the box — rebuilding the
            // box would take the cursor out of it after every letter.
            const warning = h('div');
            const paintWarning = () => {
              const taken = store.farms.find((farm) => sameName(farm.name, st.name));
              mount(warning, taken
                ? posNote(`Ya hay una farma que se llama ${taken.name}.`, 'bad')
                : null);
            };
            paintWarning();
            return h('div',
              posField('Nombre de la farma', posText({
                value: st.name,
                placeholder: 'Ej. #332 Morsea',
                onChange: (v) => { st.name = v; paintWarning(); api.revalidate(); },
              })),
              warning);
          },
        },
        {
          id: 'places',
          title: '¿Qué ubicaciones tiene?',
          hint: 'Escribe una y toca Agregar. Casa 1, Bloque Norte, Invernadero 3…',
          ready: (st) => st.places.length > 0,
          build: (st, api) => {
            const list = h('div.posplaces');
            const warning = h('div');
            const box = posText({
              value: '',
              placeholder: 'Ej. Casa 1',
              onChange: () => mount(warning),
              onkeydown: (event) => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                add();
              },
            });

            function add() {
              const label = box.value.trim().replace(/\s+/g, ' ');
              if (!label) return;
              if (st.places.some((one) => sameName(one, label))) {
                mount(warning, posNote(`${label} ya está en la lista.`, 'bad'));
                return;
              }
              st.places.push(label);
              box.value = '';
              box.focus();
              paint();
              api.revalidate();
            }

            function paint() {
              mount(list, st.places.map((label, i) => h('div.posplace',
                h('span.posplace__n', String(i + 1)),
                h('span.posplace__name', label),
                h('button.posplace__x', {
                  type: 'button',
                  'aria-label': `Quitar ${label}`,
                  onclick: () => {
                    st.places.splice(i, 1);
                    paint();
                    api.revalidate();
                  },
                }, icon('x')))));
            }
            paint();

            return h('div',
              h('div.posadd',
                h('div.grow', posField('Ubicación', box)),
                h('button.posbtn.posbtn--add', { type: 'button', onclick: add },
                  icon('plus'), 'Agregar')),
              warning,
              list);
          },
        },
        {
          id: 'confirm',
          title: 'Revisa antes de darla de alta',
          last: true,
          next: 'Dar de alta',
          build: (st) => h('div',
            posSummary([
              ['Farma', st.name.trim()],
              ['Ubicaciones', st.places.join(' · ')],
              ['Días de pedido', 'Lunes a sábado', { total: true }],
            ]),
            posNote('El contacto, el teléfono y el horario de entrega se completan '
              + 'después desde el panel. Ya puedes darle de alta gente aquí.', 'ok')),
        },
      ],
      commit: (s) => createFarm({
        name: s.name.trim(),
        locations: s.places.map((label) => ({ id: newLocationId(), name: label })),
      }, author()),
      done: (s) => ({
        what: 'Farma dada de alta',
        who: `${s.name.trim()} · ${plural(s.places.length, 'ubicación', 'ubicaciones')}`,
      }),
    });
  }

  /* --- Una deuda aparte --------------------------------------------------- */

  function flowDebt() {
    start({
      title: 'Agregar deuda',
      subject: subjectOf,
      state: { amount: 0, reason: '' },
      steps: (s) => [
        whoStep(),
        {
          id: 'amount',
          title: '¿De cuánto es la deuda?',
          ready: (st) => st.amount > 0,
          build: (st, api) => posMoney({
            value: st.amount || '',
            onChange: (v) => { st.amount = v; api.revalidate(); },
          }),
        },
        {
          id: 'reason',
          title: '¿De qué es?',
          hint: 'Lo verá el cliente en su app, junto al monto.',
          ready: (st) => st.reason.trim().length > 1,
          build: (st, api) => h('div',
            posField('Motivo', posText({
              value: st.reason,
              placeholder: 'Ej. una caja de refrescos',
              maxlength: 80,
              onChange: (v) => { st.reason = v; api.revalidate(); },
            })),
            h('div.poschips', { style: { marginTop: '14px' } },
              ['Comida extra', 'Refrescos', 'Ajuste de saldo'].map((text) => h('button.poschip', {
                type: 'button',
                onclick: () => { st.reason = text; api.refresh(); },
              }, text)))),
        },
        {
          id: 'confirm',
          title: 'Revisa la deuda',
          last: true,
          next: `Agregar ${money(s.amount)}`,
          build: (st) => posSummary([
            ...whoRows(st.client),
            ['Motivo', st.reason.trim()],
            ['Debía', money(owedBy(st.client))],
            ['Va a deber', money(round2(owedBy(st.client) + st.amount)), { total: true }],
          ]),
        },
      ],
      commit: (s) => addCharge(
        { client: s.client, amount: s.amount, reason: s.reason.trim(), date: today() }, author()),
      done: (s) => ({ what: `Deuda de ${money(s.amount)}`, who: `${s.client.name} · ${s.reason.trim()}` }),
    });
  }

  /* --- Corregir el saldo --------------------------------------------------- */

  /**
   * Putting what somebody owes on the right number, at the counter.
   *
   * The argument this settles happens here, not at the desk: "yo ya pagué esa
   * quincena", "me cobraron doble". Adding a debt only goes up, so until now
   * the counter could not answer it at all.
   *
   * The manager types the total the person should owe — not the difference,
   * which is the arithmetic nobody wants to do with somebody waiting — and says
   * why. Every account it touches keeps the note.
   */
  function flowBalance() {
    start({
      title: 'Corregir saldo',
      subject: subjectOf,
      state: { target: null, note: '' },
      steps: (s) => [
        whoStep('Sin escribir nada sale primero el que más debe. Escribe su nombre '
          + 'para buscarlo.'),
        {
          id: 'target',
          title: '¿Cuánto debe en realidad?',
          hint: s.client
            ? `Ahora debe ${money(owedBy(s.client))}. Escribe el total correcto, no la diferencia.`
            : '',
          ready: (st) => st.target !== null && st.target >= 0,
          build: (st, api) => h('div',
            posMoney({
              value: st.target ?? owedBy(st.client),
              onChange: (v) => { st.target = v; api.revalidate(); },
            }),
            h('div.poschips', { style: { marginTop: '14px' } },
              h('button.poschip', {
                type: 'button',
                onclick: () => { st.target = 0; api.refresh(); },
              }, 'No debe nada'))),
        },
        {
          id: 'note',
          title: '¿Por qué?',
          hint: 'Queda guardado en cada cuenta que se toque, con tu nombre y la fecha.',
          ready: (st) => st.note.trim().length > 1,
          build: (st, api) => h('div',
            posField('Motivo', posText({
              value: st.note,
              placeholder: 'Ej. la quincena de agosto se cobró doble',
              maxlength: 90,
              onChange: (v) => { st.note = v; api.revalidate(); },
            })),
            h('div.poschips', { style: { marginTop: '14px' } },
              ['Se le cobró de más', 'Corrección del cuaderno', 'Descuento acordado']
                .map((text) => h('button.poschip', {
                  type: 'button',
                  onclick: () => { st.note = text; api.refresh(); },
                }, text)))),
        },
        {
          id: 'confirm',
          title: 'Revisa el saldo',
          last: true,
          build: (st) => {
            const was = owedBy(st.client);
            const difference = round2(st.target - was);
            return h('div',
              posSummary([
                ...whoRows(st.client),
                ['Motivo', st.note.trim()],
                ['Debía', money(was)],
                [difference > 0 ? 'Se le suman' : 'Se le bajan', money(Math.abs(difference))],
                ['Va a deber', money(st.target), { total: true }],
              ]),
              difference > 0
                ? posNote('Se le agrega una deuda nueva por la diferencia, con ese motivo.', 'ok')
                : posNote('Se baja de sus cuentas más recientes. Lo que ya está pagado no se '
                  + 'toca: para devolver dinero hay que cancelar el pago.', 'ok'));
          },
        },
      ],
      commit: (s) => adjustBalance(
        { client: s.client, target: s.target, note: s.note.trim() }, author()),
      done: (s) => ({
        what: `Saldo en ${money(s.target)}`,
        who: `${s.client.name} · ${s.note.trim()}`,
      }),
    });
  }

  /* --- Pausar o reactivar ------------------------------------------------- */

  function flowStatus() {
    start({
      title: 'Pausar o reactivar',
      subject: subjectOf,
      steps: (s) => [
        whoStep(),
        {
          id: 'status',
          title: '¿Qué pasa con esta persona?',
          hint: s.client ? `Ahora está ${statusWord(s.client.status)}.` : '',
          ready: (st) => !!st.status,
          build: (st, api) => posPick({
            columns: 3,
            value: st.status || st.client.status,
            onPick: (v) => { st.status = v; api.revalidate(); },
            advance: api.next,
            options: [
              { value: 'active', label: 'Sigue', sub: w('Recibe comida', 'Recibe pedido'), icon: 'play' },
              { value: 'paused', label: 'En pausa', sub: 'Se fue un tiempo', icon: 'pause' },
              { value: 'inactive', label: 'Ya no', sub: w('Dejó de comer', 'Ya no pide'), icon: 'ban' },
            ],
          }),
        },
        {
          id: 'confirm',
          title: 'Revisa el cambio',
          last: true,
          build: (st) => h('div',
            posSummary([
              ...whoRows(st.client),
              ['Antes', capitalize(statusWord(st.client.status))],
              ['Ahora', capitalize(statusWord(st.status)), { total: true }],
            ]),
            owedBy(st.client) > 0.005 && st.status !== 'active'
              ? posNote(`Debe ${money(owedBy(st.client))}. Su deuda no se borra: sigue en su `
                + 'cuenta para cuando venga a pagar.', 'warn')
              : null),
        },
      ],
      commit: (s) => setClientStatus(s.client.id, s.status),
      done: (s) => ({ what: capitalize(statusWord(s.status)), who: s.client.name }),
    });
  }

  /* --- Último día --------------------------------------------------------- */

  function flowLastDay() {
    start({
      title: w('Último día', 'Último día de pedido'),
      subject: subjectOf,
      steps: (s) => [
        whoStep(),
        {
          id: 'day',
          title: w('¿Hasta qué día come?', '¿Hasta qué día tiene pedido?'),
          hint: 'Al día siguiente sale solo de la libreta. No se le borra lo que deba.',
          ready: (st) => !!st.endsOn,
          build: (st, api) => posPick({
            columns: 3,
            value: st.endsOn,
            onPick: (v) => { st.endsOn = v; api.revalidate(); },
            advance: api.next,
            options: [
              ['Hoy', 0], ['Mañana', 1], ['En 2 días', 2],
              ['En 3 días', 3], ['En 5 días', 5], ['En una semana', 7],
            ].map(([label, days]) => ({
              value: addDays(today(), days),
              label,
              sub: formatDay(addDays(today(), days)),
            })),
          }),
        },
        {
          id: 'confirm',
          title: 'Revisa el último día',
          last: true,
          build: (st) => h('div',
            posSummary([
              ...whoRows(st.client),
              ['Último día', capitalize(formatDayLong(st.endsOn)), { total: true }],
            ]),
            posNote(`Las ${periodWordPlural(st.client)} hasta ese día se le siguen cobrando. `
              + 'Las que empiecen después, no.', 'ok')),
        },
      ],
      commit: (s) => setEndsOn(s.client.id, s.endsOn),
      done: (s) => ({
        what: w(`Come hasta el ${formatDay(s.endsOn)}`, `Pedidos hasta el ${formatDay(s.endsOn)}`),
        who: s.client.name,
      }),
    });
  }

  return () => {
    window.removeEventListener('resize', onResize);
    clearTimeout(resizeTimer);
    stop();
    stopTill?.();
    stopUsers?.();
    unmountPos();
  };
}

/* --- Small helpers ---------------------------------------------------------- */

const firstName = (client) => String(client?.name || '').trim().split(/\s+/)[0] || 'el cliente';

const statusWord = (status) => (
  status === 'paused' ? 'en pausa' : status === 'inactive' ? 'ya no come aquí' : 'activo');

/** What a fortnight would cost with `patch` applied — the live price preview. */
function priceLabel(client, patch = {}) {
  const charge = periodCharge({ ...client, ...patch }, store.pricing);
  return charge.priced ? money(charge.amount) : 'Sin precio';
}

const dayWords = (days) => {
  const order = [1, 2, 3, 4, 5, 6, 0];
  const on = order.filter((d) => (days || []).map(Number).includes(d));
  return on.length ? on.map((d) => WEEKDAYS_SHORT[d]).join(' · ') : 'Ningún día';
};

/**
 * The collection days worth offering: a couple behind and a few ahead.
 *
 * Behind, because the day somebody paid is usually already past by the time it
 * is being typed in; ahead, because somebody paying early is starting the
 * fortnight that has not opened yet.
 */
function nearbyPayDays() {
  const from = addDays(payDayOnOrBefore(today()), -7);
  const out = [];
  for (let i = 0; i <= 24 && out.length < 6; i += 1) {
    const day = addDays(from, i);
    if (isPayDay(day)) out.push(day);
  }
  return out;
}
