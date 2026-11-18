/**
 * Inbox — one thread per client, most recent first, unread on top of the fold.
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
import { plural } from '../lib/format.js';
import { toDate } from '../firebase.js';
import { t } from '../lib/i18n.js';

export function renderMessages() {
  let term = '';

  const draw = () => {
    const rows = threads();
    screen({
      title: t('Mensajes'),
      subtitle: unreadLabel(),
      tab: 'messages',
      sticky: h('div.searchbar',
        searchInput({
          placeholder: t('Buscar cliente o rancho…'),
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
   * Every client gets a row, whether or not a thread exists yet — staff should
   * be able to start a conversation from here without opening their file first.
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
      || t('Sin mensajes todavía — toca para escribir.');
    const mine = conversation?.lastSenderRole === 'admin';

    return itemRow({
      lead: avatar(client.name),
      title: client.name,
      meta: h('span', { style: unread ? { color: 'var(--ink-900)', fontWeight: '550' } : null },
        mine ? h('span.c-faint', t('Tú: ')) : null,
        preview),
      end: [
        stamp ? h('span.t-xs.c-faint', formatStamp(stamp)) : null,
        unread ? badge(unread > 99 ? '99+' : String(unread), 'brand') : null,
      ].filter(Boolean),
      chevron: false,
      // Straight in. The thread's summary is written on the way, not waited
      // for: on a slow line the wait was several seconds of nothing, and then
      // the chat opened over whatever screen the reader had moved on to. The
      // chat does not need the summary to open — sending a message writes it.
      onClick: () => {
        if (!conversation) ensureConversation(client).catch(() => {});
        go(`/chat/${client.id}`);
      },
    });
  }

  function unreadLabel() {
    const total = store.conversations.reduce((sum, row) => sum + (Number(row.unreadAdmin) || 0), 0);
    if (!total) return plural(store.clients.length, 'cliente', 'clientes');
    return t('{count} sin leer', { count: total });
  }

  function empty() {
    if (term) {
      return emptyState({ icon: 'search', title: t('Sin resultados'), text: t('Ningún cliente coincide con “{term}”.', { term }) });
    }
    return emptyState({
      icon: 'chat',
      title: t('Todavía no hay clientes'),
      text: t('Registra un cliente para poder escribirle.'),
    });
  }

  // While somebody is typing in the search box only the list is redrawn: a
  // whole repaint rebuilds the box, and the rest of the word goes nowhere.
  // In *this* screen's box, that is — so never before this screen has been
  // drawn once. Reached with the cursor still in another screen's search box
  // (Clientes, then the browser's Back), the first call found that box, drew
  // only a list nobody could see, and left the other screen standing under
  // this one's address.
  let drawn = false;
  return subscribe(() => {
    if (drawn && document.activeElement?.closest?.('.searchbar')) { redraw(); return; }
    drawn = true;
    draw();
  });
}

const unreadOf = (row) => Number(row.conversation?.unreadAdmin) || 0;
