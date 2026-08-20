/**
 * A single farm: today's stop, what it owes, how it connects to the client app,
 * and its service terms — in that order, because that is the order staff ask.
 */

import { h } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { screen, topbarButton } from '../ui/shell.js';
import {
  card, button, badge, avatar, defList, defRow, itemRow, list, sectionLabel,
  alert, meter, loading,
} from '../ui/kit.js';
import { toastOk, toastBad, confirm, sheet } from '../ui/overlay.js';
import { openPaymentSheet } from '../ui/payment-sheet.js';
import { go } from '../lib/router.js';
import { session } from '../data/session.js';
import { store, subscribe, billingFor, deliveryFor } from '../data/store.js';
import { watchClient, rotateAccessCode, unlinkUser } from '../data/clients.js';
import { watchClientInvoices, issueInvoice } from '../data/invoices.js';
import { watchClientDeliveries, billableMeals, createDelivery } from '../data/deliveries.js';
import { ensureConversation } from '../data/chat.js';
import {
  periodFor, periodByIndex, projectPeriod, balanceOf, invoiceStatus,
  STATUS_LABEL, STATUS_TONE, invoiceId,
} from '../lib/billing.js';
import {
  formatRange, relativeDay, formatDayLong, today, humanDelta, formatDay,
  weekdayName, capitalize, daysBetween, dayKey,
} from '../lib/dates.js';
import { money, moneyFull, plural, phone as fmtPhone, telHref, number } from '../lib/format.js';
import { clientStatusMeta, deliveryMeta } from '../lib/model.js';
import { dbMessage, toDate } from '../firebase.js';

