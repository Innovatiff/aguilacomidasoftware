/**
 * Inbox — one thread per farm, most recent first, unread on top of the fold.
 */

import { h } from '../lib/dom.js';
import { screen } from '../ui/shell.js';
import {
  searchInput, itemRow, list, avatar, emptyState, skeletonRows, badge,
} from '../ui/kit.js';
import { go } from '../lib/router.js';
import { store, subscribe } from '../data/store.js';
import { ensureConversation } from '../data/chat.js';
import { matchesSearch } from '../data/clients.js';
import { formatStamp } from '../lib/dates.js';
import { toDate } from '../firebase.js';

export function renderMessages() {
  let term = '';

  const draw = () => {
    const rows = threads();
    screen({
      title: 'Mensajes',
      subtitle: unreadLabel(),
      tab: 'messages',
      sticky: h('div.searchbar',
        searchInput({
          placeholder: 'Buscar rancho…',
          value: term,
          onInput: (value) => { term = value; redraw(); },
        })),
      body: store.loaded.conversations && store.loaded.clients
        ? (rows.length ? list(rows.map(threadRow), { card: false }) : empty())
        : skeletonRows(6),
    });
  };

  function redraw() {
    const host = document.querySelector('.page .list, .page .empty');
    if (!host) return draw();
    const rows = threads();
    host.replaceWith(rows.length ? list(rows.map(threadRow)) : empty());
  }

  /**
   * Every farm gets a row, whether or not a thread exists yet — staff should be
   * able to start a conversation from here without hunting for the client first.
   */
  function threads() {
    return store.clients
      .filter((client) => matchesSearch(client, term))
      .map((client) => ({
        client,
        conversation: store.conversations.find((row) => row.id === client.id) || null,
      }))
      .sort((a, b) => {
        const unread = unreadOf(b) - unreadOf(a);
        if (unread) return unread;
        const at = (row) => toDate(row.conversation?.lastAt)?.getTime() || 0;
        const recency = at(b) - at(a);
        if (recency) return recency;
        return a.client.name.localeCompare(b.client.name, 'es');
      });
  }

  function threadRow({ client, conversation }) {
    const unread = Number(conversation?.unreadAdmin) || 0;
    const stamp = toDate(conversation?.lastAt);
    const preview = conversation?.lastMessage
      || 'Sin mensajes todavía — toca para escribir.';
    const mine = conversation?.lastSenderRole === 'admin';

    return itemRow({
      lead: avatar(client.name),
      title: client.name,
      meta: h('span', { style: unread ? { color: 'var(--ink-900)', fontWeight: '550' } : null },
        mine ? h('span.c-faint', 'Tú: ') : null,
        preview),
      end: [
        stamp ? h('span.t-xs.c-faint', formatStamp(stamp)) : null,
        unread ? badge(unread > 99 ? '99+' : String(unread), 'brand') : null,
      ].filter(Boolean),
      chevron: false,
      onClick: async () => {
        if (!conversation) await ensureConversation(client);
        go(`/chat/${client.id}`);
      },
    });
  }

  function unreadLabel() {
    const total = store.conversations.reduce((sum, row) => sum + (Number(row.unreadAdmin) || 0), 0);
    if (!total) return `${store.clients.length} ranchos`;
    return `${total} sin leer`;
  }

  function empty() {
    if (term) {
      return emptyState({ icon: 'search', title: 'Sin resultados', text: `Ningún rancho coincide con “${term}”.` });
    }
    return emptyState({
      icon: 'chat',
      title: 'Todavía no hay ranchos',
      text: 'Registra un rancho para poder escribirle.',
    });
  }

  return subscribe(draw);
}

const unreadOf = (row) => Number(row.conversation?.unreadAdmin) || 0;
