/**
 * A single client: where they are, today's stop, what they owe, how they get
 * into the app, and the terms their farm sets — in that order, because that is
 * the order staff ask.
 */

import { h, mount } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { screen, topbarButton } from '../ui/shell.js';
import {
  card, button, badge, avatar, defList, defRow, itemRow, list, sectionLabel,
  alert, meter, loading, field, fieldGroup, input, select, tagList, chargeRows,
} from '../ui/kit.js';
import { toastOk, toastBad, sheet, confirm } from '../ui/overlay.js';
import { openChargeSheet } from '../ui/charge-sheet.js';
import { openDebtSheet } from '../ui/debt-sheet.js';
import { openBalanceSheet } from '../ui/balance-sheet.js';
import { openHistorySheet } from '../ui/history-sheet.js';
import { openAdvanceSheet } from '../ui/advance-sheet.js';
import { go } from '../lib/router.js';
import { session } from '../data/session.js';
import {
  store, subscribe, billingFor, farmById, periodPrice, clientState, forgetPendingBills,
} from '../data/store.js';
import {
  watchClient, updateClient, moveClient, servingSince, setEndsOn, daysLeft,
  cycleIsSet, setDayNote, startsLater,
} from '../data/clients.js';
import { openScheduleFlow } from '../ui/schedule-flow.js';
import { plannedFor, setTitle, setWhen } from './schedule.js';
import { watchClientInvoices, issueInvoice } from '../data/invoices.js';
import { watchClientReceipts, totalOf, cancelledIds } from '../data/receipts.js';
import { openOpeningSheet } from '../ui/opening-sheet.js';
import { ensureConversation } from '../data/chat.js';
import {
  periodOf, periodOfIndex, projectPeriod, balanceOf, invoiceStatus,
  STATUS_LABEL, STATUS_TONE, invoiceId, isCharge, invoiceTitle, appliedTitle,
  payDayAfter, periodWord, cadenceWord, paidThroughOn, paidFor, isPayable, isCovered,
} from '../lib/billing.js';
import { tierFor, periodCharge, mealsOn } from '../lib/pricing.js';
import {
  formatRange, formatDayLong, today, addDays, humanDelta, formatDay,
  weekdayName, capitalize, WEEKDAYS_SHORT,
} from '../lib/dates.js';
import { money, moneyFull, plural, phone as fmtPhone, telHref, number } from '../lib/format.js';
import { clientStatusMeta, paymentMethodMeta } from '../lib/model.js';
import { errorText } from '../firebase.js';

