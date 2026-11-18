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
import { errorText } from '../firebase.js';
import { t } from '../lib/i18n.js';

/**
 * What was being written to each thread, kept for as long as the app is open.
 *
 * The view is built again every time a thread is opened, and its box came
 * back empty: half a message, a look at another screen to check an amount,
 * and it was gone.
 */
const drafts = new Map();

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
  /** The day the thread was last drawn on: "Hoy" is only true until midnight. */
  let drawnOn = '';

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
    drawnOn = dayKey();

    if (!loaded) {
      mount(scroll, h('div.loading', h('div.spinner')));
      return;
    }
    if (!messages.length) {
      mount(scroll, emptyState({
        icon: 'chat',
        title: t('Empiecen la conversación'),
        text: emptyText || t('Escriban aquí cualquier duda sobre las entregas o los pagos.'),
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
          message.pending ? t('enviando…') : formatTime(message.atDate),
          outgoing && !message.pending
            ? h(`span${read ? '.is-read' : ''}`, icon(read ? 'checkDouble' : 'check'))
            : null)));
  }

  /* --- Composer ------------------------------------------------------------ */

  function buildComposer() {
    const box = h('textarea.chat__input', {
      rows: 1,
      // What the rules accept in one message; past it the send would be
      // refused with nothing on screen saying why.
      maxlength: 4000,
      placeholder: t('Escribe un mensaje…'),
      'aria-label': t('Mensaje'),
      oninput: () => {
        drafts.set(clientId, box.value);
        send.disabled = !box.value.trim() || sending;
      },
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
      type: 'button', disabled: true, 'aria-label': t('Enviar'),
      onclick: submit,
    }, icon('send'));

    async function submit() {
      const text = box.value.trim();
      if (!text || sending) return;

      sending = true;
      send.disabled = true;
      box.value = '';
      drafts.delete(clientId);
      box.style.height = 'auto';
      pinned = true;

      try {
        // Without internet the message waits on this phone ("enviando…") and
        // goes when it is back; the box is free for the next one meanwhile.
        const sent = sendMessage(clientId, { text }, { ...sender, role }, client);
        sent.catch(() => {});
        await Promise.race([sent, new Promise((resolve) => { setTimeout(resolve, 4000); })]);
      } catch (error) {
        box.value = text;         // never lose what someone typed
        drafts.set(clientId, text);
        autosizeNow(box);
        toastBad(errorText(error));
      } finally {
        sending = false;
        send.disabled = !box.value.trim();
      }
    }

    const form = h('div.chat__composer', box, send);
    form.insertText = (text) => {
      // Once: a question already sitting in the box — kept from the last time
      // this thread was open — is not asked a second time on the same line.
      if (!box.value.includes(text)) box.value = box.value ? `${box.value} ${text}` : text;
      drafts.set(clientId, box.value);
      autosizeNow(box);
      box.focus();
      send.disabled = !box.value.trim();
    };

    // What was left unsent here the last time.
    if (drafts.get(clientId)) {
      box.value = drafts.get(clientId);
      send.disabled = !box.value.trim();
      // Its height can only be measured once it is on the page.
      requestAnimationFrame(() => { if (box.isConnected) autosizeNow(box); });
    }
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
    if (!messages.length || !looking()) return;
    const unread = role === 'admin' ? conversation?.unreadAdmin : conversation?.unreadClient;
    const now = Date.now();
    if (!unread && now - markedAt < 5000) return;
    markedAt = now;
    markRead(clientId, role);
  }

  /*
   * "Read" means somebody could be reading: the thread is on the screen, in
   * the window in front, with a line to the other side. A thread left open in
   * a tab nobody was looking at used to mark every new message read as it
   * arrived — no badge anywhere, and two ticks on the sender's phone. And
   * without signal the mark was queued, and went out later over messages that
   * had come in the meantime and that nobody had opened.
   */
  function looking() {
    // "In front" is asked of a window on a computer, where another one can
    // cover it. A phone shows one app at a time, and some report no focus
    // until the first touch: there, being on screen is being in front.
    const inFront = isTouch() || document.hasFocus();
    return document.visibilityState === 'visible' && inFront && navigator.onLine !== false;
  }

  // Coming back to the window is when the reading happens — and, if the
  // date turned while it was away, when "Hoy" has to stop meaning yesterday.
  const onLook = () => {
    if (loaded && drawnOn && drawnOn !== dayKey()) renderMessages();
    if (pinned) clearUnread();
  };
  document.addEventListener('visibilitychange', onLook);
  window.addEventListener('focus', onLook);
  window.addEventListener('online', onLook);

  return {
    node,
    destroy() {
      for (const stop of stops) { try { stop(); } catch { /* already detached */ } }
      document.removeEventListener('visibilitychange', onLook);
      window.removeEventListener('focus', onLook);
      window.removeEventListener('online', onLook);
    },
  };
}

const isTouch = () => window.matchMedia('(hover: none)').matches;

function autosizeNow(el) {
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}