export function renderClientDetail(context) {
  const clientId = context.params.id;
  const welcomeCode = context.query.welcome;

  let client = store.clients.find((c) => c.id === clientId) || null;
  let invoices = [];
  let history = [];
  let loadedInvoices = false;

  const stops = [
    watchClient(clientId, (row) => { client = row; draw(); }, () => draw()),
    watchClientInvoices(clientId, (rows) => { invoices = rows; loadedInvoices = true; draw(); }, () => { loadedInvoices = true; draw(); }),
    watchClientDeliveries(clientId, 14, (rows) => { history = rows; draw(); }, () => {}),
    subscribe(() => draw()),
  ];

  function draw() {
    if (!client) {
      screen({ title: 'Rancho', backTo: '/clients', body: loading() });
      return;
    }
    screen({
      title: client.name,
      subtitle: clientStatusMeta(client.status).label,
      backTo: '/clients',
      tab: 'clients',
      actions: [
        topbarButton('chat', { label: 'Mensajes', onClick: openChat }),
        topbarButton('edit', { label: 'Editar', onClick: () => go(`/clients/${clientId}/edit`) }),
      ],
      body: body(),
    });
  }

  async function openChat() {
    await ensureConversation(client);
    go(`/chat/${clientId}`);
  }

  function body() {
    const billing = billingFor(client) || { balance: 0, status: 'paid', outstanding: [] };
    const stop = deliveryFor(clientId);

    return h('div.page__inner.stack.stack-4',
      welcomeCode ? welcomeBanner(welcomeCode) : null,
      identityCard(client, openChat),
      todayCard(client, stop),
      billingCard(client, billing, invoices, loadedInvoices),
      accessCard(client),
      termsCard(client),
      historyCard(history));
  }

  /* --- Cards ------------------------------------------------------------- */

  function welcomeBanner(code) {
    return h('div.card', { style: { background: 'var(--brand-50)', borderColor: 'var(--brand-200)' } },
      h('div.row.row--top',
        h('span', { style: { color: 'var(--brand-600)' } }, icon('key')),
        h('div.grow',
          h('div.w-600', 'Rancho registrado'),
          h('p.t-sm.c-soft', { style: { marginTop: '2px' } },
            'Comparte este código con el encargado para que active su app:'),
          h('div.row', { style: { marginTop: '10px' } },
            codeChip(code),
            button('Copiar', { variant: 'soft', size: 'sm', icon: 'copy', onClick: () => copy(code) })))));
  }

  function identityCard(model, onChat) {
    return card(h('div.stack.stack-3',
      h('div.row',
        avatar(model.name, { size: 'lg' }),
        h('div.grow',
          h('div.t-lg.w-700', model.name),
          model.contactName ? h('div.t-sm.c-soft', model.contactName) : null,
          h('div', { style: { marginTop: '6px' } },
            badge(clientStatusMeta(model.status).label, clientStatusMeta(model.status).tone,
              clientStatusMeta(model.status).icon)))),

      model.address ? h('div.row.row--top.t-sm.c-soft',
        h('span', { style: { color: 'var(--ink-400)', flex: 'none' } }, icon('pin')),
        h('span', model.address)) : null,

      h('div.btn-group',
        model.phone
          ? h('a.btn.btn--ghost.btn--sm', { href: telHref(model.phone) }, icon('phone'), 'Llamar')
          : null,
        button('Mensaje', { variant: 'ghost', size: 'sm', icon: 'chat', onClick: onChat }))));
  }

  function todayCard(model, stop) {
    const meta = stop ? deliveryMeta(stop.status) : null;

    return card(h('div.stack.stack-3',
      h('div.row.row--between',
        h('div.card__title', 'Entrega de hoy'),
        stop ? badge(meta.label, meta.tone, meta.icon) : null),

      stop
        ? h('div.stack.stack-2',
            h('div.t-sm.c-soft',
              `${plural(stop.meals, 'comida', 'comidas')}${stop.window ? ` · ${stop.window}` : ''}`),
            button('Abrir en la ruta', {
              variant: 'ghost', size: 'sm', block: true, icon: 'route',
              onClick: () => go('/route'),
            }))
        : h('div.stack.stack-2',
            h('div.t-sm.c-soft', servesToday(model)
              ? 'Este rancho recibe comida hoy pero no tiene entrega generada.'
              : 'Hoy no le toca servicio según sus días configurados.'),
            button('Agregar entrega de hoy', {
              variant: servesToday(model) ? 'primary' : 'ghost', size: 'sm', block: true, icon: 'plus',
              onClick: async () => {
                try {
                  await createDelivery(model, today(), { uid: session.uid, name: session.displayName });
                  toastOk('Entrega agregada a la ruta');
                } catch (error) { toastBad(dbMessage(error)); }
              },
            }))));
  }

  function billingCard(model, billing, rows, loaded) {
    const period = periodFor(model.cycleAnchor || today(), today());
    const projection = projectPeriod(model, period);
    const owes = billing.balance > 0;

    return h('div.stack.stack-3',
      sectionLabel('Cobro'),

      card(h('div.stack.stack-4',
        h('div.row.row--between',
          h('div',
            h('div.t-xs.upper.c-faint.w-700', owes ? 'Saldo pendiente' : 'Sin adeudo'),
            h('div.t-2xl.w-700', { style: { color: owes ? 'var(--bad-600)' : 'var(--ok-600)' } },
              money(billing.balance))),
          badge(STATUS_LABEL[billing.status] || 'Al corriente', STATUS_TONE[billing.status] || 'ok')),

        owes ? h('div.t-sm.c-soft',
          billing.daysToDue < 0
            ? `Venció ${humanDelta(billing.daysToDue)} (${formatDay(billing.dueDate)}).`
            : `Vence ${humanDelta(billing.daysToDue)} (${formatDay(billing.dueDate)}).`) : null,

        h('div.divider'),

        h('div.stack.stack-2',
          h('div.row.row--between.t-sm',
            h('span.c-soft', `Periodo en curso · ${formatRange(period.start, period.end)}`),
            h('span.w-600', money(projection.amount))),
          meter(periodProgress(period), { tone: 'ok' }),
          h('div.t-xs.c-faint',
            `${projection.days} días de servicio · ${projection.meals} comidas estimadas`)),

        h('div.btn-group',
          owes && billing.focus
            ? button('Registrar pago', {
                variant: 'primary', size: 'sm', icon: 'wallet',
                onClick: async () => {
                  if (await openPaymentSheet(billing.focus, { uid: session.uid, name: session.displayName })) draw();
                },
              })
            : null,
          button('Cerrar y facturar', {
            variant: 'ghost', size: 'sm', icon: 'receipt', onClick: () => issueCycle(model),
          })))),

      loaded
        ? (rows.length
            ? list(rows.slice(0, 6).map((invoice) => invoiceRow(invoice)), { card: true })
            : card(h('p.t-sm.c-soft.center', 'Todavía no hay facturas para este rancho.')))
        : loading());
  }

  function invoiceRow(invoice) {
    const status = invoiceStatus(invoice, today());
    const balance = balanceOf(invoice);
    return itemRow({
      title: formatRange(invoice.periodStart, invoice.periodEnd),
      meta: `${number(invoice.meals)} comidas · ${moneyFull(invoice.amount)}`,
      end: [
        badge(STATUS_LABEL[status], STATUS_TONE[status]),
        balance > 0 ? h('span.t-xs.c-soft', `Saldo ${money(balance)}`) : null,
      ].filter(Boolean),
      onClick: () => go(`/invoices/${invoice.id}`),
    });
  }

  function accessCard(model) {
    const linked = (model.linkedUids || []).length;
    return h('div.stack.stack-3',
      sectionLabel('Acceso a la app del cliente'),
      card(h('div.stack.stack-3',
        h('div.row.row--between',
          h('div',
            h('div.t-xs.upper.c-faint.w-700', 'Código de acceso'),
            h('div', { style: { marginTop: '6px' } }, codeChip(model.accessCode || '—'))),
          button('Copiar', { variant: 'ghost', size: 'sm', icon: 'copy', onClick: () => copy(model.accessCode) })),

        codeValidity(model),

        linked
          ? alert(`${linked} ${linked === 1 ? 'cuenta vinculada' : 'cuentas vinculadas'} a este rancho.`, 'ok')
          : alert('Nadie ha activado la app todavía. Comparte el código con el encargado.', 'info'),

        h('div.btn-group',
          button('Generar código nuevo', {
            variant: 'ghost', size: 'sm', icon: 'refresh',
            onClick: () => rotate(model),
          }),
          linked
            ? button('Quitar acceso', {
                variant: 'danger-soft', size: 'sm', icon: 'ban',
                onClick: () => revoke(model),
              })
            : null))));
  }

  function termsCard(model) {
    return h('div.stack.stack-3',
      sectionLabel('Condiciones del servicio'),
      card(defList([
        defRow('Comidas por día', number(model.mealsPerDay)),
        defRow('Precio por comida', moneyFull(model.pricePerMeal)),
        defRow('Días de servicio', serviceDays(model.deliveryDays)),
        defRow('Horario', model.deliveryWindow || '—'),
        defRow('Inicio del ciclo', formatDayLong(model.cycleAnchor || today())),
        defRow('Días de gracia', model.graceDays === 0 ? 'Mismo día' : `${model.graceDays} días`),
        model.phone ? defRow('Teléfono', fmtPhone(model.phone)) : null,
        model.email ? defRow('Correo', model.email) : null,
        model.notes ? defRow('Notas', model.notes) : null,
      ].filter(Boolean))));
  }

  function historyCard(rows) {
    if (!rows.length) return null;
    return h('div.stack.stack-3',
      sectionLabel('Últimas entregas'),
      list(rows.map((row) => {
        const meta = deliveryMeta(row.status);
        return itemRow({
          title: relativeDay(row.date),
          meta: `${plural(row.meals, 'comida', 'comidas')} · ${capitalize(weekdayName(row.date))}`,
          end: badge(meta.short, meta.tone),
          chevron: false,
        });
      }), { card: true }));
  }

  /* --- Actions ----------------------------------------------------------- */

  async function issueCycle(model) {
    const anchor = model.cycleAnchor || today();
    const current = periodFor(anchor, today());
    const choice = await sheet({
      title: 'Cerrar y facturar',
      build: (close) => h('div.stack.stack-3',
        h('p.t-sm.c-soft', 'Se contarán las comidas realmente entregadas en el periodo y se generará su factura.'),
        h('div.stack.stack-2',
          periodOption(periodByIndex(anchor, current.index - 1), 'Periodo anterior (cerrado)', close),
          periodOption(current, 'Periodo en curso', close))),
    });
    if (!choice) return;

    try {
      const meals = await billableMeals(model.id, choice);
      if (!meals) { toastBad('No hay entregas registradas en ese periodo.'); return; }
      await issueInvoice(model, choice, meals, { uid: session.uid, name: session.displayName });
      toastOk('Factura generada');
      go(`/invoices/${invoiceId(model.id, choice.start)}`);
    } catch (error) {
      toastBad(dbMessage(error));
    }
  }

  const periodOption = (period, label, close) =>
    h('button.item.item--tap-target', {
      type: 'button', style: { border: '1px solid var(--border)', borderRadius: 'var(--r-md)' },
      onclick: () => close(period),
    },
    h('div.item__main',
      h('div.item__title', formatRange(period.start, period.end)),
      h('div.item__meta', label)),
    icon('chevronR', 'rowlink__chev'));

  async function rotate(model) {
    if (!await confirm({
      title: 'Generar código nuevo',
      message: 'El código anterior dejará de funcionar. Las cuentas ya vinculadas siguen teniendo acceso.',
      confirmLabel: 'Generar código', icon: 'refresh',
    })) return;
    try {
      const code = await rotateAccessCode(model.id, model.accessCode);
      toastOk(`Código nuevo: ${code}`);
    } catch (error) { toastBad(dbMessage(error)); }
  }

  async function revoke(model) {
    if (!await confirm({
      title: 'Quitar acceso',
      message: 'Las cuentas vinculadas dejarán de ver la información de este rancho. Podrán volver a entrar con un código nuevo.',
      confirmLabel: 'Quitar acceso', tone: 'danger', icon: 'ban',
    })) return;
    try {
      for (const uid of model.linkedUids || []) await unlinkUser(model.id, uid);
      toastOk('Acceso retirado');
    } catch (error) { toastBad(dbMessage(error)); }
  }

  draw();
  return () => stops.forEach((stop) => stop?.());
}