export function renderClientDetail(context) {
  const clientId = context.params.id;
  const welcomeEmail = context.query.welcome;

  let client = store.clients.find((c) => c.id === clientId) || null;
  let invoices = [];
  let receipts = [];
  let loadedInvoices = false;

  const stops = [
    watchClient(clientId, (row) => { client = row; draw(); }, () => draw()),
    watchClientInvoices(clientId, (rows) => { invoices = rows; loadedInvoices = true; draw(); }, () => { loadedInvoices = true; draw(); }),
    watchClientReceipts(clientId, (rows) => { receipts = rows; draw(); }, () => {}),
    subscribe(() => draw()),
  ];

  function draw() {
    if (!client) {
      screen({ title: 'Cliente', backTo: '/clients', tab: 'clients', body: loading() });
      return;
    }
    screen({
      title: client.name,
      subtitle: [client.farmName, client.locationName].filter(Boolean).join(' · ')
        || clientStatusMeta(client.status).label,
      backTo: client.farmId ? `/farms/${client.farmId}` : '/clients',
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

    return h('div.page__inner.page__inner--flow.stack.stack-4',
      welcomeEmail ? h('div.span-all', welcomeBanner(welcomeEmail)) : null,
      identityCard(client, openChat),
      plannedCard(client),
      placeCard(client),
      billingCard(client, billing, invoices, loadedInvoices),
      paymentsCard(),
      accessCard(client),
      termsCard(client));
  }

  /* --- Cards ------------------------------------------------------------- */

  function welcomeBanner(email) {
    return h('div.card', { style: { background: 'var(--brand-50)', borderColor: 'var(--brand-200)' } },
      h('div.row.row--top',
        h('span', { style: { color: 'var(--brand-600)' } }, icon('check')),
        h('div.grow',
          h('div.w-600', 'Cliente registrado'),
          h('p.t-sm.c-soft', { style: { marginTop: '2px' } },
            'Ya puede entrar a la app con este correo:'),
          h('div.row', { style: { marginTop: '10px' } },
            emailChip(email),
            button('Copiar', { variant: 'soft', size: 'sm', icon: 'copy', onClick: () => copy(email) })))));
  }

  function identityCard(model, onChat) {
    return card(h('div.stack.stack-3',
      h('div.row',
        avatar(model.name, { size: 'lg' }),
        h('div.grow',
          h('div.t-lg.w-700', model.name),
          model.phone ? h('div.t-sm.c-soft', fmtPhone(model.phone)) : null,
          h('div', { style: { marginTop: '6px' } },
            startsLater(model)
              ? badge(`Empieza el ${formatDay(model.startsOn)}`, 'info', 'clock')
              : badge(clientStatusMeta(model.status).label, clientStatusMeta(model.status).tone,
                clientStatusMeta(model.status).icon)))),

      // Registered ahead: on pause, and active by itself on that morning.
      startsLater(model)
        ? alert(`Empieza el ${formatDayLong(model.startsOn)}: ese día se activa solo (Programador). `
          + 'Hasta entonces no se empaca ni se le cobra, pero la cocina ya puede acomodar su ubicación.',
        'info', 'clock')
        : null,

      model.endsOn
        ? alert(model.endsOn < today()
          ? `Su último día fue el ${formatDayLong(model.endsOn)}. `
            + `${model.status === 'paused' ? `Desde el ${formatDayLong(addDays(model.endsOn, 1))} está en pausa: `
              : ''}ya no aparece en la libreta ni se le factura. Para que vuelva, reactívalo.`
          : `Último día: ${formatDayLong(model.endsOn)} `
            + `(${plural(Math.max(0, daysLeft(model)), 'día', 'días')}). Ese día se le empaca; `
            + 'al día siguiente queda en pausa solo y sale de la libreta.',
        model.endsOn < today() ? 'bad' : 'warn')
        : null,

      (model.tags || []).length
        ? h('div.stack.stack-2',
            h('div.t-xs.upper.c-faint.w-700', 'No puede comer'),
            tagList(model.tags, { className: 'tags--loud' }))
        : null,

      (model.preferencias || []).length
        ? h('div.stack.stack-2',
            h('div.t-xs.upper.c-faint.w-700', 'Preferencias'),
            tagList(model.preferencias))
        : null,

      model.notes ? h('div.t-sm.c-soft', model.notes) : null,

      // Today's note, which is the only thing on this card that expires.
      dayNoteOf(model)
        ? alert(`Hoy: ${dayNoteOf(model)}`, 'info', 'note')
        : null,

      h('div.btn-group',
        model.phone
          ? h('a.btn.btn--ghost.btn--sm', { href: telHref(model.phone) }, icon('phone'), 'Llamar')
          : null,
        button('Mensaje', { variant: 'ghost', size: 'sm', icon: 'chat', onClick: onChat }),
        button(dayNoteOf(model) ? 'Cambiar nota de hoy' : 'Nota de hoy', {
          variant: 'ghost', size: 'sm', icon: 'note', onClick: () => editDayNote(model),
        }),
        button(model.endsOn ? 'Cambiar último día' : 'Poner último día', {
          variant: 'ghost', size: 'sm', icon: 'calendar', onClick: () => setLastDay(model),
        }))));
  }

  /**
   * What the Programador has planned for this person, still to happen — and
   * the way to plan something. Shown even when nothing is planned, because
   * "two comidas from Monday" is asked about a person, in front of their file.
   */
  function plannedCard(model) {
    const planned = plannedFor(model.id);
    return card(h('div.stack.stack-3',
      h('div.row.row--between',
        h('div.card__title', 'Programado'),
        button('Programar un cambio', {
          variant: 'soft', size: 'sm', icon: 'clock',
          onClick: () => openScheduleFlow({ client: model, author: { uid: session.uid, name: session.displayName } }),
        })),
      planned.length
        ? list(planned.map((set) => itemRow({
          title: capitalize(setTitle(set).replace(`${model.name} — `, '')),
          meta: setWhen(set),
          chevron: true,
          onClick: () => go('/programador'),
        })), { card: false })
        : h('p.t-sm.c-soft', 'Nada programado. Para un cambio que empieza otro día —dos comidas '
          + 'desde el lunes, otra casa desde el 28— tócale a «Programar un cambio».')));
  }

  /**
   * Where this person is. Shown high up because it is what the kitchen asks
   * first — the food has to be left somewhere — and because a client whose
   * location was deleted has to be visibly broken rather than quietly missing
   * from the route.
   */
  function placeCard(model) {
    const farm = farmById(model.farmId);
    const stillThere = (farm?.locations || []).some((place) => place.id === model.locationId);

    return card(h('div.stack.stack-3',
      h('div.row.row--between',
        h('div.card__title', 'Ubicación'),
        stillThere ? null : badge('Revisar', 'bad')),

      h('div.row',
        h('span.item__ico', icon('farm')),
        h('div.grow', { style: { minWidth: 0 } },
          h('div.w-650.truncate', model.farmName || 'Sin rancho'),
          h('div.t-sm.c-soft.truncate', model.locationName || 'Sin ubicación')),
        model.farmId
          ? button('Ver rancho', {
              variant: 'ghost', size: 'sm', onClick: () => go(`/farms/${model.farmId}`),
            })
          : null),

      stillThere
        ? null
        : alert('Esa ubicación ya no existe en el rancho. Elige otra para que siga apareciendo '
          + 'en la ruta.', 'warn'),

      button('Cambiar de ubicación', {
        variant: 'ghost', size: 'sm', block: true, icon: 'pin', onClick: () => changePlace(model),
      })));
  }

  function billingCard(model, billing, rows, loaded) {
    const period = periodOf(model);
    const projection = projectPeriod(model, period, store.pricing);
    const priced = !!tierFor(store.pricing, model.mealsPerDay);
    const owes = billing.balance > 0;
    const { advance } = clientState(model);
    // The last day of the last fortnight paid for — always one already
    // served. A date typed in from the notebook can fall mid-fortnight; what
    // it paid for ended the day before that fortnight began.
    const paidUpTo = model.paidThrough ? paidThroughOn(model, model.paidThrough) : null;

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

        advance
          ? h('div.stack.stack-2',
              alert(`Tiene un pago puesto en una ${periodWord(model)} antes de que se sirviera. `
                + `Aquí no se paga por adelantado: ese pago es por la ${periodWord(model)} `
                + 'anterior.', 'warn'),
              button('Revisar y corregir', {
                variant: 'soft', size: 'sm', icon: 'check', onClick: () => fixAhead(model),
              }))
          : !owes && paidUpTo && paidUpTo < period.start
            ? h('div.t-sm.c-soft', `Pagado hasta el ${formatDay(paidUpTo)}.`)
            : null,

        h('div.divider'),

        h('div.stack.stack-2',
          h('div.row.row--between.t-sm',
            h('span.c-soft',
              `${capitalize(periodWord(model))} en curso · ${formatRange(period.start, period.end)}`),
            h('span.w-600', priced ? money(projection.amount) : 'Sin precio')),
          meter(periodProgress(period), { tone: 'ok' }),
          h('div.t-xs.c-faint',
            [`${plural(model.mealsPerDay, 'comida', 'comidas')}/día`,
              `${projection.days} días`,
              projection.extraMeals ? `+${projection.extraMeals} extra` : null,
            ].filter(Boolean).join(' · ')),
          // The number the counter actually quotes: not the invoice's due date
          // with its grace days, but the day this person turns up again — the
          // day after this fortnight ends, to pay for it.
          h('div.t-sm.w-600', { style: { marginTop: '2px' } },
            `Se paga el ${weekdayName(payDayAfter(period))} `
            + `${formatDay(payDayAfter(period))}, cuando termine`),

          // Whether that date is a day somebody confirmed or a placeholder
          // inherited from the rancho. While the notebook is being migrated
          // across, most of them are placeholders, and quoting one as if it
          // were settled is how the wrong day gets told to a client.
          h('div.t-xs.c-faint',
            cycleIsSet(model)
              ? `${capitalize(periodWord(model))} fijada con el pago del `
                + `${formatDay(model.cycleSetOn)}.`
              : `Su ${periodWord(model)} todavía es la del rancho. Si no es la suya, `
                + 'cámbiala en Editar.')),

        priced
          ? null
          : alert('Su plan no tiene precio. Ponlo en Ajustes → Precios para poder cobrarle.', 'warn'),

        h('div.btn-group',
          button('Cobrar', {
            variant: 'primary', size: 'sm', icon: 'cash', onClick: () => charge(model),
          }),
          button('Agregar deuda', {
            variant: 'ghost', size: 'sm', icon: 'plus', onClick: () => addDebt(model),
          }),
          // Only where there is something to correct: on an account at zero
          // the way to move the number up is to add a debt, which is the
          // button right next to it.
          billing.balance > 0.005
            ? button('Corregir saldo', {
                variant: 'ghost', size: 'sm', icon: 'edit', onClick: () => fixBalance(model),
              })
            : null,
          button('Cerrar y facturar', {
            variant: 'ghost', size: 'sm', icon: 'receipt', onClick: () => issueCycle(model),
          })))),

      loaded
        ? (rows.length
            ? list(rows.slice(0, 6).map((invoice) => invoiceRow(invoice)), { card: true })
            : card(h('p.t-sm.c-soft.center', 'Todavía no hay facturas para este cliente.')))
        : loading());
  }

  /**
   * Everything this person has ever paid.
   *
   * Separate from the invoice list on purpose: a bill says what was owed, a
   * receipt says what was handed over and when. "When did he last pay?" is
   * asked far more often than "what was the July bill?", and until now it was
   * only answerable by opening bills one by one.
   */
  function paymentsCard() {
    const paid = totalOf(receipts);
    const voided = cancelledIds(receipts);
    // "Last paid" must skip a payment that was taken back.
    // By the day it was paid: a notebook payment typed in today is still older
    // than last week's.
    const stamp = (row) => (row.at?.toMillis ? row.at.toMillis() : 0);
    const last = receipts.filter((row) => Number(row.amount) > 0 && !voided.has(row.id))
      .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || stamp(b) - stamp(a))[0];

    return h('div.stack.stack-3',
      sectionLabel('Historial de pagos', receipts.length
        ? h('span.t-sm.c-soft', `${money(paid, { round: true })} en total`)
        : null),

      receipts.length
        ? h('div.stack.stack-2',
            last
              ? h('p.t-xs.c-faint', `Última vez que pagó: ${formatDayLong(last.date)}.`)
              : null,
            list(receipts.slice(0, 12).map((row) => receiptRow(row, voided.has(row.id))), { card: true }),
            button('Registrar un pago anterior', {
              variant: 'ghost', block: true, size: 'sm', icon: 'clipboard',
              onClick: () => addHistory(client),
            }))
        : card(h('div.stack.stack-3',
            h('p.t-sm.c-soft.center', 'Todavía no se le ha registrado ningún pago.'),
            // The whole first notebook is in this state: registered before
            // payments could be recorded at all. Typing the last one in is
            // what puts their fortnight where it belongs.
            button('Registrar un pago anterior', {
              variant: 'primary', block: true, icon: 'clipboard',
              onClick: () => addHistory(client),
            }),
            !invoices.length
              ? button('Traer saldo del cuaderno', {
                  variant: 'ghost', block: true, icon: 'receipt',
                  onClick: () => bringOverBalance(client),
                })
              : null)));
  }

  function receiptRow(receipt, wasCancelled = false) {
    const reversal = Number(receipt.amount) < 0;
    const dead = reversal || wasCancelled;
    const covers = paidFor(receipt, invoices).map(appliedTitle).join(', ');

    return itemRow({
      lead: h('div.avatar.avatar--sm', {
        style: dead
          ? { background: 'var(--bad-50)', color: 'var(--bad-600)' }
          : { background: 'var(--ok-50)', color: 'var(--ok-600)' },
      }, icon(dead ? 'refresh' : paymentMethodMeta(receipt.method).icon)),
      title: h(`span${wasCancelled ? '.is-void' : ''}`, money(receipt.amount)),
      meta: [formatDay(receipt.date), paymentMethodMeta(receipt.method).label, covers]
        .filter(Boolean).join(' · '),
      end: reversal
        ? badge('Cancelación', 'bad')
        : wasCancelled
          ? badge('Cancelado', 'bad')
          : h('span.t-xs.c-faint', receipt.folio || ''),
      onClick: () => go(`/receipts/${receipt.id}`),
    });
  }

  /** What they paid before the software existed — history, not collection. */
  async function addHistory(model) {
    await openHistorySheet({
      client: model,
      author: { uid: session.uid, name: session.displayName },
    });
  }

  /**
   * "Pagó y se va el jueves."
   *
   * A date the kitchen already knows, written down once so nobody has to
   * remember to switch this person off on a morning they are not thinking
   * about it. From the day after, they leave the libreta and stop being
   * billed by themselves.
   */
  /**
   * The note this morning, if it was written for this morning.
   *
   * A declaration, not a `const`: the listeners below paint the moment they
   * are set up, which is before a `const` further down this function exists.
   */
  function dayNoteOf(model) {
    return model?.notaDelDiaOn === today() ? String(model.notaDelDia || '').trim() : '';
  }

  /**
   * A note for today only — it goes on the sticker instead of the standing one
   * and is gone tomorrow without anybody clearing it.
   */
  async function editDayNote(model) {
    const box = input({
      value: dayNoteOf(model),
      placeholder: 'Hoy no viene, dejar con su hermano…',
      maxlength: 90,
    });

    await sheet({
      title: 'Nota de hoy',
      build: (close) => h('form.stack.stack-3', {
        onsubmit: async (event) => {
          event.preventDefault();
          try {
            await setDayNote(model.id, box.value, today());
            toastOk(box.value.trim() ? 'Nota de hoy guardada' : 'Nota de hoy quitada');
            close(true);
          } catch (error) { toastBad(errorText(error)); }
        },
      },
      h('p.t-sm.c-soft',
        `Sale en la etiqueta de ${model.name} en lugar de su nota de siempre, y solo hoy. `
        + 'Mañana desaparece sola.'),
      model.notes ? h('p.t-sm.c-faint', `Su nota de siempre: ${model.notes}`) : null,
      fieldGroup({ label: 'Lo de hoy', control: box }),
      h('button.btn.btn--primary.btn--block.btn--lg', { type: 'submit' }, 'Guardar'),
      dayNoteOf(model)
        ? button('Quitar la de hoy', {
          variant: 'ghost', block: true,
          onClick: async () => { box.value = ''; },
        })
        : null),
    });
  }

  async function setLastDay(model) {
    const choices = [
      ['Hoy es su último día', 0],
      ['Mañana', 1],
      ['En 2 días', 2],
      ['En 3 días', 3],
      ['En una semana', 7],
    ];

    await sheet({
      title: 'Hasta cuándo se le sirve',
      build: (close) => h('div.stack.stack-3',
        h('p.t-sm.c-soft',
          `Después de ese día ${model.name} deja de aparecer en la libreta y no se le `
          + `factura ninguna ${periodWord(model)} más. Su saldo pendiente no se toca.`),

        model.endsOn
          ? alert(`Ahora mismo termina el ${formatDayLong(model.endsOn)}.`,
              model.endsOn < today() ? 'bad' : 'warn')
          : null,

        ...choices.map(([label, days]) => button(label, {
          variant: days === 0 ? 'danger-soft' : 'ghost', block: true,
          onClick: async () => { close(); await saveLastDay(model, addDays(today(), days)); },
        })),

        fieldGroup({
          label: 'Otra fecha',
          control: input({
            type: 'date', value: model.endsOn || '', min: today(),
            onchange: async (event) => {
              if (!event.target.value) return;
              close();
              await saveLastDay(model, event.target.value);
            },
          }),
        }),

        model.endsOn
          ? button('Quitar la fecha — sigue indefinidamente', {
              variant: 'ghost', block: true, icon: 'refresh',
              onClick: async () => { close(); await saveLastDay(model, ''); },
            })
          : null),
    });
  }

  async function saveLastDay(model, endsOn) {
    try {
      await setEndsOn(model.id, endsOn);
      toastOk(endsOn ? `Termina el ${formatDay(endsOn)}` : 'Sin fecha de término');
    } catch (error) { toastBad(errorText(error)); }
  }

  /** A debt the billing cycle did not produce: it goes on as its own bill. */
  async function addDebt(model) {
    await openDebtSheet({
      client: model,
      invoices,
      author: { uid: session.uid, name: session.displayName },
    });
  }

  /** Puts the balance on the number it should have been all along. */
  async function fixBalance(model) {
    await openBalanceSheet({
      client: model,
      invoices,
      author: { uid: session.uid, name: session.displayName },
    });
  }

  /** Turns a date from the notebook into the fortnights it left open. */
  async function bringOverBalance(model) {
    await openOpeningSheet({
      client: model,
      pricing: store.pricing,
      author: { uid: session.uid, name: session.displayName },
    });
  }

  function invoiceRow(invoice) {
    const status = invoiceStatus(invoice, today());
    const balance = balanceOf(invoice);
    return itemRow({
      title: invoiceTitle(invoice),
      meta: isCharge(invoice)
        ? `${moneyFull(invoice.amount)} · deuda del ${formatDay(invoice.periodStart)}`
        : invoice.fromNotebook
          ? `${moneyFull(invoice.amount)} · del cuaderno`
          : `${moneyFull(invoice.amount)} · ${number(invoice.meals)} comidas entregadas`,
      end: [
        badge(STATUS_LABEL[status], STATUS_TONE[status]),
        balance > 0 ? h('span.t-xs.c-soft', `Saldo ${money(balance)}`) : null,
      ].filter(Boolean),
      onClick: () => go(`/invoices/${invoice.id}`),
    });
  }

  /**
   * The farm's access is its email address — there is nothing else to hand over
   * and nothing for the manager to keep track of. Changing the address here
   * moves the access with it, which is also how it is taken away.
   */
  function accessCard(model) {
    return h('div.stack.stack-3',
      sectionLabel('Acceso a su app'),
      card(h('div.stack.stack-3',
        h('div.row.row--between',
          h('div', { style: { minWidth: 0 } },
            h('div.t-xs.upper.c-faint.w-700', 'Correo de acceso'),
            h('div', { style: { marginTop: '6px' } }, emailChip(model.email || '—'))),
          model.email
            ? button('Copiar', { variant: 'ghost', size: 'sm', icon: 'copy', onClick: () => copy(model.email) })
            : null),

        model.email
          ? alert('Entra a la app con este correo y la contraseña que él mismo elija. '
            + 'No hay códigos que compartir.', 'info')
          : alert('Sin correo registrado no puede abrir la app. Puedes agregarlo cuando lo tenga; '
            + 'sus entregas y su cuenta se siguen registrando igual.', 'info'),

        button(model.email ? 'Cambiar correo de acceso' : 'Agregar correo', {
          variant: 'ghost', size: 'sm', block: true, icon: 'mail',
          onClick: () => changeEmail(model),
        }))));
  }

  function termsCard(model) {
    const price = periodPrice(model);

    return h('div.stack.stack-3',
      sectionLabel('Condiciones del servicio', model.farmId
        ? h('button.btn.btn--quiet.btn--sm', {
            type: 'button', onclick: () => go(`/farms/${model.farmId}/edit`),
          }, icon('edit'), 'Editar en el rancho')
        : null),
      card(h('div.stack.stack-3',
        h('div.stack.stack-2',
          h('div.t-xs.upper.c-faint.w-700', 'Su semana'),
          weekStrip(model)),

        defList([
          ...chargeRows(periodCharge(model, store.pricing), !!price),
          defRow('Paga', capitalize(cadenceWord(model))),
          defRow(`Precio por ${periodWord(model)}`,
            price ? moneyFull(price) : 'Sin precio', { total: true }),
          defRow('Horario', model.deliveryWindow || '—'),
          // Two dates that are easy to confuse and mean different things: the
          // anchor is the rancho's calendar, this one is the day this person
          // started owing for it.
          defRow('Come aquí desde', servingSince(model)
            ? formatDayLong(servingSince(model))
            : 'Sin fecha'),
          defRow('Inicio del ciclo', formatDayLong(model.cycleAnchor || today())),
          defRow('Días de gracia', model.graceDays === 0 ? 'Mismo día' : `${model.graceDays} días`),
        ]),
        h('p.t-xs.c-faint',
          'El precio del plan se cambia en Ajustes → Precios; los días, las comidas extra y '
          + 'cada cuánto paga, '
          + 'aquí en su ficha. '
          + (model.farmName ? `El horario y el ciclo vienen de ${model.farmName}.` : '')))));
  }

  /**
   * The week at a glance: seven boxes, the number of plates in each.
   *
   * Faster to read than a sentence, and it makes an odd week — five days, or
   * three plates on Saturday — visible without counting words.
   */
  function weekStrip(model) {
    const order = [1, 2, 3, 4, 5, 6, 0];
    return h('div.weekstrip', order.map((weekday) => {
      const meals = mealsOn(model, weekday);
      const extra = Number(model.extras?.[String(weekday)]) || 0;
      return h(`div.weekstrip__day${meals ? '' : '.is-off'}${extra ? '.has-extra' : ''}`,
        h('div.weekstrip__n', meals || '—'),
        h('div.weekstrip__w', WEEKDAYS_SHORT[weekday]));
    }));
  }

  /* --- Actions ----------------------------------------------------------- */

  /** Money in, from the person's own file — the same sheet the counter uses. */
  async function charge(model) {
    const receipt = await openChargeSheet({
      client: model,
      pricing: store.pricing,
      author: { uid: session.uid, name: session.displayName },
    });
    if (receipt) go(`/receipts/${receipt.id}`);
  }

  /** Moves a payment made before its fortnight was served to the one it paid. */
  async function fixAhead(model) {
    const done = await openAdvanceSheet({
      client: model,
      author: { uid: session.uid, name: session.displayName },
    });
    if (done) forgetPendingBills();
  }

  async function issueCycle(model) {
    const current = periodOf(model);
    // The fortnight still being served is billed when it ends — unless their
    // service ends inside it, in which case it ended with them.
    const runningOk = isPayable(current, model);
    const choice = await sheet({
      title: 'Cerrar y facturar',
      build: (close) => h('div.stack.stack-3',
        h('p.t-sm.c-soft', `Se emite la factura de la ${periodWord(model)} al precio de su `
          + 'plan. Solo de lo ya servido: la que está en curso se factura cuando termine.'),
        h('div.stack.stack-2',
          periodOption(periodOfIndex(model, current.index - 1), 'Periodo anterior (cerrado)', close),
          periodOption(current, runningOk
            ? `Periodo en curso · su servicio terminó el ${formatDay(model.endsOn)}`
            : `Periodo en curso · se factura cuando termine, el ${formatDay(payDayAfter(current))}`,
          close, !runningOk))),
    });
    if (!choice) return;

    const price = periodPrice(model);
    if (!price) {
      toastBad('Su plan no tiene precio. Ponlo en Ajustes → Precios.');
      return;
    }

    // Two ways of charging somebody for a fortnight that is not theirs to pay:
    // one already paid in the notebook, or one before they started eating.
    const since = servingSince(model);
    const doubt = isCovered(choice, model.paidThrough)
      ? `Según su cuenta ya pagó hasta el ${formatDay(model.paidThrough)}, y esta ${periodWord(model)} entra ahí.`
      : (since && choice.start < since
        ? `Empezó a comer el ${formatDay(since)}, después de que empezó esta ${periodWord(model)}.`
        : '');
    if (doubt && !await confirm({
      title: '¿Facturarla de todos modos?',
      message: `${doubt} Si la facturas, la va a deber.`,
      confirmLabel: 'Facturar',
    })) return;

    try {
      const charge = periodCharge(model, store.pricing);
      const bill = await issueInvoice(model, choice, charge, charge.meals,
        { uid: session.uid, name: session.displayName });
      toastOk(bill.existed ? 'Esa factura ya estaba hecha' : 'Factura generada');
      go(`/invoices/${invoiceId(model.id, choice.start)}`);
    } catch (error) {
      toastBad(errorText(error));
    }
  }

  const periodOption = (period, label, close, disabled = false) =>
    h('button.item.item--tap-target', {
      type: 'button',
      disabled,
      style: {
        border: '1px solid var(--border)', borderRadius: 'var(--r-md)',
        ...(disabled ? { opacity: '.55', cursor: 'not-allowed' } : {}),
      },
      onclick: () => close(period),
    },
    h('div.item__main',
      h('div.item__title', formatRange(period.start, period.end)),
      h('div.item__meta', label)),
    icon('chevronR', 'rowlink__chev'));

  /**
   * Moves the farm's access to another address. The previous one stops working
   * the moment this is saved, so it doubles as "quitar acceso".
   */
  async function changeEmail(model) {
    const next = await sheet({
      title: 'Correo de acceso',
      build: (close) => {
        let value = model.email || '';
        return h('div.stack.stack-4',
          model.email
            ? alert('El correo anterior dejará de abrir la app en cuanto guardes.', 'warn')
            : alert('Con este correo podrá entrar a su app.', 'info'),
          field({
            label: 'Correo de la persona',
            hint: 'Déjalo vacío para quitarle el acceso.',
            control: input({
              value, type: 'email', inputmode: 'email', placeholder: 'persona@correo.com',
              oninput: (event) => { value = event.target.value; },
            }),
          }),
          button('Guardar', {
            variant: 'primary', block: true,
            onClick: () => close(value.trim()),
          }));
      },
    });
    if (next == null || next.toLowerCase() === (model.email || '').toLowerCase()) return;

    try {
      await updateClient(model.id, { email: next, name: model.name }, model.email);
      toastOk(next ? 'Correo de acceso actualizado' : 'Acceso retirado');
    } catch (error) { toastBad(errorText(error)); }
  }

  /**
   * Moves someone to another location — of their farm, or of another farm
   * entirely when they change jobs. Their terms follow the new farm, because
   * the price is the farm's agreement and not theirs.
   */
  async function changePlace(model) {
    const picked = await sheet({
      title: 'Cambiar de ubicación',
      build: (close) => {
        let farmId = model.farmId || store.farms[0]?.id || '';
        const places = h('div.stack.stack-2');

        const paint = () => {
          const farm = farmById(farmId);
          const options = farm?.locations || [];
          mount(places, options.length
            ? options.map((place) => h('button.item.item--tap-target', {
                type: 'button',
                style: { border: '1px solid var(--border)', borderRadius: 'var(--r-md)' },
                onclick: () => close({ farm, locationId: place.id }),
              },
              h('span.item__ico', icon('pin')),
              h('div.item__main',
                h('div.item__title', place.name),
                place.id === model.locationId ? h('div.item__meta', 'Donde está ahora') : null),
              icon('chevronR', 'rowlink__chev')))
            : alert('Ese rancho todavía no tiene ubicaciones.', 'warn'));
        };
        paint();

        return h('div.stack.stack-4',
          field({
            label: 'Rancho',
            control: select({
              value: farmId,
              options: store.farms.map((row) => ({ value: row.id, label: row.name })),
              onchange: (event) => { farmId = event.target.value; paint(); },
            }),
          }),
          field({ label: 'Ubicación', control: places }));
      },
    });
    if (!picked || (picked.farm.id === model.farmId && picked.locationId === model.locationId)) return;

    try {
      await moveClient(model.id, picked.farm, picked.locationId, model.farmId);
      toastOk('Ubicación actualizada');
    } catch (error) { toastBad(errorText(error)); }
  }

  draw();
  return () => stops.forEach((stop) => stop?.());
}

/* --- Small pieces ----------------------------------------------------------- */

const emailChip = (email) => h('div.truncate', {
  style: {
    display: 'inline-block', maxWidth: '100%', padding: '8px 14px',
    borderRadius: 'var(--r-md)',
    background: 'var(--ink-800)', color: '#fff',
    fontFamily: 'var(--font-num)', fontSize: 'var(--fs-sm)', fontWeight: '600',
  },
}, email);

async function copy(text) {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    toastOk('Correo copiado');
  } catch {
    toastBad('No se pudo copiar. Anótalo manualmente.');
  }
}

/** How far through the current cycle we are, 0–100. */
function periodProgress(period) {
  const total = Number(period.every) || 14;   // a week for somebody who pays weekly
  const elapsed = Math.max(0, Math.min(total,
    (new Date(`${today()}T12:00:00`) - new Date(`${period.start}T12:00:00`)) / 86400000 + 1));
  return Math.round((elapsed / total) * 100);
}
