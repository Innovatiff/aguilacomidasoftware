/**
 * Messaging — one thread per farm.
 *
 * The conversation id *is* the client id. There is exactly one thread between a
 * farm and the kitchen, which is what the business actually has: no thread
 * list to reconcile, no way to start a duplicate conversation, and a client's
 * security rule is a single id comparison.
 *
 * Read receipts are stored as two timestamps on the conversation
 * (`adminReadAt` / `clientReadAt`) rather than a flag on every message. A
 * message counts as read when the other side's marker is at or past it, so
 * opening a thread with 200 messages is one small write, not 200.
 */

import {
  db, doc, collection, getDoc, setDoc, updateDoc, onSnapshot, query, orderBy,
  limit as qLimit, serverTimestamp, increment, writeBatch, toDate,
  docData, listData,
} from '../firebase.js';
import { dayKey } from '../lib/dates.js';

const conversationsRef = () => collection(db, 'conversations');
const messagesRef = (clientId) => collection(db, 'conversations', clientId, 'messages');

/** Keeps the thread-list preview short without loading the message itself. */
const PREVIEW_MAX = 140;
const preview = (text) => {
  const flat = String(text || '').replace(/\s+/g, ' ').trim();
  return flat.length > PREVIEW_MAX ? `${flat.slice(0, PREVIEW_MAX - 1)}…` : flat;
};

/* --- Reads ----------------------------------------------------------------- */

/** Every thread, most recently active first — the admin's inbox. */
export function watchConversations(onData, onError) {
  return onSnapshot(
    query(conversationsRef(), orderBy('lastAt', 'desc')),
    (snap) => onData(listData(snap)),
    onError,
  );
}

export function watchConversation(clientId, onData, onError) {
  return onSnapshot(doc(db, 'conversations', clientId),
    (snap) => onData(docData(snap)), onError);
}

/**
 * The tail of a thread, oldest-first for rendering.
 *
 * Firestore can only limit from one end, so we take the newest `count` and
 * reverse them — otherwise a long-running thread would show its first messages
 * forever and never the latest.
 */
export function watchMessages(clientId, onData, onError, count = 200) {
  return onSnapshot(
    query(messagesRef(clientId), orderBy('at', 'desc'), qLimit(count)),
    (snap) => {
      const rows = listData(snap).reverse();
      // A just-sent message has a null server timestamp until the server
      // acknowledges it; treat it as "now" so it sorts and renders correctly.
      onData(rows.map((row) => ({ ...row, atDate: toDate(row.at) || new Date(), pending: !row.at })));
    },
    onError,
  );
}

export const getConversation = async (clientId) =>
  docData(await getDoc(doc(db, 'conversations', clientId)));

/* --- Writes ---------------------------------------------------------------- */

/**
 * Creates the thread if it does not exist yet.
 *
 * Reads before writing on purpose. A merge-write here would re-apply
 * `unreadAdmin: 0` and `unreadClient: 0` every time somebody opened the
 * conversation — silently clearing the *other* side's unread badge and
 * hiding messages they had not seen.
 */
export async function ensureConversation(client) {
  const ref = doc(db, 'conversations', client.id);
  if ((await getDoc(ref)).exists()) return;

  await setDoc(ref, {
    clientId: client.id,
    clientName: client.name || '',
    unreadAdmin: 0,
    unreadClient: 0,
    createdAt: serverTimestamp(),
  });
}

/**
 * Posts a message and updates the thread summary in one batch, so the inbox
 * preview and the unread badge can never drift from the messages themselves.
 */