/**
 * How long the access code stays usable.
 *
 * An expired code fails at redemption with a permission error the farm manager
 * cannot diagnose, so the state has to be visible on this screen — it is the
 * only place anyone can fix it.
 */
function codeValidity(model) {
  const expires = toDate(model.accessCodeExpiresAt);
  if (!expires) return null;

  const left = daysBetween(today(), dayKey(expires));
  if (left < 0) {
    return alert(`El código venció el ${formatDay(dayKey(expires))}. Genera uno nuevo para que puedan conectarse.`, 'bad');
  }
  return alert(
    left === 0
      ? 'El código vence hoy.'
      : `El código se puede usar ${humanDelta(left)} (hasta el ${formatDay(dayKey(expires))}).`,
    left <= 3 ? 'warn' : 'info');
}

/* --- Small pieces ----------------------------------------------------------- */

const codeChip = (code) => h('div', {
  style: {
    display: 'inline-block', padding: '8px 14px', borderRadius: 'var(--r-md)',
    background: 'var(--ink-800)', color: '#fff',
    fontFamily: 'var(--font-num)', fontSize: '20px', fontWeight: '700', letterSpacing: '.18em',
  },
}, code);

async function copy(text) {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    toastOk('Código copiado');
  } catch {
    toastBad('No se pudo copiar. Anótalo manualmente.');
  }
}

const servesToday = (client) =>
  client.status === 'active' && (client.deliveryDays || []).includes(new Date().getDay());

function serviceDays(days) {
  if (!days?.length) return '—';
  const names = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  const order = [1, 2, 3, 4, 5, 6, 0];
  return order.filter((day) => days.includes(day)).map((day) => names[day]).join(', ');
}

/** How far through the current cycle we are, 0–100. */
function periodProgress(period) {
  const total = 14;
  const elapsed = Math.max(0, Math.min(total,
    (new Date(`${today()}T12:00:00`) - new Date(`${period.start}T12:00:00`)) / 86400000 + 1));
  return Math.round((elapsed / total) * 100);
}
