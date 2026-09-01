/**
 * The admin app's live data.
 *
 * Farms, clients, outstanding invoices, recent receipts and the message inbox
 * are needed by several screens at once — the roster, the notebook, the tab
 * badge, a client's file. Opening one listener per screen would mean several
 * copies of the same query and a visible reload on every navigation, so the
 * store keeps a single subscription for each and screens just read from it.
 *
 * Listeners live as long as the signed-in session, and are torn down on
 * sign-out so a second account never sees the previous one's data.
 */

import {
  watchClients, servingStatus, isServing, daysLeft, cycleIsSet,
} from './clients.js';
import { watchFarms } from './farms.js';
import { watchPricing } from './pricing.js';
import { watchBusiness, DEFAULT_BUSINESS } from './business.js';
import { watchOutstanding, summarizeInvoices, groupByClient } from './invoices.js';
import { watchRecentReceipts, cancelledIds, RECENT_RECEIPTS } from './receipts.js';
import { watchConversations, totalUnread } from './chat.js';
import { today, formatDay, weekdayName } from '../lib/dates.js';
import { summarize, periodFor, payDayAfter } from '../lib/billing.js';
import { DEFAULT_PRICING, chargeFor, tierFor } from '../lib/pricing.js';

const state = {
  day: today(),
  // The price list starts at the defaults so the first render already quotes a
  // real number instead of $0 while the document loads.
  pricing: { ...DEFAULT_PRICING },
  // What goes at the top of a printed receipt. Defaults until the document
  // loads, so the first print of a session is never headerless.
  business: { ...DEFAULT_BUSINESS },
  farms: [],
  clients: [],
  outstanding: [],
  receipts: [],
  conversations: [],
  loaded: {
    pricing: false, farms: false, clients: false,
    outstanding: false, receipts: false, conversations: false,
  },
  errors: {},
};

const subscribers = new Set();
let stops = [];

export const store = state;

/** Subscribe to any store change. Fires immediately with the current state. */
export function subscribe(fn) {
  subscribers.add(fn);
  fn(state);
  return () => subscribers.delete(fn);
}

const emit = () => { for (const fn of subscribers) fn(state); };

/**
 * Records a listener's failure and stops waiting on it.
 *
 * Marking it loaded is the important half. Screens gate their skeletons on
 * `loaded`, so a listener that errors and never reports would leave the app
 * shimmering forever with nothing said — which is exactly the shape of failure
 * that is hardest to diagnose from the outside. Better to render, and render
 * the reason.
 */
const failed = (key) => (error) => {
  state.errors[key] = error;
  state.loaded[key] = true;
  emit();
};

/** The first listener failure, if any — what the screens surface. */
export const firstError = () => {
  const [key] = Object.keys(state.errors);
  return key ? { key, error: state.errors[key] } : null;
};

export function startStore() {
  stopStore();
  state.errors = {};

  stops = [
    // Not fatal if it fails: a receipt with the default header still prints,
    // and nothing else on the panel depends on it.
    watchBusiness((row) => { state.business = row; emit(); }, () => {}),

    watchPricing((pricing) => {
      state.pricing = pricing;
      state.loaded.pricing = true;
      emit();
    }, failed('pricing')),

    watchFarms((rows) => {
      state.farms = rows;
      state.loaded.farms = true;
      emit();
    }, failed('farms')),

    watchClients((rows) => {
      state.clients = rows;
      state.loaded.clients = true;
      emit();
    }, failed('clients')),

    watchOutstanding((rows) => {
      state.outstanding = rows;
      state.loaded.outstanding = true;
      emit();
    }, failed('outstanding')),

    // Enough of the till to answer "when did this one last pay?" for everybody
    // on the notebook page, in one query instead of one per client.
    watchRecentReceipts((rows) => {
      state.receipts = rows;
      state.loaded.receipts = true;
      emit();
    }, failed('receipts')),

    watchConversations((rows) => {
      state.conversations = rows;
      state.loaded.conversations = true;
      emit();
    }, failed('conversations')),
  ];
}

export function stopStore() {
  for (const stop of stops) { try { stop(); } catch { /* already detached */ } }
  stops = [];
  Object.assign(state, {
    pricing: { ...DEFAULT_PRICING },
    business: { ...DEFAULT_BUSINESS },
    farms: [], clients: [], outstanding: [], receipts: [], conversations: [],
    loaded: {
      pricing: false, farms: false, clients: false,
      outstanding: false, receipts: false, conversations: false,
    },
    errors: {},
  });
}

/* --- Derived views --------------------------------------------------------- */

export const farmById = (id) => state.farms.find((farm) => farm.id === id) || null;

export const clientById = (id) => state.clients.find((client) => client.id === id) || null;

/**
 * Everybody still being served today.
 *
 * `isServing`, not `status === 'active'`: somebody whose last day has passed
 * is finished, and the count, the libreta and the billing scan all have to
 * agree about that on the same morning without anybody flipping a switch.
 */
export const activeClients = () => state.clients.filter((client) => isServing(client, state.day));

/** Everyone registered at one farm, alphabetical. */
export const clientsOfFarm = (farmId) =>
  state.clients.filter((client) => client.farmId === farmId);

/** Everyone standing at one location of one farm. */
export const clientsAtLocation = (farmId, locationId) =>
  state.clients.filter((client) => client.farmId === farmId && client.locationId === locationId);

/** Head-count and money for one farm, from data already in memory. */
export function farmStats(farmId) {
  const roster = clientsOfFarm(farmId);
  const active = roster.filter((client) => isServing(client, state.day));
  const balance = roster.reduce((sum, client) => sum + (billingFor(client)?.balance || 0), 0);
  return {
    total: roster.length,
    active: active.length,
    meals: active.reduce((sum, client) => sum + (Number(client.mealsPerDay) || 0), 0),
    balance: Math.round(balance * 100) / 100,
  };
}

