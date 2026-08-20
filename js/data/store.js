/**
 * The admin app's live data.
 *
 * Farms, clients, the selected day's route, outstanding invoices and the
 * message inbox are needed by several screens at once — the dashboard, the tab
 * badge, the client detail. Opening one listener per screen would mean five
 * copies of the same query and a visible reload on every navigation, so the
 * store keeps a single subscription for each and screens just read from it.
 *
 * Listeners live as long as the signed-in session, and are torn down on
 * sign-out so a second account never sees the previous one's data.
 */

import { watchClients } from './clients.js';
import { watchFarms } from './farms.js';
import { watchDay, summarizeDay, missingToday } from './deliveries.js';
import { watchOutstanding, summarizeInvoices, groupByClient } from './invoices.js';
import { watchConversations, totalUnread } from './chat.js';
import { today } from '../lib/dates.js';
import { summarize } from '../lib/billing.js';

const state = {
  day: today(),
  farms: [],
  clients: [],
  deliveries: [],
  outstanding: [],
  conversations: [],
  loaded: {
    farms: false, clients: false, deliveries: false, outstanding: false, conversations: false,
  },
  errors: {},
};

const subscribers = new Set();
let stops = [];
let dayStop = null;

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

    watchConversations((rows) => {
      state.conversations = rows;
      state.loaded.conversations = true;
      emit();
    }, failed('conversations')),
  ];

  watchSelectedDay();
}

export function stopStore() {
  for (const stop of stops) { try { stop(); } catch { /* already detached */ } }
  stops = [];
  dayStop?.();
  dayStop = null;
  Object.assign(state, {
    farms: [], clients: [], deliveries: [], outstanding: [], conversations: [],
    loaded: {
      farms: false, clients: false, deliveries: false, outstanding: false, conversations: false,
    },
    errors: {},
  });
}

/** Switches the day the route screen and dashboard are looking at. */
export function setDay(day) {
  if (state.day === day) return;
  state.day = day;
  state.deliveries = [];
  state.loaded.deliveries = false;
  emit();
  watchSelectedDay();
}

function watchSelectedDay() {
  dayStop?.();
  const day = state.day;
  dayStop = watchDay(day, (rows) => {
    // A late response for a day we have already navigated away from must not
    // overwrite the current one.
    if (state.day !== day) return;
    state.deliveries = rows;
    state.loaded.deliveries = true;
    emit();
  }, failed('deliveries'));
}

/* --- Derived views --------------------------------------------------------- */

export const farmById = (id) => state.farms.find((farm) => farm.id === id) || null;

export const clientById = (id) => state.clients.find((client) => client.id === id) || null;

export const activeClients = () => state.clients.filter((client) => client.status === 'active');

/** Everyone registered at one farm, alphabetical. */
export const clientsOfFarm = (farmId) =>
  state.clients.filter((client) => client.farmId === farmId);

/** Everyone standing at one location of one farm. */
export const clientsAtLocation = (farmId, locationId) =>
  state.clients.filter((client) => client.farmId === farmId && client.locationId === locationId);

/** Head-count and money for one farm, from data already in memory. */
export function farmStats(farmId) {
  const roster = clientsOfFarm(farmId);
  const active = roster.filter((client) => client.status === 'active');
  const balance = roster.reduce((sum, client) => sum + (billingFor(client)?.balance || 0), 0);
  return {
    total: roster.length,
    active: active.length,
    meals: active.reduce((sum, client) => sum + (Number(client.mealsPerDay) || 0), 0),
    balance: Math.round(balance * 100) / 100,
  };
}

export const dayStats = () => summarizeDay(state.deliveries);

export const unscheduled = () => missingToday(state.clients, state.deliveries, state.day);

export const moneyStats = () => summarizeInvoices(state.outstanding);

export const debtors = () => groupByClient(state.outstanding);

export const unreadCount = () => totalUnread(state.conversations, 'admin');

/** Outstanding invoices for one farm. */
export const invoicesFor = (clientId) =>
  state.outstanding.filter((invoice) => invoice.clientId === clientId);

/** Billing summary for one farm, from data already in memory. */
export const billingFor = (client) =>
  (client ? summarize(client, invoicesFor(client.id)) : null);

/** The stop for a farm on the selected day, if any. */
export const deliveryFor = (clientId) =>
  state.deliveries.find((row) => row.clientId === clientId) || null;

export const conversationFor = (clientId) =>
  state.conversations.find((row) => row.id === clientId) || null;

/** True once the screens have enough to render without skeletons. */
export const isReady = () =>
  state.loaded.farms && state.loaded.clients && state.loaded.deliveries;