export async function sendMessage(clientId, { text, kind = 'text', meta = null }, sender, client) {
  const body = String(text || '').trim();
  if (!body) return null;

  const role = sender.role === 'admin' ? 'admin' : 'client';
  const batch = writeBatch(db);
  const messageRef = doc(messagesRef(clientId));

  batch.set(messageRef, {
    text: body,
    kind,
    meta,
    senderUid: sender.uid,
    senderName: sender.name || '',
    senderRole: role,
    at: serverTimestamp(),
  });

  // Written only when we actually have one. A merge-write carrying '' would
  // blank the name on a thread somebody opened without the client loaded, and
  // the inbox would show a row with no name on it.
  const named = client?.name || sender.clientName || '';

  batch.set(doc(db, 'conversations', clientId), {
    clientId,
    ...(named ? { clientName: named } : {}),
    lastMessage: preview(body),
    lastAt: serverTimestamp(),
    lastSenderRole: role,
    lastSenderName: sender.name || '',
    lastKind: kind,
    // Only the *other* side's counter moves; the sender has obviously read it.
    ...(role === 'admin'
      ? { unreadClient: increment(1) }
      : { unreadAdmin: increment(1) }),
    updatedAt: serverTimestamp(),
  }, { merge: true });

  await batch.commit();
  return messageRef.id;
}

/**
 * An app-generated note in the thread — a recorded payment, a delivery problem.
 * These do not raise the unread badge: they are context, not a request.
 */
export async function postSystemMessage(clientId, text, { meta = null, notify = false } = {}) {
  const batch = writeBatch(db);
  batch.set(doc(messagesRef(clientId)), {
    text: String(text).trim(),
    kind: 'system',
    meta,
    senderUid: null,
    senderName: 'El Águila Cocina',
    senderRole: 'system',
    at: serverTimestamp(),
  });

  batch.set(doc(db, 'conversations', clientId), {
    clientId,
    lastMessage: preview(text),
    lastAt: serverTimestamp(),
    lastSenderRole: 'system',
    lastKind: 'system',
    ...(notify ? { unreadClient: increment(1) } : {}),
    updatedAt: serverTimestamp(),
  }, { merge: true });

  await batch.commit();
}

/** Clears this side's unread count and moves its read marker to now. */
export async function markRead(clientId, role) {
  const patch = role === 'admin'
    ? { unreadAdmin: 0, adminReadAt: serverTimestamp() }
    : { unreadClient: 0, clientReadAt: serverTimestamp() };
  try {
    await updateDoc(doc(db, 'conversations', clientId), patch);
  } catch {
    // The thread may not exist yet (a farm that has never written). Nothing to clear.
  }
}

/* --- Derived --------------------------------------------------------------- */

/** True when the other side has read a message of ours. */
export function isReadByOther(message, conversation, myRole) {
  if (!conversation || message.senderRole !== myRole) return false;
  const marker = toDate(myRole === 'admin' ? conversation.clientReadAt : conversation.adminReadAt);
  if (!marker) return false;
  return marker.getTime() >= (message.atDate?.getTime() ?? 0);
}

export const unreadFor = (conversation, role) =>
  Number(role === 'admin' ? conversation?.unreadAdmin : conversation?.unreadClient) || 0;

export const totalUnread = (conversations, role) =>
  conversations.reduce((sum, convo) => sum + unreadFor(convo, role), 0);

/**
 * Splits a flat message list into day groups so the thread can print a date
 * separator, and marks the last message of each same-sender run — only that
 * one gets a tail on its bubble.
 */
export function groupMessages(messages) {
  const groups = [];
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    const day = dayOf(message.atDate);
    if (!groups.length || groups[groups.length - 1].day !== day) {
      groups.push({ day, date: message.atDate, items: [] });
    }
    const next = messages[i + 1];
    const isTail = !next
      || next.senderRole !== message.senderRole
      || dayOf(next.atDate) !== day
      || (next.atDate - message.atDate) > 5 * 60 * 1000;
    groups[groups.length - 1].items.push({ ...message, isTail });
  }
  return groups;
}

// Local calendar day, not UTC: a message sent at 7pm PST must not group under
// the following day just because UTC has already rolled over.
const dayOf = (date) => (date ? dayKey(date) : '');
