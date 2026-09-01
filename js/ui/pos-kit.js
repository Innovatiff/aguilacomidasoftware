/**
 * The controls Acción rápida is built from.
 *
 * Everything here is the same idea in different shapes: make the target big,
 * make the state obvious without relying on colour, and never ask somebody to
 * hit a small thing with a mouse while a person waits at the counter.
 *
 * They are deliberately *not* the panel's widgets with bigger padding. A date
 * input is wrong here — old Windows browsers draw a cramped picker nobody can
 * hit — so the fortnight is chosen from three big tiles instead. A number
 * spinner is wrong for money, so money gets a real keypad. The panel keeps its
 * own versions untouched.
 */

import { h, mount } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { money, fold } from '../lib/format.js';
import { matchesSearch } from '../data/clients.js';
import { WEEKDAYS_SHORT, today as todayKey } from '../lib/dates.js';

/* --- Tiles ----------------------------------------------------------------- */

/** A big action tile: icon, name, one line under it. */
/**
 * @param {object} options
 * @param {'money'|'plan'|'who'} [options.family]  what kind of change this is,
 *   which decides the colour of its icon chip. Seven white rectangles all read
 *   the same from two steps back; three colours make the board scannable
 *   before a single word has been read. The label still says everything the
 *   colour does.
 */
export const posTile = ({
  icon: name, title, sub, onClick, on = false, hero = false, family,
}) =>
  h(`button.postile${hero ? '.postile--hero' : ''}${family ? `.postile--${family}` : ''}`
    + `${on ? '.is-on' : ''}`,
  { type: 'button', onclick: onClick },
  name ? h('span.postile__ico', icon(name)) : null,
  h('span.postile__name', title),
  sub ? h('span.postile__sub', sub) : null);

/**
 * Pick one of a few. Choosing advances the flow, because on this screen
 * tapping the answer and then tapping Siguiente is one tap too many —
 * Siguiente stays enabled for anybody who prefers it.
 */
export function posPick({ options, value, onPick, columns = 3, advance }) {
  const wrap = h(`div.postiles.postiles--${columns}`);

  const paint = () => mount(wrap, options.map((opt) => h(
    `button.postile.postile--pick${opt.value === value ? '.is-on' : ''}`,
    {
      type: 'button',
      onclick: () => {
        value = opt.value;
        onPick(opt.value);
        paint();
        if (advance) setTimeout(advance, 130);
      },
    },
    opt.icon ? h('span.postile__ico', icon(opt.icon)) : null,
    h('span.postile__name', opt.label),
    opt.sub ? h('span.postile__sub', opt.sub) : null,
  )));

  paint();
  return wrap;
}

/* --- Finding somebody ------------------------------------------------------ */

/**
 * The search box and its results.
 *
 * Sorted by who is most likely to be standing there: whoever owes money first,
 * then alphabetically. Five, because that is what fits above the footer on the
 * store's screen — a sixth row half-hidden behind a button is worse than no
 * sixth row, and one more letter typed is faster than scrolling for a name.
 */
/**
 * How many rows fit above the footer without scrolling.
 *
 * Read from the same breakpoint the stylesheet tightens everything else at,
 * rather than a second number kept in step by hand: on a 768px panel a fifth
 * row lands under the footer, and a row you have to scroll to find is a row the
 * counter does not know is there. The notice above the list says how many more
 * matched, so nothing is lost by showing fewer.
 */
const shownCount = () =>
  (globalThis.matchMedia?.('(max-height: 820px)')?.matches ? 4 : 5);

/**
 * How well a client answers what was typed.
 *
 * Lower is better. Somebody whose name *starts* with the term beats somebody
 * who merely contains it, who in turn beats somebody matched only on their
 * rancho or their phone — because what gets typed at the counter is a name, and
 * the person standing there is not usually the one who owes the most.
 */
function rank(client, term) {
  const needle = fold(term);
  const name = fold(client.name);
  if (!needle) return 3;
  if (name.startsWith(needle)) return 0;
  if (name.split(/\s+/).some((word) => word.startsWith(needle))) return 1;
  if (name.includes(needle)) return 2;
  return 3;
}

export function posFind({ clients, value, onPick, balanceOf }) {
  const box = h('input.posfield', {
    type: 'text',
    placeholder: 'Escribe el nombre…',
    autocomplete: 'off',
    spellcheck: 'false',
  });
  const results = h('div.posresults');
  // Above the list, not under it. Under it, the line sits below the fold on the
  // store's 768px screen — and a counter that has to scroll to learn there are
  // more people is a counter that tells somebody they are not in the system.
  const count = h('div.posmore', { hidden: true });

  const paint = () => {
    const term = box.value.trim();

    /*
     * With nothing typed, the list is who owes the most: that is who walks up.
     * Once a name is typed it is a lookup, not a worklist, so the closest
     * matches come first — five debtors called García are no help to the García
     * standing there who is up to date.
     *
     * Somebody marked inactive is left out of the idle list but findable by
     * name, flagged. They stopped eating here; they can still owe for what they
     * ate, and the counter has to be able to take that money.
     */
    const pool = term ? clients : clients.filter((c) => c.status !== 'inactive');
    const found = (term ? pool.filter((c) => matchesSearch(c, term)) : pool)
      .sort((a, b) => (term ? rank(a, term) - rank(b, term) : 0)
        || (balanceOf(b) - balanceOf(a))
        || String(a.name).localeCompare(String(b.name), 'es'));

    const rows = found.slice(0, shownCount());
    const hidden = found.length - rows.length;

    if (!rows.length) {
      count.hidden = true;
      mount(results, h('div.posempty', term
        ? `Nadie se llama así. Prueba con el apellido.`
        : 'Todavía no hay clientes.'));
      return;
    }

    // Never drop somebody in silence. Five Garcías on screen out of nine reads
    // as "he is not in the system", and that is how a client gets sent home.
    count.hidden = hidden <= 0;
    if (hidden > 0) {
      mount(count, `${found.length} se llaman así · faltan ${hidden}, `
        + 'escribe otra palabra de su nombre');
    }

    mount(results, rows.map((client) => personRow(client, {
      on: value?.id === client.id,
      owes: balanceOf(client),
      onClick: () => { onPick(client); paint(); },
    })));
  };

  box.oninput = paint;
  paint();
  return h('div.posfind', h('div', { style: { marginBottom: '4px' } }, box), count, results);
}

