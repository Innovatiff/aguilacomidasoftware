/**
 * Putting somebody's balance on the right number.
 *
 * Adding a debt can only make what they owe bigger, and a lot of what needs
 * fixing goes the other way: a fortnight billed at the wrong plan, a debt typed
 * twice, an amount the kitchen agreed to knock down at the counter, a notebook
 * balance that was never right to begin with. Before this the only way down was
 * to delete a bill, which loses the fact that it was ever there.
 *
 * So the manager types what the person *should* owe and says why. The
 * difference is worked out here rather than in her head: up is one new debt,
 * down comes off the newest bills first, and every bill it touches keeps a note
 * of what changed and who changed it.
 *
 * The note is not optional, for the same reason a debt's reason is not. A
 * balance that moved with no explanation is the argument at the counter two
 * weeks later, with nobody able to say what happened.
 */

import { h, mount } from '../lib/dom.js';
import { sheet, toastOk, toastBad } from './overlay.js';
import { field, moneyInput, input, defList, defRow, button, alert, switchRow } from './kit.js';
import { icon } from '../lib/icons.js';
import { adjustBalance } from '../data/invoices.js';
import { postSystemMessage } from '../data/chat.js';
import { balanceOf, invoiceTitle, isCharge, round2 } from '../lib/billing.js';
import { money, moneyFull } from '../lib/format.js';
import { dbMessage } from '../firebase.js';

/**
 * Reasons that save typing, not reasons that stand in for it.
 *
 * They fill the box and stay editable — the point is a fast start, with the
 * manager finishing the sentence with what actually happened.
 */
const COMMON = ['Se le cobró de más', 'Corrección del cuaderno', 'Descuento acordado'];

/**
 * @param {object} options
 * @param {object} options.client     whose balance is being corrected
 * @param {object[]} options.invoices their bills, to work out what is owed
 * @param {object} options.author     { uid, name }
 * @returns {Promise<object|null>} what the adjustment did, or null
 */