export const moneyStats = () => summarizeInvoices(state.outstanding);

export const debtors = () => groupByClient(state.outstanding);

export const unreadCount = () => totalUnread(state.conversations, 'admin');

/** Outstanding invoices for one client. */
export const invoicesFor = (clientId) =>
  state.outstanding.filter((invoice) => invoice.clientId === clientId);

/** Billing summary for one client, from data already in memory. */
export const billingFor = (client) =>
  (client ? summarize(client, invoicesFor(client.id)) : null);

/**
 * Everything the roster needs to say about one person, in one object.
 *
 * The screens used to each work this out again — one asking "does this client
 * owe money", another "is this one overdue", a third counting the same people
 * for a filter chip. Deriving it once means a row, its badge, its filter and
 * the count on that filter's chip can never disagree.
 *
 *   state   what to show and what to filter on, in one word
 *   owed    money outstanding right now
 *   behind  fortnights with an unpaid bill
 *   covered whether the fortnight in progress is already paid for
 *   gaps    the things that stop this person being served or billed at all
 */
export function clientState(client) {
  const billing = billingFor(client);
  const period = periodFor(client.cycleAnchor || today(), today());
  const paidThrough = client.paidThrough || null;
  const covered = !!paidThrough && paidThrough >= period.end;
  const serving = servingStatus(client, state.day);

  // A gap is something that stops this person being served or billed. Not
  // having an email is neither — most workers do not have one the day they are
  // registered, and flagging every one of them would make the flag meaningless.
  const gaps = {
    noPlan: !tierFor(state.pricing, client.mealsPerDay),
    noPlace: !client.locationId,
    noAccess: !client.email,
  };

  return {
    client,
    billing,
    period,
    paidThrough,
    covered,
    owed: billing?.balance || 0,
    behind: billing?.outstanding?.length || 0,
    overdue: billing?.overdueCount || 0,
    gaps,
    hasGap: gaps.noPlan || gaps.noPlace,
    // The day they pay next, which is the first day of the fortnight after
    // this one — not the invoice's due date, which adds the grace days.
    payDay: payDayAfter(period),
    // Whether their fortnight is a day somebody confirmed, or still the
    // rancho's placeholder. The roster filters on it while the notebook is
    // being migrated across.
    cycleSet: cycleIsSet(client),
    serving,
    endsOn: client.endsOn || null,
    daysLeft: daysLeft(client, state.day),
    state: nameState(client, billing, covered, serving),
  };
}

/**
 * One word for where this client stands, in the order the kitchen cares.
 *
 * Money first: somebody who left the service still owes what they owe, and a
 * roster that hides that behind "Inactivo" is how debts get written off by
 * accident.
 */
function nameState(client, billing, covered, serving) {
  if ((billing?.overdueCount || 0) > 0) return 'overdue';
  if ((billing?.balance || 0) > 0) return 'due';
  if (serving === 'inactive') return 'inactive';
  if (serving === 'paused') return 'paused';
  if (covered) return 'covered';
  return 'clear';
}

/** The whole roster, each with its derived state. Computed once per render. */
export const roster = () => state.clients.map(clientState);

/**
 * What one fortnight costs this person: their plan, adjusted for the week they
 * actually eat and the extra plates they take.
 */
export const fortnightPrice = (client) => chargeFor(client, state.pricing);

/** The fortnight they are in right now. */
export const currentPeriodFor = (client) =>
  periodFor(client?.cycleAnchor || state.day, today());

/** Clients whose meals-per-day has no plan — they cannot be billed as they are. */
export const unpriced = () =>
  state.clients.filter((client) => servingStatus(client, state.day) !== 'inactive'
    && !tierFor(state.pricing, client.mealsPerDay));

export const conversationFor = (clientId) =>
  state.conversations.find((row) => row.id === clientId) || null;

/**
 * One client's payments, newest first, out of the recent till.
 *
 * Cancellations are resolved here rather than by each screen, because the two
 * screens that forgot to do it both ended up showing money the kitchen had
 * already taken back as if it were still paid. `standing` is what a payment
 * line should show: the ones that still count.
 */
export const receiptsFor = (clientId) =>
  state.receipts.filter((row) => row.clientId === clientId);

export function paymentsFor(clientId) {
  const voided = cancelledIds(state.receipts);
  return state.receipts.filter((row) => row.clientId === clientId
    && Number(row.amount) > 0
    && !voided.has(row.id));
}

/**
 * True when the till window is full, so "no payments here" might only mean
 * "none recently".
 *
 * The window is one query for the whole business. At a couple of hundred
 * clients paying every fortnight it does not reach back forever, and a screen
 * that prints "Sin pagos registrados" from an exhausted window is stating
 * something it does not know.
 */
export const tillIsWindowed = () => state.receipts.length >= RECENT_RECEIPTS;

/**
 * What `printReceipt` needs: the header, and the client's next collection day.
 *
 * The next pay day is the only live figure on an otherwise frozen document, so
 * it is looked up here rather than stored — and it is simply absent when the
 * client is no longer in the roster, which is the honest answer.
 */
export function printContext(receipt) {
  const client = state.clients.find((row) => row.id === receipt?.clientId) || null;
  if (!client?.cycleAnchor) return { business: state.business };

  const period = periodFor(client.cycleAnchor, today());
  const day = payDayAfter(period);
  return {
    business: state.business,
    nextPay: `${weekdayName(day).toUpperCase()} ${formatDay(day).toUpperCase()}`,
  };
}

/** True once the screens have enough to render without skeletons. */
export const isReady = () => state.loaded.farms && state.loaded.clients;
