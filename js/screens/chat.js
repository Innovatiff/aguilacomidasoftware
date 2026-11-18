/**
 * A thread with one farm. The header carries the two things staff need while
 * replying: who this is, and whether they owe money — so a payment question can
 * be answered without leaving the conversation.
 */

import { h } from '../lib/dom.js';
import { screen, topbarButton, lifetime } from '../ui/shell.js';
import { avatar, badge } from '../ui/kit.js';
import { chatView } from '../ui/chat-view.js';
import { go } from '../lib/router.js';
import { session } from '../data/session.js';
import { store, subscribe, billingFor } from '../data/store.js';
import { getClient } from '../data/clients.js';
import { ADMIN_QUICK_REPLIES } from '../lib/model.js';
import { STATUS_LABEL, STATUS_TONE } from '../lib/billing.js';
import { money } from '../lib/format.js';
import { t } from '../lib/i18n.js';

export function renderChat(context) {
  const life = lifetime();
  const clientId = context.params.id;
  let client = store.clients.find((row) => row.id === clientId) || null;
  let view = null;
  /** What the top bar said the last time it was painted. */
  let painted = null;

  // The store may not have loaded yet on a deep link straight into a thread.
  // If the read lands after they have moved on, it is not theirs to paint.
  if (!client) {
    getClient(clientId).then((row) => {
      if (!row || !life.alive()) return;
      client = row;
      draw();
    });
  }

  function draw() {
    if (!view) {
      view = chatView({
        clientId,
        role: 'admin',
        sender: { uid: session.uid, name: session.displayName },
        client,
        quickReplies: ADMIN_QUICK_REPLIES,
        emptyText: t('Escribe al rancho sobre entregas, horarios o pagos. Verán el mensaje en su app.'),
      });
    }

    const billing = client ? billingFor(client) : null;
    const owes = (billing?.balance || 0) > 0;

    /*
     * The thread keeps itself up to date; all this screen adds is the bar on
     * top — who it is and what they owe. It used to be repainted on every
     * change anywhere in the panel, and repainting takes the thread out of the
     * page and puts it back: the box lost the cursor after every message sent
     * (sending one is itself a change), and the thread jumped to its first
     * message whenever somebody took a payment on another computer. So the
     * bar is painted when what it says changes, and when it is, the place in
     * the thread and the cursor are put back.
     */
    const key = [client?.name || '', owes ? billing.balance : 0, billing?.status || ''].join('|');
    if (key === painted) return;
    painted = key;
    const scroller = view.node.querySelector('.chat__scroll');
    const box = view.node.querySelector('.chat__input');
    const top = scroller ? scroller.scrollTop : 0;
    const typing = !!box && document.activeElement === box;

    const page = screen({
      title: client?.name || t('Conversación'),
      backTo: '/messages',
      flush: true,
      hideTabs: true,
      brand: h('button.topbar__brand', {
        type: 'button',
        onclick: () => client && go(`/clients/${clientId}`),
      },
        avatar(client?.name || '?', { size: 'sm', dark: true }),
        h('div.grow', { style: { minWidth: 0, textAlign: 'left' } },
          h('div.topbar__title', { style: { fontSize: 'var(--fs-md)' } }, client?.name || t('Conversación')),
          h('span.topbar__sub',
            owes ? t('Debe {amount}', { amount: money(billing.balance, { round: true }) }) : t('Al corriente')))),
      actions: [topbarButton('users', {
        label: t('Ver rancho'),
        onClick: () => go(`/clients/${clientId}`),
      })],
      body: h('div.stack', { style: { flex: '1', minHeight: '0', display: 'flex' } },
        owes && billing.status === 'overdue' ? overdueStrip(billing) : null,
        view.node),
    });

    page.classList.add('page--chat');
    if (scroller) scroller.scrollTop = top;
    if (typing) box.focus();
  }

  const unsubscribe = subscribe(() => {
    const next = store.clients.find((row) => row.id === clientId);
    if (next) client = next;
    draw();
  });

  return life.ending(unsubscribe, () => view?.destroy());
}

/** A quiet reminder bar, so staff answer the payment question accurately. */
const overdueStrip = (billing) => h('div', {
  style: {
    flex: 'none', padding: '8px 16px', background: 'var(--bad-50)',
    borderBottom: '1px solid #f8d6d6',
    display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'space-between',
  },
},
  h('span.t-sm.w-600.c-bad', t('Saldo vencido: {amount}', { amount: money(billing.balance) })),
  badge(t(STATUS_LABEL[billing.status]), STATUS_TONE[billing.status]));