export function openBalanceSheet({ client, invoices = [], author }) {
  const open = invoices
    .filter((invoice) => balanceOf(invoice) > 0.005)
    .sort((a, b) => String(b.periodStart).localeCompare(String(a.periodStart)));
  const balance = round2(open.reduce((sum, invoice) => sum + balanceOf(invoice), 0));

  return sheet({
    title: 'Corregir el saldo',
    build: (close) => {
      let target = String(balance);
      let note = '';
      let tell = true;
      let busy = false;

      const submit = h('button.btn.btn--primary.btn--block.btn--lg', { type: 'submit' });
      const after = h('div.t-sm.c-soft');
      const plan = h('div.stack.stack-1');

      const amountBox = moneyInput({
        value: balance,
        autofocus: true,
        oninput: (event) => { target = event.target.value; repaint(); },
      });

      const noteBox = input({
        placeholder: 'Ej. la quincena de agosto se cobró doble',
        maxlength: 90,
        oninput: (event) => { note = event.target.value; repaint(); },
      });

      const setNote = (text) => {
        note = text;
        noteBox.value = text;
        noteBox.focus();
        repaint();
      };

      const setTarget = (value) => {
        target = String(value);
        amountBox.querySelector('input').value = value;
        repaint();
      };

      function repaint() {
        const wanted = round2(Number(target) || 0);
        const difference = round2(wanted - balance);
        const moved = Math.abs(difference) > 0.005;

        mount(submit, icon('edit'),
          moved ? `Dejar su saldo en ${money(wanted)}` : 'Corregir el saldo');
        submit.disabled = busy || !moved || !note.trim() || wanted < 0;

        mount(after, !moved
          ? 'Escribe el saldo correcto.'
          : difference > 0
            ? `Se le suman ${money(difference)}: de ${money(balance)} a ${moneyFull(wanted)}.`
            : `Se le bajan ${money(-difference)}: de ${money(balance)} a ${moneyFull(wanted)}.`);

        // What it is about to touch, before it touches it. A correction that
        // silently reshuffles four bills is one nobody can check afterwards.
        mount(plan, moved ? preview(difference) : null);
      }

      /** The bills this correction lands on, in the order it will use them. */
      function preview(difference) {
        if (difference > 0) {
          return h('div.stack.stack-1',
            h('div.t-xs.upper.c-faint.w-700', 'Se agrega'),
            h('p.t-sm.c-soft', `Una deuda nueva de ${money(difference)} con esa nota.`));
        }

        let left = round2(-difference);
        const rows = [];
        for (const invoice of open) {
          if (left <= 0.005) break;
          const give = Math.min(left, balanceOf(invoice));
          if (give <= 0.005) continue;
          rows.push([invoice, give]);
          left = round2(left - give);
        }

        return h('div.stack.stack-1',
          h('div.t-xs.upper.c-faint.w-700', 'Se baja de'),
          rows.length
            ? h('div.stack.stack-1', rows.map(([invoice, give]) => h('div.row.row--between',
                h('span.t-sm.truncate', invoiceTitle(invoice)
                  + (isCharge(invoice) ? ' (deuda)' : '')),
                h('span.t-sm.w-600', `−${money(give)}`))))
            : null,
          left > 0.005
            ? alert(`No se pueden bajar ${money(left)}: esa parte ya está pagada. `
              + 'Para devolverla hay que cancelar el pago.', 'warn')
            : null);
      }

      const form = h('form.stack.stack-4', {
        onsubmit: async (event) => {
          event.preventDefault();
          if (busy) return;

          const wanted = round2(Number(target) || 0);
          if (!note.trim()) { toastBad('Escribe por qué cambia el saldo.'); return; }
          if (Math.abs(round2(wanted - balance)) < 0.005) {
            toastBad('Ese es el saldo que ya tiene.');
            return;
          }

          busy = true;
          submit.disabled = true;
          mount(submit, h('span.spinner.spinner--light'), 'Corrigiendo…');

          try {
            const result = await adjustBalance(
              { client, target: wanted, note: note.trim() }, author);
            if (tell) await announce(client, balance, wanted, note.trim());
            toastOk(`Saldo corregido · ${money(wanted)}`);
            close(result);
          } catch (error) {
            busy = false;
            repaint();
            toastBad(error?.message || dbMessage(error));
          }
        },
      },

      h('div.card.card--tight',
        defList([
          defRow('Cliente', client.name),
          defRow('Dónde', [client.farmName, client.locationName].filter(Boolean).join(' · ') || '—'),
          defRow('Debe hoy', balance > 0.005 ? money(balance) : 'Nada', { total: true }),
        ])),

      field({
        label: '¿Cuánto debe en realidad?',
        hint: 'Escribe el total correcto, no la diferencia.',
        control: h('div.stack.stack-2',
          amountBox,
          balance > 0.005
            ? h('div.row.row--wrap', { style: { gap: '6px' } },
                button('No debe nada', {
                  variant: 'soft', size: 'sm', onClick: () => setTarget(0),
                }),
                button(`La mitad ${money(round2(balance / 2))}`, {
                  variant: 'soft', size: 'sm', onClick: () => setTarget(round2(balance / 2)),
                }))
            : null),
      }),

      field({
        label: '¿Por qué?',
        hint: 'Queda guardado en cada cuenta que se toque, con tu nombre y la fecha.',
        control: h('div.stack.stack-2',
          noteBox,
          h('div.row.row--wrap', { style: { gap: '6px' } },
            COMMON.map((text) => button(text, {
              variant: 'soft', size: 'sm', onClick: () => setNote(text),
            })))),
      }),

      after,
      plan,

      switchRow('Avisarle por mensaje', {
        checked: tell,
        hint: 'Le llega a su app con el saldo nuevo y el motivo.',
        onChange: (value) => { tell = value; },
      }),

      alert('No borra nada: cada cuenta guarda lo que decía antes, lo que dice ahora, quién lo '
        + 'cambió y por qué. Lo que ya está pagado no se toca — para devolver dinero hay que '
        + 'cancelar el pago.', 'info'),

      submit);

      repaint();
      return form;
    },
  }).then((result) => result || null);
}

/** Tells the client, in their own thread, what moved and why. */
async function announce(client, before, afterBalance, note) {
  const text = `Corregimos su saldo: de ${moneyFull(before)} a ${moneyFull(afterBalance)}. `
    + `Motivo: ${note}. Si algo no cuadra, escríbanos por aquí.`;

  try {
    await postSystemMessage(client.id, text, {
      meta: { kind: 'adjustment', amount: round2(afterBalance - before) },
      notify: true,
    });
  } catch {
    // The correction is what matters; a failed courtesy note must not undo it.
  }
}