function personRow(client, { on, owes, onClick }) {
  const flag = client.status === 'inactive' ? 'inactivo'
    : client.status === 'paused' ? 'en pausa'
      : (client.endsOn && client.endsOn < todayKey()) ? 'terminó' : null;

  return h(`button.posperson${on ? '.is-on' : ''}`, { type: 'button', onclick: onClick },
    h('span.posperson__mark', initials(client.name)),
    h('span.posperson__who',
      h('span.posperson__name', client.name),
      h('span.posperson__where',
        [client.farmName, client.locationName].filter(Boolean).join(' · ') || 'Sin ubicación',
        flag ? h('span.posperson__flag', flag) : null)),
    h(`span.posperson__owes.posperson__owes--${owes > 0 ? 'bad' : 'ok'}`,
      owes > 0 ? money(owes, { round: true }) : 'Al día'));
}

const initials = (name) => String(name || '?')
  .trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase() || '?';

/* --- Money ----------------------------------------------------------------- */

/**
 * A keypad, because this is a cash counter.
 *
 * The amount is a string while it is being typed — "7", "75", "75.5" — so a
 * half-typed decimal does not get rounded away under the operator's hand. The
 * quick amounts above it cover the cases that are almost all of them: what
 * they owe, one fortnight, and both.
 */
export function posMoney({ value, onChange, quick = [] }) {
  let text = value ? String(value) : '';

  const shown = h('span.posamount__n');
  const display = h('div.posamount', h('span.posamount__cur', '$'), shown);

  const paint = () => {
    shown.textContent = text || '0';
    onChange(text ? Number(text) : 0);
  };

  const press = (key) => {
    if (key === 'del') text = text.slice(0, -1);
    else if (key === 'clear') text = '';
    else if (key === '.') { if (!text.includes('.')) text = `${text || '0'}.`; }
    // Cents, and no further: a third decimal on a till is a typo.
    else if (!(text.includes('.') && text.split('.')[1].length >= 2)) {
      text = text === '0' ? key : text + key;
    }
    paint();
  };

  const key = (label, action, className = '') =>
    h(`button.poskey${className}`, { type: 'button', onclick: () => press(action) }, label);

  const pad = h('div.poskeys',
    ...['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((n) => key(n, n)),
    key('.', '.'),
    key('0', '0'),
    key('←', 'del', '.poskey--wipe'));

  const chips = quick.length
    ? h('div.poschips', quick.map((q) => h('button.poschip', {
        type: 'button',
        onclick: () => { text = String(q.value); paint(); },
      }, q.label)))
    : null;

  paint();
  // Its own column: a keypad stretched across a 1366px screen is three rows of
  // slabs the hand has to travel between. A till is narrow because a till is
  // used with one hand without looking.
  return h('div.posmoney', display, chips, pad);
}

/* --- The week -------------------------------------------------------------- */

/** Seven toggles: which days they eat, and how many plates on each. */
export function posDays({ days, onChange }) {
  const order = [1, 2, 3, 4, 5, 6, 0];
  let chosen = new Set((days || []).map(Number));
  const wrap = h('div.posdays');

  const paint = () => mount(wrap, order.map((weekday) => {
    const on = chosen.has(weekday);
    return h(`button.posday${on ? '.is-on' : '.is-off'}`, {
      type: 'button',
      'aria-pressed': on ? 'true' : 'false',
      onclick: () => {
        if (on) chosen.delete(weekday); else chosen.add(weekday);
        onChange([...chosen].sort((a, b) => a - b));
        paint();
      },
    },
    h('span.posday__d', WEEKDAYS_SHORT[weekday]),
    h('span.posday__n', on ? '✓' : '—'));
  }));

  paint();
  return wrap;
}

/* --- Saying what will happen ----------------------------------------------- */

/** The confirmation table. `total: true` gives a row the big treatment. */
export const posSummary = (rows) => h('div.possum',
  rows.filter(Boolean).map(([k, v, opts]) => h(
    `div.possum__row${opts?.total ? '.possum__row--total' : ''}`,
    h('span.possum__k', k),
    h('span.possum__v', v),
  )));

export const posNote = (text, tone = 'warn') =>
  h(`div.posnote.posnote--${tone}`,
    icon(tone === 'bad' ? 'alert' : tone === 'ok' ? 'check' : 'info'),
    h('div', text));

export const posLabel = (text) => h('span.poslabel', text);

/** A labelled field, for the steps that carry one or two of them. */
export const posField = (label, control) => h('div', posLabel(label), control);

export const posText = ({ value = '', placeholder, onChange, ...rest }) => {
  const el = h('input.posfield', {
    type: 'text', value, placeholder, autocomplete: 'off', ...rest,
  });
  el.oninput = () => onChange(el.value);
  return el;
};
