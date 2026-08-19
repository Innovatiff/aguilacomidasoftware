/**
 * A thread with one farm. The header carries the two things staff need while
 * replying: who this is, and whether they owe money — so a payment question can
 * be answered without leaving the conversation.
 */

import { h } from '../lib/dom.js';
import { screen, topbarButton } from '../ui/shell.js';
import { avatar, badge } from '../ui/kit.js';
import { chatView } from '../ui/chat-view.js';
import { go } from '../lib/router.js';
import { session } from '../data/session.js';
import { store, subscribe, billingFor } from '../data/store.js';
import { getClient } from '../data/clients.js';
import { ADMIN_QUICK_REPLIES } from '../lib/model.js';
import { STATUS_LABEL, STATUS_TONE } from '../lib/billing.js';
import { money } from '../lib/format.js';

export function renderChat(context) {
  const clientId = context.params.id;
  let client = store.clients.find((row) => row.id === clientId) || null;
  let view = null;

  // The store may not have loaded yet on a deep link straight into a thread.
  if (!client) getClient(clientId).then((row) => { if (row) { client = row; draw(); } });

  function draw() {
    if (!view) {
      view = chatView({
        clientId,
        role: 'admin',
        sender: { uid: session.uid, name: session.displayName },
        client,
        quickReplies: ADMIN_QUICK_REPLIES,
        emptyText: 'Escribe al rancho sobre entregas, horarios o pagos. Verán el mensaje en su app.',
      });
    }

    const billing = client ? billingFor(client) : null;
    const owes = (billing?.balance || 0) > 0;

    const page = screen({
      title: client?.name || 'Conversación',
      backTo: '/messages',
      flush: true,
      hideTabs: true,
      brand: h('button.topbar__brand', {
        type: 'button',
        onclick: () => client && go(`/clients/${clientId}`),
      },
        avatar(client?.name || '?', { size: 'sm', dark: true }),
        h('div.grow', { style: { minWidth: 0, textAlign: 'left' } },
          h('div.topbar__title', { style: { fontSize: 'var(--fs-md)' } }, client?.name || 'Conversación'),
          h('span.topbar__sub',
            owes ? `Debe ${money(billing.balance, { round: true })}` : 'Al corriente'))),
      actions: [topbarButton('users', {
        label: 'Ver rancho',
        onClick: () => go(`/clients/${clientId}`),
      })],
      body: h('div.stack', { style: { flex: '1', minHeight: '0', display: 'flex' } },
        owes && billing.status === 'overdue' ? overdueStrip(billing) : null,
        view.node),
    });

    page.classList.add('page--chat');
  }

  const unsubscribe = subscribe(() => {
    const next = store.clients.find((row) => row.id === clientId);
    if (next) client = next;
    draw();
  });

  return () => { unsubscribe(); view?.destroy(); };
}

/** A quiet reminder bar, so staff answer the payment question accurately. */
const overdueStrip = (billing) => h('div', {
  style: {
    flex: 'none', padding: '8px 16px', background: 'var(--bad-50)',
    borderBottom: '1px solid #f8d6d6',
    display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'space-between',
  },
},
  h('span.t-sm.w-600.c-bad', `Saldo vencido: ${money(billing.balance)}`),
  badge(STATUS_LABEL[billing.status], STATUS_TONE[billing.status]));
