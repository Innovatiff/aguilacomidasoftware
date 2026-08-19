/**
 * The admin app's live data.
 *
 * Clients, the selected day's route, outstanding invoices and the message
 * inbox are needed by several screens at once — the dashboard, the tab badge,
 * the client detail. Opening one listener per screen would mean four copies of
 * the same query and a visible reload on every navigation, so the store keeps a
 * single subscription for each and screens just read from it.
 *
 * Listeners live as long as the signed-in session, and are torn down on
 * sign-out so a second account never sees the previous one's data.
 */

import { watchClients } from './clients.js';
import { watchDay, summarizeDay, missingToday } from './deliveries.js';
import { watchOutstanding, summarizeInvoices, groupByClient } from './invoices.js';
import { watchConversations, totalUnread } from './chat.js';
import { today } from '../lib/dates.js';
import { summarize } from '../lib/billing.js';

const state = {
  day: today(),
  clients: [],
  deliveries: [],
  outstanding: [],
  conversations: [],
  loaded: { clients: false, deliveries: false, outstanding: false, conversations: false },
  error: null,
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

const onError = (error) => {
  state.error = error;
  emit();
};

export function startStore() {
  stopStore();
  state.error = null;

  stops = [
    watchClients((rows) => {
      state.clients = rows;
      state.loaded.clients = true;
      emit();
    }, onError),

    watchOutstanding((rows) => {
      state.outstanding = rows;
      state.loaded.outstanding = true;
      emit();
    }, onError),

    watchConversations((rows) => {
      state.conversations = rows;
      state.loaded.conversations = true;
      emit();
    }, onError),
  ];

  watchSelectedDay();
}

export function stopStore() {
  for (const stop of stops) { try { stop(); } catch { /* already detached */ } }
  stops = [];
  dayStop?.();
  dayStop = null;
  Object.assign(state, {
    clients: [], deliveries: [], outstanding: [], conversations: [],
    loaded: { clients: false, deliveries: false, outstanding: false, conversations: false },
    error: null,
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
  }, onError);
}

/* --- Derived views --------------------------------------------------------- */

export const clientById = (id) => state.clients.find((client) => client.id === id) || null;

export const activeClients = () => state.clients.filter((client) => client.status === 'active');

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
export const isReady = () => state.loaded.clients && state.loaded.deliveries;
