/**
 * The conversation view, shared by both apps.
 *
 * The kitchen and the farm see the same thread from opposite sides: `role`
 * decides which bubbles are outgoing, which unread counter to clear, and which
 * canned replies to offer. Everything else — grouping, receipts, scrolling — is
 * identical, so it lives once.
 */

import { h, mount, autosize } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { emptyState } from './kit.js';
import { toastBad } from './overlay.js';
import {
  watchMessages, watchConversation, sendMessage, markRead, groupMessages, isReadByOther,
} from '../data/chat.js';
import { formatTime, relativeDay, dayKey } from '../lib/dates.js';
import { dbMessage } from '../firebase.js';

/**
 * @param {object} config
 * @param {string} config.clientId       the thread id
 * @param {'admin'|'client'} config.role
 * @param {object} config.sender         { uid, name }
 * @param {object} [config.client]       the farm record, when the caller has it
 * @param {string[]} [config.quickReplies]
 * @param {string} [config.emptyText]
 * @returns {{ node: Node, destroy: () => void }}
 */
export function chatView({ clientId, role, sender, client, quickReplies = [], emptyText }) {
  let messages = [];
  let conversation = null;
  let loaded = false;
  let sending = false;
  /** Only auto-scroll when the reader is already at the bottom — otherwise a
   *  new message would yank them away from what they were reading. */
  let pinned = true;

  const scroll = h('div.chat__scroll', { onscroll: onScroll });
  const composer = buildComposer();
  const node = h('div.chat', scroll, quickReplies.length ? buildQuickReplies() : null, composer);

  const stops = [
    watchMessages(clientId, (rows) => {
      messages = rows;
      loaded = true;
      renderMessages();
      clearUnread();
    }, () => { loaded = true; renderMessages(); }),

    watchConversation(clientId, (row) => {
      conversation = row;
      renderMessages();     // receipts depend on the other side's read marker
    }, () => {}),
  ];

  /* --- Messages ------------------------------------------------------------ */

  function renderMessages() {
    const wasPinned = pinned;

    if (!loaded) {
      mount(scroll, h('div.loading', h('div.spinner')));
      return;
    }
    if (!messages.length) {
      mount(scroll, emptyState({
        icon: 'chat',
        title: 'Empiecen la conversación',
        text: emptyText || 'Escriban aquí cualquier duda sobre las entregas o los pagos.',
      }));
      return;
    }

    mount(scroll, groupMessages(messages).map((group) => [
      h('div.chat__day', relativeDay(dayKey(group.date))),
      group.items.map(bubble),
    ]));

    if (wasPinned) toBottom();
  }

  function bubble(message) {
    if (message.senderRole === 'system') {
      return h('div.chat__system', message.text);
    }

    const outgoing = message.senderRole === role;
    const read = outgoing && isReadByOther(message, conversation, role);
    // The admin side shows who on the team wrote, so a farm never wonders
    // which person they are talking to.
    const showAuthor = !outgoing && role === 'admin' && message.senderName;

    return h(`div.msg.msg--${outgoing ? 'out' : 'in'}${message.isTail ? '.is-tail' : ''}`,
      h('div.bubble',
        showAuthor ? h('span.bubble__author', message.senderName) : null,
        h('span', message.text),
        h('span.bubble__foot',
          message.pending ? 'enviando…' : formatTime(message.atDate),
          outgoing && !message.pending
            ? h(`span${read ? '.is-read' : ''}`, icon(read ? 'checkDouble' : 'check'))
            : null)));
  }

  /* --- Composer ------------------------------------------------------------ */

  function buildComposer() {
    const box = h('textarea.chat__input', {
      rows: 1,
      placeholder: 'Escribe un mensaje…',
      'aria-label': 'Mensaje',
      oninput: () => { send.disabled = !box.value.trim() || sending; },
      onkeydown: (event) => {
        // Enter sends on a hardware keyboard; on a phone the key is a newline,
        // which is why the send button is always present.
        if (event.key === 'Enter' && !event.shiftKey && !isTouch()) {
          event.preventDefault();
          submit();
        }
      },
    });
    autosize(box);

    const send = h('button.chat__send', {
      type: 'button', disabled: true, 'aria-label': 'Enviar',
      onclick: submit,
    }, icon('send'));

    async function submit() {
      const text = box.value.trim();
      if (!text || sending) return;

      sending = true;
      send.disabled = true;
      box.value = '';
      box.style.height = 'auto';
      pinned = true;

      try {
        await sendMessage(clientId, { text }, { ...sender, role }, client);
      } catch (error) {
        box.value = text;         // never lose what someone typed
        autosizeNow(box);
        toastBad(dbMessage(error));
      } finally {
        sending = false;
        send.disabled = !box.value.trim();
      }
    }

    const form = h('div.chat__composer', box, send);
    form.insertText = (text) => {
      box.value = box.value ? `${box.value} ${text}` : text;
      autosizeNow(box);
      box.focus();
      send.disabled = !box.value.trim();
    };
    return form;
  }

  function buildQuickReplies() {
    return h('div.quickies',
      quickReplies.map((text) => h('button.quickie', {
        type: 'button',
        onclick: () => composer.insertText(text),
      }, text)));
  }

  /* --- Scroll + read state -------------------------------------------------- */

  function onScroll() {
    const slack = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight;
    pinned = slack < 80;
    if (pinned) clearUnread();
  }

  const toBottom = () => queueMicrotask(() => { scroll.scrollTop = scroll.scrollHeight; });

  let markedAt = 0;
  /**
   * Clears this side's badge and moves its read marker.
   *
   * The marker also drives the *other* side's receipts, so it is refreshed
   * periodically even with nothing unread — but never on every scroll event,
   * which would be a write per frame.
   */
  function clearUnread() {
    if (!messages.length) return;
    const unread = role === 'admin' ? conversation?.unreadAdmin : conversation?.unreadClient;
    const now = Date.now();
    if (!unread && now - markedAt < 5000) return;
    markedAt = now;
    markRead(clientId, role);
  }

  return {
    node,
    destroy() {
      for (const stop of stops) { try { stop(); } catch { /* already detached */ } }
    },
  };
}

const isTouch = () => window.matchMedia('(hover: none)').matches;

function autosizeNow(el) {
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}
