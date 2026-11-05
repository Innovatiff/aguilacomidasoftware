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
  posTile, posPick, posFind, posMoney, posDays, posCalendar, posSummary, posNote, posField, posText,
  posLabel,
} from '../ui/pos-kit.js';
import {
  store, subscribe, billingFor, farmById, printContext, activeClients,
} from '../data/store.js';
import {
  createClient, updateClient, setClientStatus, setEndsOn, emptyClient, servingSince,
  tagsInUse,
} from '../data/clients.js';
import {
  takePayment, addCharge, adjustBalance, billsOf, payableRows, aheadRows, nothingOwedYet,
} from '../data/invoices.js';
import { watchReceiptsOn, totalOf, cancelledIds } from '../data/receipts.js';
import { printReceipt } from '../ui/print.js';
import {
  periodOf, payDayAfter, payDayOnOrBefore, cycleFromPayment, isPayDay,
  PAY_EVERY, payEveryOf, periodWord, periodWordPlural, cadenceWord,
} from '../lib/billing.js';
import { payDaysWords } from '../lib/billing-words.js';
import { periodCharge, tierFor } from '../lib/pricing.js';
import { money, plural } from '../lib/format.js';
import { t, tx } from '../lib/i18n.js';
import { langSwitch } from '../ui/lang.js';
import { kitchen } from '../lib/mode.js';
import {
  seatedPacker, sitDown, watchPackers, watchPacking, savePacking,
} from '../data/packing.js';
import {
  abilitiesOf, lineOf, arrangeLine, orderedPlaces, placementProblems, boardChanges, confirmPlace,
  lineOfPlace, adoptingLine,
} from '../lib/packing.js';
import { dayBoard } from '../lib/board.js';
import { novedades, unseenToday } from '../lib/notices.js';
import { avisosFrom, avisosStrip, openAvisos, openNovedades } from '../ui/kitchen-news.js';
import { arrangeSheet } from '../ui/libreta-order.js';
import { sheet, toastOk, toastBad } from '../ui/overlay.js';
import { errorText } from '../firebase.js';
import { createFarm, newLocationId, addLocations } from '../data/farms.js';
import { openDayBoard } from '../ui/day-board.js';
import { openAdvanceSheet } from '../ui/advance-sheet.js';
import { planAdvanceFix } from '../lib/advance.js';
import {
  dietKey, sameDiet, kitchenSpelling, dietChanges,
} from '../lib/diet.js';
import { paymentMethodMeta } from '../lib/model.js';
import { versionShort } from '../version.js';
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
  let mine = null;           // their record: what they may do, and their libreta
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
      mine = found;
      allowed = abilitiesOf(found);
      paintTiles();
    }, () => {})
    : null;

  // The libretas: in the kitchen for the one assigned to whoever is sitting
  // here and for the avisos; at the counter to say where somebody new is
  // packed.
  let packingSetup = null;
  const stopSetup = watchPacking((found) => {
    packingSetup = found;
    if (kitchen()) { paintTiles(); news?.refresh(); }
  }, () => {});

  // The Avisos or Novedades page open over the menu, if any: it redraws when
  // a client or the libretas change, like the board does.
  let news = null;

  /** Their libreta, when the manager gave them one and it still exists. */
  const myLine = () => (mine?.lineId ? lineOf(packingSetup?.lines, mine.lineId) : null);

  /** Panel wording at the counter, kitchen wording in the kitchen. */
  const w = (panelWords, kitchenWords) => (kitchen() ? kitchenWords : panelWords);
  const mealsWord = (n) => plural(n, w('comida', 'pedido'), w('comidas', 'pedidos'));

  const stop = subscribe(() => {
    // Only the tile grid depends on the store; a flow running on top owns its
    // own copy of what it needs and must not be torn out from under a hand.
    if (panel && !document.querySelector('.pos--flow')) paintTiles();
    news?.refresh();
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
      title: kitchen() ? t('Empaque') : t('Acción rápida'),
      backTo: kitchen() ? '/empaque' : '/',
      tab: 'home',
      body: h('div.page__inner', emptyState({
        icon: 'bolt',
        title: t('Es para la pantalla de la tienda'),
        text: t('Acción rápida está hecha para la computadora del mostrador: botones grandes, un teclado numérico y una pregunta por pantalla. En el teléfono no cabe, y aquí el panel normal hace lo mismo con menos vueltas.'),
        action: kitchen()
          ? button(t('Ir a Empaque'), {
            variant: 'primary', block: true, icon: 'box', onClick: () => go('/empaque'),
          })
          : button(t('Ir a Clientes'), {
            variant: 'primary', block: true, icon: 'users', onClick: () => go('/clients'),
          }),
      })),
    });
  }

  function mountPos() {
    if (panel) return;
    const cocina = kitchen();
    screen({ title: cocina ? t('Empaque') : t('Acción rápida'), hideTabs: true, body: h('div') });

    panel = h('div.pos.pos--home',
      h('header.pos__bar',
        // In the panel the button on the left is the way out. On a kitchen
        // computer there is nothing to go out to, so the same slot says who
        // is sitting there — and pressing it is how the next person takes
        // over, which is the only thing anybody wants from it.
        cocina ? whoButton() : h('button.pos__exit', { type: 'button', onclick: () => go('/') },
          icon('chevronL'), h('span', t('Salir'))),
        h('span.pos__mark', icon('eagle')),
        h('span.pos__title', cocina ? t('Empaque') : t('Acción rápida')),
        h('span.pos__day', capitalize(formatDayLong(today()))),
        h('span.pos__ver', versionShort()),
        // The language of this computer, in the corner nobody presses by accident.
        h('span.pos__lang', langSwitch({ short: true }))),
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
      h('strong', me?.name || t('Sin nombre')),
      h('em', t('Cambiar'))));
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
      icon: 'cash', title: t('Cobrar'),
      sub: t('Registrar un pago'),
      hero: true,
      onClick: () => ready && flowCharge(),
    });
    const tileMeals = () => posTile({
      icon: 'utensils', title: t('Cambiar comidas'), family: 'plan',
      sub: t('1 ó 2 al día'),
      onClick: () => ready && flowMeals(),
    });

    if (kitchen()) {
      mount(host, ...kitchenBoard(ready));
      return;
    }

    mount(host,
      // The question on the left; on the right, the Programador — a change a
      // client asks for "from Monday" is asked at this counter. Beside the
      // question rather than under it, so it costs the screen no height. Its
      // number is what is waiting for somebody: a reminder for today, or a
      // change that could not be made.
      h('div.poshead',
        h('div.poshead__text',
          h('h2.pos__q', t('¿Qué vas a hacer?')),
          h('p.pos__hint', ready
            ? t('{clients} · se cobra en {days}', {
              clients: plural(store.clients.length, 'cliente', 'clientes'), days: payDaysWords(),
            })
            : t('Cargando…'))),
        (() => {
          const waiting = store.schedule.filter((set) => set.state === 'remind' || set.state === 'failed').length;
          return h('div.poshead__btns',
            h('button.posinfo', { type: 'button', onclick: () => go('/programador') },
              icon('clock'), h('span', t('Programador')),
              waiting ? h('span.posinfo__n', { 'aria-label': t('{count} para revisar', { count: waiting }) }, String(waiting)) : null));
        })()),

      // At the counter the top row is Cobrar, twice the size of anything else,
      // because at a counter that is most of the day.
      h('div.postiles.postiles--2', { style: { marginBottom: '14px' } },
        tileCharge(), tileMeals()),

      h('div.postiles.postiles--5',
        posTile({
          icon: 'calendar', title: t('Cambiar días'), family: 'plan',
          sub: t('Qué días come'),
          onClick: () => ready && flowWeek(),
        }),
        posTile({
          icon: 'clock', title: t('Cambiar periodo'), family: 'plan',
          sub: t('Semanal o quincenal'),
          onClick: () => ready && flowCycle(),
        }),
        posTile({
          icon: 'noEat', title: t('No puede comer'), family: 'plan',
          sub: t('No pollo, no puerco…'),
          onClick: () => ready && flowDiet(),
        }),
        posTile({
          icon: 'farm', title: t('Nueva farma'), family: 'plan',
          sub: t('Con sus ubicaciones'),
          onClick: () => ready && flowNewFarm(),
        }),
        posTile({
          icon: 'pin', title: t('Nueva ubicación'), family: 'plan',
          sub: t('En una farma'),
          onClick: () => ready && flowNewPlace(),
        }),
        // Five across, two rows: what they eat and where, on top; who is
        // eating, then the two money corrections side by side, below.
        posTile({
          icon: 'userPlus', title: t('Nuevo cliente'), family: 'who',
          sub: t('Dar de alta'),
          onClick: () => ready && flowNew(),
        }),
        posTile({
          icon: 'pause', title: t('Pausar o reactivar'), family: 'who',
          sub: t('Deja o vuelve a comer'),
          onClick: () => ready && flowStatus(),
        }),
        posTile({
          icon: 'ban', title: t('Último día'), family: 'who',
          sub: t('Hasta cuándo come'),
          onClick: () => ready && flowLastDay(),
        }),
        posTile({
          icon: 'plus', title: t('Agregar deuda'), family: 'money',
          sub: t('Un cargo aparte'),
          onClick: () => ready && flowDebt(),
        }),
        posTile({
          icon: 'edit', title: t('Corregir saldo'), family: 'money',
          sub: t('Dejarlo en lo correcto'),
          onClick: () => ready && flowBalance(),
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
   * reading: the farm and what goes in each order on the left — Cantidad de
   * pedidos right under Calendario semanal, because they are the same question
   * asked two ways, and No puede comer under that — and the people on the
   * right.
   *
   * **Each person sees only what they are allowed.** A button somebody may not
   * use is not shown greyed out; it is not shown. A menu full of things you
   * cannot press is a menu you have to read every morning to find the ones you
   * can.
   */
  function kitchenBoard(ready) {
    const tile = {
      // Straight into their libreta when they have one; otherwise the two to
      // choose from.
      pack: () => posTile({
        icon: 'box', title: t('Empacar'),
        sub: myLine() ? t('Tu libreta: {line}', { line: myLine().name }) : t('La comida de hoy, en el orden de su libreta'),
        hero: true, band: true,
        onClick: () => startPacking(ready),
      }),
      organize: () => posTile({
        icon: 'sort', title: t('Organizar libreta'), family: 'plan',
        sub: t('El orden y las ubicaciones nuevas'),
        onClick: () => ready && organize(),
      }),
      newFarm: () => posTile({
        icon: 'farm', title: t('Nueva farma'), family: 'plan',
        sub: t('Darla de alta con sus ubicaciones'),
        onClick: () => ready && flowNewFarm(),
      }),
      week: () => posTile({
        icon: 'calendar', title: t('Calendario semanal'), family: 'plan',
        sub: t('Qué días hay pedido'),
        onClick: () => ready && flowWeek(),
      }),
      meals: () => posTile({
        icon: 'utensils', title: t('Cantidad de pedidos'), family: 'plan',
        sub: t('1 ó 2 al día'),
        onClick: () => ready && flowMeals(),
      }),
      diet: () => posTile({
        icon: 'noEat', title: t('No puede comer'), family: 'plan',
        sub: t('No pollo, no puerco…'),
        onClick: () => ready && flowDiet(),
      }),
      newClient: () => posTile({
        icon: 'userPlus', title: t('Nuevo cliente'), family: 'who',
        sub: t('Dar de alta'),
        onClick: () => ready && flowNew(),
      }),
      status: () => posTile({
        icon: 'pause', title: t('Pausar o reactivar'), family: 'who',
        sub: t('Deja o vuelve a pedir'),
        onClick: () => ready && flowStatus(),
      }),
      lastDay: () => posTile({
        icon: 'ban', title: t('Último día de pedido'), family: 'who',
        sub: t('Hasta cuándo pide'),
        onClick: () => ready && flowLastDay(),
      }),
    };

    // Until the user's record has loaded, nothing is offered — better a beat
    // of "cargando" than a button that vanishes as somebody reaches for it.
    if (!allowed) return [h('h2.pos__q', t('Un momento…')), h('p.pos__hint', t('Cargando tu menú.'))];

    const ok = (key) => allowed[key] === true;
    const left = ['newFarm', 'week', 'meals', 'diet'].filter(ok);
    const right = ['organize', 'newClient', 'status', 'lastDay'].filter(ok);

    // Counted over the same people as the number beside it: a farm whose
    // people have all stopped ordering is not one the kitchen packs for.
    const eating = activeClients();
    const farmsCount = new Set(eating.map((client) => client.farmId)).size;

    /*
     * The greeting, and beside it the day's board — what the two whiteboards on
     * the wall say, counted from the clients. It is for everybody who works
     * here, whatever they are allowed to change: reading how many plates go
     * without chicken changes nothing.
     */
    const unseen = ready ? unseenToday(newsGroups(), today(), newsSeenAt()) : 0;
    const heading = (title, hint) => h('div.poshead',
      h('div.poshead__text',
        h('h2.pos__q', title),
        hint ? h('p.pos__hint', hint) : null),
      h('div.poshead__btns',
        // Who started, paused or came back — with a count of what is new
        // since this computer last opened it.
        h('button.posinfo', {
          type: 'button',
          disabled: !ready,
          onclick: () => showNews(),
        }, icon('bell'), h('span', t('Novedades')),
        unseen ? h('span.posinfo__n', { 'aria-label': t('{count} sin ver', { count: unseen }) }, String(unseen)) : null),
        h('button.posinfo', {
          type: 'button',
          disabled: !ready,
          onclick: () => openBoard(),
        }, icon('clipboard'), h('span', t('Tablero de hoy')))));

    // What has to be acted on, one strip across the menu, the most urgent
    // first. Shown to everybody: whoever cannot fix it can still tell
    // somebody who can.
    const strip = ready ? avisosStrip(avisosFrom(kitchenFound()), () => showAvisos()) : null;

    const nothing = !ok('pack') && !left.length && !right.length;
    if (nothing) {
      return [
        heading(t('Hola, {name}', { name: firstName(me) })),
        strip,
        h('div.posnote.posnote--warn', icon('alert'),
          h('div', t('Todavía no tienes nada asignado. Pídele al encargado que te dé permisos desde el panel.'))),
      ];
    }

    // Two columns when there is something on both sides. When there is not,
    // what is left is laid out across instead, so one person's menu is never
    // a single column hugging the left edge of a wide screen.
    const both = left.length && right.length;
    const rest = [...left, ...right];

    return [
      heading(t('¿Qué vas a hacer, {name}?', { name: firstName(me) }), ready
        ? t('{clients} en {farms}', {
          clients: plural(eating.length, 'cliente', 'clientes'), farms: plural(farmsCount, 'farma', 'farmas'),
        })
        : t('Cargando…')),

      strip,

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
      h('span.postill__k', t('Cobrado hoy')),
      h('span.postill__v', money(totalOf(takings), { round: true })),
      live.length
        ? h('span.postill__split',
            h('span.postill__part', t('Efectivo {amount}', { amount: money(cash, { round: true }) })),
            rest > 0.005
              ? h('span.postill__part', t('Otros {amount}', { amount: money(rest, { round: true }) }))
              : null)
        : null,
      h('span.postill__n', live.length
        ? t('{payments} · tócalo para reimprimir', { payments: plural(live.length, 'pago', 'pagos') })
        : t('Sin pagos todavía')));
  }

  /** The day's receipts, each one a press away from the printer. */
  function showTill() {
    const voided = cancelledIds(takings);
    const live = takings.filter((r) => Number(r.amount) > 0 && !voided.has(r.id));

    start({
      title: t('Recibos de hoy'),
      steps: () => [{
        id: 'pick',
        title: t('Reimprimir un recibo'),
        hint: t('Los pagos de hoy, del más reciente al más viejo.'),
        ready: () => false,
        build: () => h('div.posresults', live.map((receipt) => h('button.posperson', {
          type: 'button',
          onclick: () => printReceipt(receipt, { ...printContext(receipt), copy: true }),
        },
        h('span.posperson__mark', icon('receipt')),
        h('span.posperson__who',
          h('span.posperson__name', receipt.clientName || '—'),
          h('span.posperson__where', `${receipt.folio || ''} · ${money(receipt.amount)}`)),
        h('span.posperson__owes.posperson__owes--ok', t('Imprimir'))))),
      }],
      commit: async () => null,
      done: () => ({ what: t('Listo') }),
    });
  }

  /* --- The step everything starts with ----------------------------------- */

  /** "¿Quién es?" — the same first slide in almost every action. */
  const whoStep = (hint) => ({
    id: 'who',
    title: t('¿Quién es?'),
    hint: hint || t('Escribe su nombre y tócalo en la lista.'),
    ready: (s) => !!s.client,
    build: (s, api) => posFind({
      clients: store.clients,
      value: s.client,
      balanceOf: owedBy,
      onPick: (client) => {
        if (s.client && s.client.id !== client.id) forgetPerson(s);
        s.client = client;
        api.revalidate();
      },
    }),
  });

  /*
   * Picking somebody else starts their answers over. What was chosen for the
   * first person — their days, their amount, their status — is not the
   * second's, and saving it on them would change somebody nobody looked at.
   */
  const PERSONAL = {
    amount: 0, owing: null, loadingFor: null, setCycle: false, target: null,
    days: undefined, meals: undefined, status: undefined, endsOn: undefined,
    payEvery: undefined, anchor: undefined,
  };
  function forgetPerson(s) {
    for (const [key, blank] of Object.entries(PERSONAL)) {
      if (blank === undefined) delete s[key];
      else s[key] = blank;
    }
  }

  /** The person's name and where they are, for a confirmation table. */
  /** Feeds the bar that keeps the chosen person on screen. */
  const subjectOf = (s) => (s.client
    ? {
        name: s.client.name,
        where: [s.client.farmName, s.client.locationName].filter(Boolean).join(' · '),
      }
    : null);

  const whoRows = (client) => [
    [t('Cliente'), client.name],
    [t('Dónde'), [client.farmName, client.locationName].filter(Boolean).join(' · ') || '—'],
  ];

  /* --- Cobrar ------------------------------------------------------------- */

  function flowCharge() {
    start({
      title: t('Cobrar'),
      subject: subjectOf,
      state: { amount: 0, method: null, setCycle: false, owing: null },
      steps: (s) => {
        // What this person owes today — read from their own bills once they
        // are picked, the same way the payment itself will. It is what the
        // amount starts at and what the screen explains the money against;
        // it never stops a payment. Whatever they hand over goes in.
        const owing = s.client && s.owing?.clientId === s.client.id ? s.owing : null;
        const total = owing ? owing.total : 0;
        return [
          whoStep(t('Sin escribir nada sale primero el que más debe. Escribe su nombre para buscarlo.')),
          {
            id: 'amount',
            title: t('¿Cuánto te dio {name}?', { name: firstName(s.client) }),
            hint: !owing
              ? t('Viendo lo que debe…')
              : total > 0.005
                ? t('Debe {amount}: {what}.', { amount: money(total), what: owing.rows.map((row) => tx(row.title)).join(', ') })
                : t('Está al corriente.'),
            ready: (st) => st.amount > 0,
            next: t('Siguiente'),
            build: (st, api) => {
              if (!owing) {
                loadOwing(st, api);
                return posNote(t('Viendo lo que debe…'), 'info');
              }
              // Money the old way of taking payments put on a fortnight before
              // it was served. Said, with a way to put it right — and the
              // keypad right under it, because the payment goes in either way.
              const ahead = owing.ahead
                ? h('div',
                    posNote(t('{name} tiene un pago puesto por adelantado. Se puede corregir ahora o después; el cobro entra igual.', {
                      name: firstName(st.client),
                    }), 'warn'),
                    h('button.posbtn', {
                      type: 'button', onclick: () => fixAhead(st, api),
                    }, icon('check'), h('span', t('Revisar y corregir'))))
                : null;

              // Said while the number is being typed, not after: where money
              // past what they owe goes, so nobody is surprised by the receipt.
              const fortnight = periodCharge(st.client, store.pricing);
              const warn = h('div');
              const paint = () => mount(warn, st.amount > total + 0.005 && total > 0.005
                ? posNote(t('Debe {amount}. Lo que sobra queda para su quincena en curso.', { amount: money(total) }), 'info')
                : null);
              paint();
              return h('div',
                ahead,
                owing.unread
                  ? posNote(t('No se pudo ver lo que debe (sin internet o sin conexión). El pago entra igual y queda a cuenta, marcado para revisarlo.'), 'warn')
                  : null,
                !owing.unread && total <= 0.005 ? posNote(nothingOwedYet(owing.payer, today()), 'info') : null,
                posMoney({
                  value: st.amount || '',
                  onChange: (v) => { st.amount = v; paint(); api.revalidate(); },
                  quick: [
                    total > 0.005 ? { label: t('Todo lo que debe {amount}', { amount: money(total) }), value: total } : null,
                    owing.rows.length > 1
                      ? {
                        label: t('Solo {what} {amount}', { what: tx(owing.rows[0].title), amount: money(owing.rows[0].owed) }),
                        value: owing.rows[0].owed,
                      }
                      : null,
                    total <= 0.005 && fortnight.priced && fortnight.amount > 0
                      ? {
                        label: t('Una {period} {amount}', { period: t(periodWord(st.client)), amount: money(fortnight.amount) }),
                        value: fortnight.amount,
                      }
                      : null,
                  ].filter(Boolean),
                }),
                warn);
            },
          },
          {
            id: 'method',
            title: t('¿Cómo pagó?'),
            hint: t('Queda en el recibo y en su historial.'),
            ready: (st) => !!st.method,
            build: (st, api) => posPick({
              columns: 2,
              value: st.method,
              onPick: (v) => { st.method = v; api.revalidate(); },
              advance: api.next,
              options: [
                { value: 'cash', label: t('Efectivo'), sub: t('Billetes en mano'), icon: 'cash' },
                { value: 'debit', label: t('Débito'), sub: t('Tarjeta de débito'), icon: 'card' },
              ],
            }),
          },
          {
            id: 'confirm',
            title: t('Revisa antes de cobrar'),
            hint: t('Si algo está mal, regresa con Atrás.'),
            last: true,
            next: t('Cobrar {amount}', { amount: money(s.amount) }),
            build: (st) => h('div',
              posSummary([
                ...whoRows(st.client),
                [t('Debía'), total > 0.005 ? money(total) : t('Nada')],
                [t('Es por'), paidFor(owing, st.amount)],
                [t('Cómo pagó'), paymentMethodMeta(st.method).label],
                [t('Recibes'), money(st.amount)],
                // The question asked back across the counter, answered before
                // the money is taken rather than after.
                [t('Queda debiendo'), money(Math.max(0, round2(total - st.amount))), { total: true }],
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
        what: t('Cobrado {amount}', { amount: money(s.amount) }),
        who: `${s.client.name} · ${paymentMethodMeta(s.method).label} · ${receipt.folio}`,
        // The thing the person on the other side of the counter is waiting
        // for. Offered rather than fired automatically: a print dialog that
        // opens by itself is one nobody expects, and a browser can refuse a
        // print that no click asked for.
        extra: h('button.posbtn.posbtn--go', {
          type: 'button',
          onclick: () => printReceipt(receipt, printContext(receipt)),
        }, icon('receipt'), h('span', t('Imprimir recibo'))),
        note: s.setCycle
          ? t('Su {period} queda en {weekday}.', {
            period: t(periodWord(s.client)), weekday: weekdayName(cycleFromPayment(today())),
          })
          : null,
      }),
    });
  }

  /**
   * Reads one client's bills and works out what they can pay today.
   *
   * Once per person: going back and picking somebody else reads theirs. A
   * payment never moves anybody's fortnight here, so it is counted on the
   * fortnight they already have.
   *
   * Whatever happens reading it — no internet, a record the arithmetic cannot
   * read — the payment can still be taken: they are shown as owing nothing
   * known, the box starts at a fortnight, and the payment is kept whole.
   */
  function loadOwing(st, api) {
    const client = st.client;
    if (!client || st.loadingFor === client.id) return;
    st.loadingFor = client.id;
    const anchor = client.cycleAnchor || cycleFromPayment(today());
    const payer = { ...client, cycleAnchor: anchor };
    const settle = (owing) => {
      if (st.client?.id !== client.id) return;
      st.owing = { clientId: client.id, payer, anchor, bills: [], rows: [], total: 0, ...owing };
      // What they owe, or — up to date, paying a few days early — the
      // fortnight they are eating now. Never a zero that looks like "no".
      const fortnight = periodCharge(client, store.pricing);
      st.amount = st.owing.total > 0.005
        ? st.owing.total
        : (fortnight.priced && fortnight.amount > 0 ? fortnight.amount : 0);
      api.refresh();
    };
    billsOf(client.id)
      .then((bills) => {
        let ahead = null;
        try {
          const plan = planAdvanceFix({ client, bills, since: servingSince(client), day: today() });
          ahead = plan.moves.length ? plan : null;
        } catch { /* a note, not the payment */ }
        try {
          settle({ bills, ahead, ...payableRows(payer, bills, store.pricing, { day: today() }) });
        } catch {
          settle({ bills, ahead, unread: true });
        }
      })
      .catch(() => settle({ unread: true }));
  }

  /** Shows what moves, moves it, and reads what they owe again. */
  async function fixAhead(st, api) {
    const client = st.client;
    const done = await openAdvanceSheet({ client, author: author(), plan: st.owing?.ahead || null });
    if (!done || st.client?.id !== client.id) return;
    st.client = { ...client, paidThrough: done.paidThrough, advanceFixedOn: today() };
    st.owing = null;
    st.loadingFor = null;
    api.refresh();
  }

  /**
   * "26 sep – 9 oct" — what an amount pays, oldest first, the way the payment
   * applies it; and, past what is owed, the fortnight it waits on.
   */
  function paidFor(owing, amount) {
    if (!owing) return '—';
    const value = Number(amount) || 0;
    const spread = (rows, money0) => {
      const parts = [];
      let left = money0;
      for (const row of rows) {
        if (left <= 0.005) break;
        const take = Math.min(left, row.owed);
        left = round2(left - take);
        parts.push(take < row.owed - 0.005 ? t('{what} (una parte)', { what: tx(row.title) }) : tx(row.title));
      }
      return { parts, left };
    };
    const extra = round2(value - owing.total);
    const served = spread(owing.rows, Math.min(value, owing.total));
    const waiting = extra > 0.005
      ? spread(aheadRows(owing.payer, owing.bills || [], store.pricing, { day: today(), amount: extra }), extra)
      : { parts: [], left: 0 };
    return [
      served.parts.join(', '),
      waiting.parts.length ? t('a cuenta de {what}', { what: waiting.parts.join(', ') }) : '',
      waiting.left > 0.005 ? t('{amount} a cuenta', { amount: money(waiting.left) }) : '',
    ].filter(Boolean).join(' · ') || '—';
  }

  /**
   * The one decision on the confirmation slide, and only when it matters.
   *
   * Most people at this counter already have a fortnight; asking them all
   * about it every time would be a question with the same answer 300 times.
   * It appears only for somebody whose cycle has never been set.
   */
  function cycleChoice(st) {
    // A payment here never moves anybody's dates: somebody paying a few days
    // early or late used to have their fortnight dragged to that day. It is
    // set on purpose, from their file in the panel.
    st.setCycle = false;
    return null;
  }

  /* --- Comidas al día ----------------------------------------------------- */

  function flowMeals() {
    start({
      title: w(t('Cambiar comidas'), t('Cantidad de pedidos')),
      subject: subjectOf,
      steps: (s) => [
        whoStep(),
        {
          id: 'meals',
          title: w(t('¿Cuántas comidas al día?'), t('¿Cuántos pedidos al día?')),
          hint: s.client ? t('Ahora lleva {meals}.', { meals: mealsWord(s.client.mealsPerDay) }) : '',
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
          title: t('Revisa el cambio'),
          last: true,
          build: (st) => h('div',
            posSummary([
              ...whoRows(st.client),
              [t('Antes'), `${mealsWord(st.client.mealsPerDay)} · ${priceLabel(st.client)}`],
              [t('Ahora'), `${mealsWord(st.meals)} · ${priceLabel(st.client, { mealsPerDay: st.meals })}`,
                { total: true }],
            ]),
            tierFor(store.pricing, st.meals)
              ? null
              : posNote(t('Ese plan no tiene precio en Ajustes, así que no se le podrá facturar hasta que se lo pongan.'), 'warn')),
        },
      ],
      commit: (s) => updateClient(s.client.id, { mealsPerDay: s.meals }),
      done: (s) => ({
        what: t('{meals} al día', { meals: mealsWord(s.meals) }),
        who: s.client.name,
      }),
    });
  }

  /* --- Los días que come -------------------------------------------------- */

  function flowWeek() {
    start({
      title: w(t('Cambiar días'), t('Calendario semanal')),
      subject: subjectOf,
      steps: (s) => [
        whoStep(),
        {
          id: 'days',
          title: w(t('¿Qué días come?'), t('¿Qué días tiene pedido?')),
          hint: t('Toca un día para prenderlo o apagarlo. El precio se ajusta solo.'),
          ready: (st) => (st.days || st.client.deliveryDays || []).length > 0,
          build: (st, api) => {
            st.days = st.days || [...(st.client.deliveryDays || [])];
            const price = h('div.posnote.posnote--ok', icon('info'), h('div'));
            const paintPrice = () => mount(price.lastChild,
              t('Su {period} costaría {price}.', {
                period: t(periodWord(st.client)), price: priceLabel(st.client, { deliveryDays: st.days }),
              }));
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
          title: t('Revisa el cambio'),
          last: true,
          build: (st) => posSummary([
            ...whoRows(st.client),
            [t('Antes'), dayWords(st.client.deliveryDays)],
            [t('Ahora'), dayWords(st.days)],
            [t('Su {period}', { period: t(periodWord(st.client)) }),
              priceLabel(st.client, { deliveryDays: st.days }), { total: true }],
          ]),
        },
      ],
      commit: (s) => updateClient(s.client.id, { deliveryDays: s.days }),
      done: (s) => ({
        what: w(t('Días actualizados'), t('Calendario actualizado')),
        who: `${s.client.name} · ${dayWords(s.days)}`,
      }),
    });
  }

  /* --- El día de pago ----------------------------------------------------- */

  function flowCycle() {
    start({
      title: t('Cambiar periodo'),
      subject: subjectOf,
      steps: (s) => [
        whoStep(),
        {
          id: 'every',
          title: t('¿Cada cuánto paga?'),
          hint: s.client
            ? t('Ahora paga {cadence}.', { cadence: t(cadenceWord(s.client)) })
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
                label: t('Cada quincena'),
                sub: t('14 días · {price}', { price: priceLabel(st.client, { payEvery: PAY_EVERY.FORTNIGHT }) }),
                icon: 'calendar',
              },
              {
                value: PAY_EVERY.WEEK,
                label: t('Cada semana'),
                sub: t('7 días · {price}', { price: priceLabel(st.client, { payEvery: PAY_EVERY.WEEK }) }),
                icon: 'clock',
              },
            ],
          }),
        },
        {
          id: 'day',
          title: t('¿Qué día empieza su {period}?', { period: t(periodWord({ payEvery: s.payEvery })) }),
          hint: t('Se cobra en {days}. Normalmente es el día que pagó.', { days: payDaysWords() }),
          ready: (st) => !!st.anchor,
          build: (st, api) => posPick({
            columns: 3,
            value: st.anchor,
            onPick: (v) => { st.anchor = v; api.revalidate(); },
            advance: api.next,
            options: nearbyPayDays().map((day) => ({
              value: day,
              label: capitalize(weekdayName(day)),
              sub: day === today() ? t('{day} · hoy', { day: formatDay(day) }) : formatDay(day),
            })),
          }),
        },
        {
          id: 'confirm',
          title: t('Revisa el periodo'),
          last: true,
          build: (st) => {
            const after = { ...st.client, cycleAnchor: st.anchor, payEvery: st.payEvery };
            const period = periodOf(after);
            const word = periodWord(after);
            return h('div',
              posSummary([
                ...whoRows(st.client),
                [t('Antes'), `${capitalize(t(cadenceWord(st.client)))} · ${priceLabel(st.client)}`],
                [t('Ahora'), `${capitalize(t(cadenceWord(after)))} · ${priceLabel(after)}`],
                [t('{period} en curso', { period: capitalize(t(word)) }),
                  `${formatDay(period.start)} - ${formatDay(period.end)}`],
                [t('Se paga el'),
                  formatDayLong(payDayAfter(period), { year: false }),
                  { total: true }],
              ]),
              // First, because it is the line that stops an argument: half as
              // much twice as often is the same food at the same rate per
              // plate, and the amount on the next line looks wrong without it.
              st.payEvery !== payEveryOf(st.client)
                ? posNote(t('Es la misma comida y el mismo precio por plato: cambia cada cuándo se cobra, no cuánto cuesta comer.'), 'warn')
                : null,
              posNote(t('De aquí en adelante su {period} corre cada {days} días desde ese día. Pagar tarde no se lo mueve.', {
                period: t(word), days: st.payEvery,
              }), 'ok'));
          },
        },
      ],
      commit: (s) => updateClient(s.client.id, {
        cycleAnchor: s.anchor, payEvery: s.payEvery, cycleSetOn: today(),
      }),
      done: (s) => ({
        what: t('Paga {cadence}', { cadence: t(cadenceWord({ payEvery: s.payEvery })) }),
        who: t('{name} · desde el {day}', { name: s.client.name, day: formatDay(s.anchor) }),
      }),
    });
  }

  /* --- Alta de cliente ---------------------------------------------------- */

  function flowNew() {
    start({
      title: t('Nuevo cliente'),
      state: { name: '', farmId: '', locationId: '', meals: 1 },
      steps: (s) => {
        const farm = farmById(s.farmId);
        return [
          {
            id: 'name',
            title: t('¿Cómo se llama?'),
            hint: t('Nombre y apellido, como lo va a buscar el que cobre.'),
            ready: (st) => st.name.trim().length > 1,
            build: (st, api) => posField(t('Nombre completo'), posText({
              value: st.name,
              placeholder: t('Ej. José Hernández'),
              onChange: (v) => { st.name = v; api.revalidate(); },
            })),
          },
          {
            id: 'farm',
            title: w(t('¿En qué rancho está?'), t('¿En qué farma está?')),
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
            title: w(t('¿En qué parte del rancho?'), t('¿En qué parte de la farma?')),
            hint: farm ? t('Ubicaciones de {farm}.', { farm: farm.name }) : '',
            ready: (st) => !!st.locationId,
            build: (st, api) => ((farm?.locations || []).length
              ? posPick({
                  columns: 2,
                  value: st.locationId,
                  onPick: (v) => { st.locationId = v; api.revalidate(); },
                  advance: api.next,
                  options: farm.locations.map((loc) => ({ value: loc.id, label: loc.name })),
                })
              : posNote(w(t('Ese rancho no tiene ubicaciones todavía. Se agregan desde el panel, en Ranchos.'),
                t('Esa farma no tiene ubicaciones todavía. Pídele al encargado que se las agregue desde el panel.')), 'bad')),
          },
          {
            id: 'meals',
            title: w(t('¿Cuántas comidas al día?'), t('¿Cuántos pedidos al día?')),
            ready: (st) => st.meals > 0,
            build: (st, api) => posPick({
              columns: 3,
              value: st.meals,
              onPick: (v) => { st.meals = v; api.revalidate(); },
              advance: api.next,
              options: [1, 2, 3].map((n) => ({
                value: n,
                label: String(n),
                sub: t('{amount} / quincena', { amount: money(tierFor(store.pricing, n)?.price || 0) }),
              })),
            }),
          },
          {
            id: 'confirm',
            title: t('Revisa antes de darlo de alta'),
            hint: w(t('Come de lunes a sábado y paga cada quincena. Los días y el periodo se ajustan después si hace falta.'),
              t('Tiene pedido de lunes a sábado. Los días se cambian después con Calendario semanal si hace falta.')),
            last: true,
            next: t('Dar de alta'),
            build: (st) => posSummary([
              [t('Nombre'), st.name.trim()],
              [w(t('Rancho'), t('Farma')), farm?.name || '—'],
              [t('Ubicación'), (farm?.locations || []).find((l) => l.id === st.locationId)?.name || '—'],
              [w(t('Comidas'), t('Pedidos')), t('{meals} al día', { meals: mealsWord(st.meals) })],
              [t('Su quincena'), money(tierFor(store.pricing, st.meals)?.price || 0), { total: true }],
            ]),
          },
        ];
      },
      commit: (s) => createClient(
        { ...emptyClient(farmById(s.farmId)), name: s.name.trim(), locationId: s.locationId, mealsPerDay: s.meals },
        farmById(s.farmId), author()),
      done: (s) => ({
        what: t('Cliente dado de alta'), who: s.name.trim(), note: whereNote(s.farmId, s.locationId),
      }),
    });
  }

  /**
   * Where somebody new is packed, said on the screen that registered them —
   * and when nobody packs them yet, that the kitchen has been told.
   */
  function whereNote(farmId, locationId) {
    const lines = packingSetup?.lines;
    if (!lines || !farmId) return null;
    const named = lineOfPlace(lines, farmId, locationId);
    if (named) return t('Se empaca en la libreta {line}.', { line: named.name });
    const home = adoptingLine(lines, farmId);
    if (home) {
      return t('Su ubicación es nueva: se empaca en la libreta {line}, con el resto de su farma. La cocina lo ve en Avisos para confirmar el lugar.', {
        line: home.name,
      });
    }
    return t('Su ubicación no está en ninguna libreta: la cocina lo ve en rojo en Avisos para acomodarla. Su comida ya cuenta en el tablero de hoy.');
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
      title: t('Nueva farma'),
      state: { name: '', places: [] },
      steps: () => [
        {
          id: 'name',
          title: t('¿Cómo se llama la farma?'),
          hint: t('Como la conocen en la cocina. Ej. #332 Morsea.'),
          ready: (st) => st.name.trim().length > 1
            && !store.farms.some((farm) => sameName(farm.name, st.name)),
          build: (st, api) => {
            // The warning is redrawn as they type, not the box — rebuilding the
            // box would take the cursor out of it after every letter.
            const warning = h('div');
            const paintWarning = () => {
              const taken = store.farms.find((farm) => sameName(farm.name, st.name));
              mount(warning, taken
                ? posNote(t('Ya hay una farma que se llama {name}.', { name: taken.name }), 'bad')
                : null);
            };
            paintWarning();
            return h('div',
              posField(t('Nombre de la farma'), posText({
                value: st.name,
                placeholder: t('Ej. #332 Morsea'),
                onChange: (v) => { st.name = v; paintWarning(); api.revalidate(); },
              })),
              warning);
          },
        },
        placesStep({
          title: t('¿Qué ubicaciones tiene?'),
          hint: t('Escribe una y toca Agregar. Casa 1, Bloque Norte, Invernadero 3…'),
        }),
        {
          id: 'confirm',
          title: t('Revisa antes de darla de alta'),
          last: true,
          next: t('Dar de alta'),
          build: (st) => h('div',
            posSummary([
              [t('Farma'), st.name.trim()],
              [t('Ubicaciones'), st.places.join(' · ')],
              [t('Días de pedido'), t('Lunes a sábado'), { total: true }],
            ]),
            posNote(t('El contacto, el teléfono y el horario de entrega se completan después desde el panel. Ya puedes darle de alta gente aquí.'), 'ok')),
        },
      ],
      commit: (s) => createFarm({
        name: s.name.trim(),
        locations: s.places.map((label) => ({ id: newLocationId(), name: label })),
      }, author()),
      done: (s) => ({
        what: t('Farma dada de alta'),
        who: `${s.name.trim()} · ${plural(s.places.length, 'ubicación', 'ubicaciones')}`,
      }),
    });
  }

  /**
   * "¿Qué ubicaciones?" — written one at a time, Agregar or Enter, into a list
   * that can be corrected before anything is saved. For a new farm, and for
   * new houses at one that exists; `taken` names the ones it already has.
   */
  function placesStep({ title, hint, taken = () => [] }) {
    const sameName = (a, b) => String(a || '').trim().toLowerCase()
      === String(b || '').trim().toLowerCase();
    return {
      id: 'places',
      title,
      hint,
      ready: (st) => st.places.length > 0,
      build: (st, api) => {
        const list = h('div.posplaces');
        const warning = h('div');
        const box = posText({
          value: '',
          placeholder: t('Ej. Casa 1'),
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
            mount(warning, posNote(t('{name} ya está en la lista.', { name: label }), 'bad'));
            return;
          }
          if (taken(st).some((one) => sameName(one, label))) {
            mount(warning, posNote(t('Esa farma ya tiene {name}.', { name: label }), 'bad'));
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
              'aria-label': t('Quitar {name}', { name: label }),
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
            h('div.grow', posField(t('Ubicación'), box)),
            h('button.posbtn.posbtn--add', { type: 'button', onclick: add },
              icon('plus'), t('Agregar'))),
          warning,
          list);
      },
    };
  }

  /* --- Nueva ubicación -------------------------------------------------- */

  /**
   * New houses at a farm that already exists: which farm, their names, and a
   * look before saving. They are in no libreta yet — Organizar libreta, or
   * Empaque → Configurar, puts them in one — and somebody can be registered
   * there at once.
   */
  function flowNewPlace() {
    const farmOf = (st) => farmById(st.farmId);
    start({
      title: t('Nueva ubicación'),
      state: { farmId: '', places: [] },
      subject: (st) => (farmOf(st) ? { name: farmOf(st).name, where: t('Farma') } : null),
      steps: () => [
        {
          id: 'farm',
          title: t('¿En qué farma?'),
          ready: (st) => !!farmOf(st),
          build: (st, api) => posPick({
            columns: 3,
            value: st.farmId,
            onPick: (v) => {
              if (v !== st.farmId) st.places = [];
              st.farmId = v;
              api.revalidate();
            },
            advance: api.next,
            options: [...store.farms]
              .sort((a, b) => String(a.name).localeCompare(String(b.name), 'es'))
              .map((one) => ({
                value: one.id,
                label: one.name,
                sub: plural((one.locations || []).length, 'ubicación', 'ubicaciones'),
              })),
          }),
        },
        placesStep({
          title: t('¿Cómo se llama la ubicación nueva?'),
          hint: t('Escribe una y toca Agregar. Si son varias, una por una.'),
          taken: (st) => (farmOf(st)?.locations || []).map((one) => one.name),
        }),
        {
          id: 'confirm',
          title: t('Revisa antes de agregarla'),
          last: true,
          next: t('Agregar'),
          build: (st) => h('div',
            posSummary([
              [t('Farma'), farmOf(st)?.name || ''],
              [t('Ya tiene'), (farmOf(st)?.locations || []).map((one) => one.name).join(' · ') || t('Ninguna')],
              [st.places.length > 1 ? t('Nuevas') : t('Nueva'), st.places.join(' · '), { total: true }],
            ]),
            (() => {
              const home = packingSetup?.lines ? adoptingLine(packingSetup.lines, st.farmId) : null;
              return posNote(home
                ? t('Se va a empacar en la libreta {line}, con el resto de la farma, después de sus otras ubicaciones. La cocina confirma el lugar o lo cambia desde Avisos.', {
                  line: home.name,
                })
                : t('Todavía no está en ninguna libreta: la cocina la mete en la suya desde Avisos u Organizar libreta. Ya se puede dar de alta gente ahí.'), 'ok');
            })()),
        },
      ],
      commit: (s) => addLocations(farmOf(s), s.places),
      done: (s) => {
        const home = packingSetup?.lines ? adoptingLine(packingSetup.lines, s.farmId) : null;
        return {
          what: s.places.length > 1 ? t('Ubicaciones agregadas') : t('Ubicación agregada'),
          who: `${farmOf(s)?.name || ''} · ${s.places.join(' · ')}`,
          note: home
            ? t('Quien se dé de alta ahí se empaca en la libreta {line}, con el resto de la farma. La cocina confirma el lugar en Avisos.', {
              line: home.name,
            })
            : t('En cuanto alguien se dé de alta ahí, la cocina lo ve en Avisos para meterla en una libreta.'),
        };
      },
    });
  }

  /* --- Una deuda aparte --------------------------------------------------- */

  function flowDebt() {
    start({
      title: t('Agregar deuda'),
      subject: subjectOf,
      state: { amount: 0, reason: '' },
      steps: (s) => [
        whoStep(),
        {
          id: 'amount',
          title: t('¿De cuánto es la deuda?'),
          ready: (st) => st.amount > 0,
          build: (st, api) => posMoney({
            value: st.amount || '',
            onChange: (v) => { st.amount = v; api.revalidate(); },
          }),
        },
        {
          id: 'reason',
          title: t('¿De qué es?'),
          hint: t('Lo verá el cliente en su app, junto al monto.'),
          ready: (st) => st.reason.trim().length > 1,
          build: (st, api) => h('div',
            posField(t('Motivo'), posText({
              value: st.reason,
              placeholder: t('Ej. una caja de refrescos'),
              maxlength: 80,
              onChange: (v) => { st.reason = v; api.revalidate(); },
            })),
            h('div.poschips', { style: { marginTop: '14px' } },
              ['Comida extra', 'Refrescos', 'Ajuste de saldo'].map((text) => h('button.poschip', {
                type: 'button',
                onclick: () => { st.reason = text; api.refresh(); },
              }, t(text))))),
        },
        {
          id: 'confirm',
          title: t('Revisa la deuda'),
          last: true,
          next: t('Agregar {amount}', { amount: money(s.amount) }),
          build: (st) => posSummary([
            ...whoRows(st.client),
            [t('Motivo'), st.reason.trim()],
            [t('Debía'), money(owedBy(st.client))],
            [t('Va a deber'), money(round2(owedBy(st.client) + st.amount)), { total: true }],
          ]),
        },
      ],
      commit: (s) => addCharge(
        { client: s.client, amount: s.amount, reason: s.reason.trim(), date: today() }, author()),
      done: (s) => ({ what: t('Deuda de {amount}', { amount: money(s.amount) }), who: `${s.client.name} · ${s.reason.trim()}` }),
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
      title: t('Corregir saldo'),
      subject: subjectOf,
      state: { target: null, note: '' },
      steps: (s) => [
        whoStep(t('Sin escribir nada sale primero el que más debe. Escribe su nombre para buscarlo.')),
        {
          id: 'target',
          title: t('¿Cuánto debe en realidad?'),
          hint: s.client
            ? t('Ahora debe {amount}. Escribe el total correcto, no la diferencia.', { amount: money(owedBy(s.client)) })
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
              }, t('No debe nada')))),
        },
        {
          id: 'note',
          title: t('¿Por qué?'),
          hint: t('Queda guardado en cada cuenta que se toque, con tu nombre y la fecha.'),
          ready: (st) => st.note.trim().length > 1,
          build: (st, api) => h('div',
            posField(t('Motivo'), posText({
              value: st.note,
              placeholder: t('Ej. la quincena de agosto se cobró doble'),
              maxlength: 90,
              onChange: (v) => { st.note = v; api.revalidate(); },
            })),
            h('div.poschips', { style: { marginTop: '14px' } },
              ['Se le cobró de más', 'Corrección del cuaderno', 'Descuento acordado']
                .map((text) => h('button.poschip', {
                  type: 'button',
                  onclick: () => { st.note = text; api.refresh(); },
                }, t(text))))),
        },
        {
          id: 'confirm',
          title: t('Revisa el saldo'),
          last: true,
          build: (st) => {
            const was = owedBy(st.client);
            const difference = round2(st.target - was);
            return h('div',
              posSummary([
                ...whoRows(st.client),
                [t('Motivo'), st.note.trim()],
                [t('Debía'), money(was)],
                [difference > 0 ? t('Se le suman') : t('Se le bajan'), money(Math.abs(difference))],
                [t('Va a deber'), money(st.target), { total: true }],
              ]),
              difference > 0
                ? posNote(t('Se le agrega una deuda nueva por la diferencia, con ese motivo.'), 'ok')
                : posNote(t('Se baja de sus cuentas más recientes. Lo que ya está pagado no se toca: para devolver dinero hay que cancelar el pago.'), 'ok'));
          },
        },
      ],
      commit: (s) => adjustBalance(
        { client: s.client, target: s.target, note: s.note.trim() }, author()),
      done: (s) => ({
        what: t('Saldo en {amount}', { amount: money(s.target) }),
        who: `${s.client.name} · ${s.note.trim()}`,
      }),
    });
  }

  /* --- Pausar o reactivar ------------------------------------------------- */

  function flowStatus() {
    start({
      title: t('Pausar o reactivar'),
      subject: subjectOf,
      steps: (s) => [
        whoStep(),
        {
          id: 'status',
          title: t('¿Qué pasa con esta persona?'),
          hint: s.client ? t('Ahora está {status}.', { status: statusWord(s.client.status) }) : '',
          ready: (st) => !!st.status,
          build: (st, api) => posPick({
            columns: 3,
            value: st.status || st.client.status,
            onPick: (v) => { st.status = v; api.revalidate(); },
            advance: api.next,
            options: [
              { value: 'active', label: t('Sigue'), sub: w(t('Recibe comida'), t('Recibe pedido')), icon: 'play' },
              { value: 'paused', label: t('En pausa'), sub: t('Se fue un tiempo'), icon: 'pause' },
              { value: 'inactive', label: t('Ya no'), sub: w(t('Dejó de comer'), t('Ya no pide')), icon: 'ban' },
            ],
          }),
        },
        {
          id: 'confirm',
          title: t('Revisa el cambio'),
          last: true,
          build: (st) => h('div',
            posSummary([
              ...whoRows(st.client),
              [t('Antes'), capitalize(statusWord(st.client.status))],
              [t('Ahora'), capitalize(statusWord(st.status)), { total: true }],
            ]),
            owedBy(st.client) > 0.005 && st.status !== 'active'
              ? posNote(t('Debe {amount}. Su deuda no se borra: sigue en su cuenta para cuando venga a pagar.', {
                amount: money(owedBy(st.client)),
              }), 'warn')
              : null),
        },
      ],
      commit: (s) => setClientStatus(s.client.id, s.status, s.client),
      done: (s) => ({ what: capitalize(statusWord(s.status)), who: s.client.name }),
    });
  }

  /* --- Último día --------------------------------------------------------- */

  function flowLastDay() {
    start({
      title: w(t('Último día'), t('Último día de pedido')),
      subject: subjectOf,
      steps: (s) => [
        whoStep(),
        {
          id: 'day',
          title: w(t('¿Hasta qué día come?'), t('¿Hasta qué día tiene pedido?')),
          hint: t('Toca su último día en el calendario. Ese día todavía se le empaca; al día siguiente queda en pausa solo y sale de la libreta. No se le borra lo que deba.'),
          ready: (st) => !!st.endsOn && st.endsOn >= today(),
          build: (st, api) => {
            // A last day already set and still to come is where the calendar
            // opens, chosen: changing it is then one tap, not a hunt for it.
            if (st.endsOn === undefined && st.client?.endsOn >= today()) st.endsOn = st.client.endsOn;
            return posCalendar({
              value: st.endsOn,
              onPick: (v) => { st.endsOn = v; api.revalidate(); },
              note: (v) => (v
                ? [t('Último día: {day}', { day: formatDayLong(v, { year: false }) }),
                  t('El {day} queda en pausa', { day: formatDayLong(addDays(v, 1), { year: false }) })]
                : [t('Toca un día'), t('Desde hoy hasta un año')]),
            });
          },
        },
        {
          id: 'confirm',
          title: t('Revisa el último día'),
          last: true,
          build: (st) => h('div',
            posSummary([
              ...whoRows(st.client),
              st.client.endsOn && st.client.endsOn !== st.endsOn
                ? [t('Antes'), capitalize(formatDayLong(st.client.endsOn))]
                : null,
              [t('Último día'), capitalize(formatDayLong(st.endsOn)), { total: true }],
              [t('En pausa desde'), capitalize(formatDayLong(addDays(st.endsOn, 1)))],
            ]),
            posNote(t('Se le empaca hasta ese día. Al día siguiente queda en pausa solo. Las {periods} hasta ese día se le siguen cobrando; las que empiecen después, no.', {
              periods: t(periodWordPlural(st.client)),
            }), 'ok'),
            st.client.status !== 'active'
              ? posNote(t('Ahora está {status}: para que vuelva a comer, reactívalo en Pausar o reactivar.', {
                status: statusWord(st.client.status),
              }), 'warn')
              : null),
        },
      ],
      commit: (s) => setEndsOn(s.client.id, s.endsOn),
      done: (s) => ({
        what: w(t('Come hasta el {day}', { day: formatDay(s.endsOn) }), t('Pedidos hasta el {day}', { day: formatDay(s.endsOn) })),
        who: s.client.name,
      }),
    });
  }

  /* --- No puede comer ---------------------------------------------------- */

  /**
   * "No puede comer" — the same list as on the client's file in the panel.
   *
   * Changed here, it is changed there the moment it is saved, and on the
   * packing screen and the day's board the next time they are drawn. It is
   * never printed on a sticker: what somebody cannot eat is for whoever fills
   * the container, not for a label in the back of a van.
   *
   * Typed the way the kitchen says it — «No puerco», «No pollo» — and if the
   * kitchen already writes the same thing another way, that spelling is the
   * one kept (`kitchenSpelling`), so the board counts one line, not two.
   */
  function flowDiet() {
    start({
      title: t('No puede comer'),
      subject: subjectOf,
      steps: (s) => [
        whoStep(),
        {
          id: 'diet',
          title: s.client ? t('¿Qué no puede comer {name}?', { name: firstName(s.client) }) : t('¿Qué no puede comer?'),
          hint: t('Escríbelo y toca Agregar — «No puerco», «No pollo». Para quitar uno, tócalo.'),
          ready: (st) => !!st.client && dietChanged(st),
          build: (st, api) => dietEditor(st, api),
        },
        {
          id: 'confirm',
          title: t('Revisa el cambio'),
          last: true,
          build: (st) => {
            const { added, removed } = dietChanges(st.client.tags || [], dietOf(st));
            return h('div',
              posSummary([
                ...whoRows(st.client),
                added.length ? [t('Se agrega'), added.join(' · ')] : null,
                removed.length ? [t('Se quita'), removed.join(' · ')] : null,
                [t('No puede comer'), dietWords(dietOf(st)), { total: true }],
              ]),
              posNote(t('Se ve en su ficha y en la pantalla de empaque. No sale en la etiqueta.'), 'ok'));
          },
        },
      ],
      commit: (s) => updateClient(s.client.id, { tags: dietOf(s) }),
      done: (s) => ({
        what: dietOf(s).length ? t('Lista guardada') : t('Come de todo'),
        who: `${s.client.name} · ${dietWords(dietOf(s))}`,
      }),
    });
  }

  /**
   * The list being edited: started from the person picked, and started again
   * if somebody goes back and picks somebody else.
   */
  function dietOf(st) {
    if (st.dietFor !== st.client?.id) {
      st.diet = [...(st.client?.tags || [])];
      st.dietFor = st.client?.id;
    }
    return st.diet;
  }

  function dietChanged(st) {
    const { added, removed } = dietChanges(st.client?.tags || [], dietOf(st));
    return added.length + removed.length > 0;
  }

  /**
   * What they cannot eat, each one a button that takes it off; a box to type
   * another; and the ones the kitchen already uses, a tap away — narrowed to
   * the ones that look like what is being typed.
   */
  function dietEditor(st, api) {
    const list = dietOf(st);
    const now = h('div');
    const warning = h('div');
    const picks = h('div');
    const inUse = () => tagsInUse(store.clients, 'tags');

    const box = posText({
      value: '',
      placeholder: t('Ej. No puerco'),
      onChange: () => { mount(warning); paintPicks(); },
      onkeydown: (event) => {
        if (event.key !== 'Enter') return;
        // Enter adds it. It must not also move the flow to the next step.
        event.preventDefault();
        add(box.value);
      },
    });

    function add(text) {
      const tag = kitchenSpelling(text, inUse());
      if (!tag) return;
      const there = list.find((one) => sameDiet(one, tag));
      if (there) {
        mount(warning, posNote(t('«{tag}» ya está en su lista.', { tag: there }), 'bad'));
        return;
      }
      list.push(tag);
      box.value = '';
      box.focus();
      paint();
      api.revalidate();
    }

    function remove(tag) {
      list.splice(list.indexOf(tag), 1);
      paint();
      api.revalidate();
    }

    function paintNow() {
      mount(now, list.length
        ? h('div.posdiet', list.map((tag) => h('button.posdiet__tag', {
            type: 'button',
            'aria-label': t('Quitar {name}', { name: tag }),
            onclick: () => remove(tag),
          }, icon('noEat'), h('span', tag), icon('x'))))
        : posNote(t('Come de todo: no tiene nada en la lista.'), 'ok'));
    }

    function paintPicks() {
      const typed = dietKey(box.value);
      const options = inUse()
        .filter((entry) => !list.some((one) => sameDiet(one, entry.tag)))
        .filter((entry) => !typed || dietKey(entry.tag).includes(typed))
        .slice(0, 12);
      mount(picks, options.length
        ? h('div.posdiet__more',
            posLabel(typed ? t('Las que se parecen') : t('Las que ya se usan en la cocina')),
            h('div.poschips', options.map((entry) => h('button.poschip', {
              type: 'button',
              onclick: () => add(entry.tag),
            }, `+ ${entry.tag}`))))
        : null);
    }

    function paint() {
      mount(warning);
      paintNow();
      paintPicks();
    }
    paint();

    return h('div',
      posLabel(t('No puede comer')),
      now,
      h('div.posadd.posdiet__add',
        h('div.grow', posField(t('Agregar'), box)),
        h('button.posbtn.posbtn--add', { type: 'button', onclick: () => add(box.value) },
          icon('plus'), t('Agregar'))),
      warning,
      picks);
  }

  /* --- Organizar libreta ------------------------------------------------- */

  /**
   * The order of a libreta, from the kitchen — and the locations no libreta
   * has, to put in it where they go (see js/ui/libreta-order.js).
   *
   * Their own libreta, when they have one; otherwise they say which. Saved
   * against the libretas as they are at that moment, not as they were when
   * the sheet opened: the other computer may have changed its own meanwhile.
   */
  async function organize({ lineId = null, bring = null } = {}) {
    if (!packingSetup?.lines) {
      toastBad(t('Todavía no cargan las libretas. Intenta en un momento.'));
      return;
    }
    const line = (lineId && lineOf(packingSetup.lines, lineId))
      || myLine() || await whichLibreta(packingSetup.lines);
    if (!line) return;
    const picked = await arrangeSheet({
      lines: packingSetup.lines, line, farms: store.farms, clients: store.clients,
      takeFree: true, title: t('Organizar {line}', { line: line.name }), bring,
    });
    if (!picked) return;
    const next = arrangeLine(packingSetup.lines, line.id, picked, store.farms, store.clients);
    try {
      await savePacking(next, { name: me?.name || '' });
      toastOk(picked.added.length
        ? t('{places} en {line}', {
          places: plural(picked.added.length, 'ubicación nueva', 'ubicaciones nuevas'), line: line.name,
        })
        : t('Orden guardado'));
    } catch (error) { toastBad(errorText(error)); }
  }

  /**
   * "Está bien ahí": a location the system put in a libreta with the rest of
   * its farm, written in for good where it already was.
   */
  async function confirmSpot(lineId, key) {
    const line = lineOf(packingSetup?.lines, lineId);
    if (!line) return;
    const next = confirmPlace(packingSetup.lines, line.id, key, store.farms, store.clients);
    try {
      await savePacking(next, { name: me?.name || '' });
      toastOk(t('Quedó en {line}', { line: line.name }));
    } catch (error) { toastBad(errorText(error)); }
  }

  /* --- Avisos, Novedades and the board ---------------------------------- */

  /**
   * Everything the avisos are made of, from what is on screen now: who is in
   * no libreta, which new locations went in by themselves, and what changed
   * on the board since somebody looked at it.
   */
  function kitchenFound() {
    if (!packingSetup?.lines || !store.loaded.clients || !store.loaded.farms) return null;
    const day = today();
    const serving = activeClients();
    const lines = packingSetup.lines;
    // Who is about to eat too: people registered ahead who start in the next
    // two weeks, and people the Programador is moving to another house — so a
    // location is in a libreta before the morning it is needed.
    const soon = addDays(day, 14);
    const starting = store.clients.filter((client) => client.status === 'paused'
      && client.startsOn > day && client.startsOn <= soon);
    const moving = store.schedule
      .filter((set) => set.state === 'pending' && set.kind === 'location' && set.on <= soon)
      .map((set) => ({ ...(store.clients.find((one) => one.id === set.clientId) || {}),
        id: `${set.clientId}@${set.id}`, farmId: set.value?.farmId, locationId: set.value?.locationId }))
      .filter((one) => one.name);
    const problems = placementProblems({
      lines, farms: store.farms, clients: [...serving, ...starting, ...moving],
    });
    const board = dayBoard({ lines, farms: store.farms, clients: serving, day });
    const names = Object.fromEntries(store.clients.map((client) => [client.id, client.name]));
    const change = boardChanges(packingSetup.boardSeen,
      { day, plates: board.plates.total, plan: board.plan, names });
    return { ...problems, change };
  }

  // Declarations rather than consts: the menu is first drawn before this
  // part of the function has run.
  function newsGroups() {
    const byId = new Map([...store.scheduleRecent, ...store.schedule].map((set) => [set.id, set]));
    return novedades({
      clients: store.clients, lines: packingSetup?.lines || [], day: today(),
      scheduled: [...byId.values()], farms: store.farms,
    });
  }

  // When this computer last opened Novedades, for the count on its button. On
  // the machine, not shared: the count is "new to whoever sits here".
  function newsSeenAt() {
    try { return Number(localStorage.getItem('aguila.novedades.vistas')) || 0; } catch { return 0; }
  }

  function showNews() {
    news?.close();
    news = openNovedades({ read: newsGroups });
    try { localStorage.setItem('aguila.novedades.vistas', String(Date.now())); } catch { /* the count just stays */ }
    paintTiles();
  }

  function showAvisos() {
    news?.close();
    news = openAvisos({
      read: () => avisosFrom(kitchenFound()),
      canArrange: allowed?.organize === true,
      lines: packingSetup?.lines || [],
      actions: {
        place: (lineId, key) => organize({ lineId, bring: key }),
        move: (lineId, key) => organize({ lineId, bring: key }),
        confirm: (lineId, key) => confirmSpot(lineId, key),
        board: () => openBoard(),
      },
    });
  }

  /** The day's board, written down as seen by whoever is sitting here. */
  function openBoard() { openDayBoard({ by: me?.name || '' }); }

  /**
   * Empacar — but not past people nobody is going to pack without saying so.
   * The packer goes on if they choose: the plates of everybody in a libreta
   * still have to go out. They just do it knowing.
   */
  async function startPacking(ready) {
    const where = myLine() ? `/empaque/${myLine().id}` : '/empaque';
    const red = ready ? avisosFrom(kitchenFound()).filter((aviso) => aviso.tone === 'bad') : [];
    if (!red.length) { go(where); return; }
    const choice = await sheet({
      title: t('Antes de empacar'),
      build: (close) => h('div.stack.stack-4',
        h('div.posnote.posnote--bad', icon('alert'), h('div',
          t('Hay gente que come y no está en ninguna libreta: nadie la va a empacar.'))),
        h('ul.stack.stack-2', red.map((aviso) => h('li.t-md', aviso.text))),
        button(t('Ver avisos'), {
          variant: 'primary', size: 'lg', block: true, icon: 'alert', onClick: () => close('avisos'),
        }),
        button(t('Empacar de todos modos'), {
          variant: 'soft', size: 'lg', block: true, icon: 'box', onClick: () => close('pack'),
        })),
    });
    if (choice === 'avisos') showAvisos();
    else if (choice === 'pack') go(where);
  }

  /** "¿Cuál libreta?" — for somebody the manager has not given one. */
  function whichLibreta(lines) {
    return sheet({
      title: t('Organizar libreta'),
      build: (close) => h('div.stack.stack-3',
        h('p.t-sm.c-soft', t('¿Cuál vas a organizar?')),
        lines.map((line) => {
          const count = orderedPlaces(lines, line.id, store.farms, store.clients).length;
          return button(`${line.name} · ${plural(count, 'ubicación', 'ubicaciones')}`, {
            variant: 'soft', size: 'lg', block: true, icon: 'sort', onClick: () => close(line),
          });
        })),
    });
  }

  return () => {
    window.removeEventListener('resize', onResize);
    clearTimeout(resizeTimer);
    stop();
    stopTill?.();
    stopUsers?.();
    stopSetup?.();
    news?.close();
    unmountPos();
  };
}

/* --- Small helpers ---------------------------------------------------------- */

const firstName = (client) => String(client?.name || '').trim().split(/\s+/)[0] || t('el cliente');

/** "No pollo · No puerco", or that there is nothing on the list. */
const dietWords = (tags) => (tags.length ? tags.join(' · ') : t('Nada, come de todo'));

const statusWord = (status) => (
  status === 'paused' ? t('en pausa') : status === 'inactive' ? t('ya no come aquí') : t('activo'));

/** What a fortnight would cost with `patch` applied — the live price preview. */
function priceLabel(client, patch = {}) {
  const charge = periodCharge({ ...client, ...patch }, store.pricing);
  return charge.priced ? money(charge.amount) : t('Sin precio');
}

const dayWords = (days) => {
  const order = [1, 2, 3, 4, 5, 6, 0];
  const on = order.filter((d) => (days || []).map(Number).includes(d));
  return on.length ? on.map((d) => WEEKDAYS_SHORT[d]).join(' · ') : t('Ningún día');
};

/**
 * The collection days worth offering: a couple behind and a few ahead.
 *
 * Behind, because the day somebody paid is usually already past by the time it
 * is being typed in; ahead, because somebody starting this week starts on the
 * next collection day, and their first fortnight is paid the day it ends.
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
