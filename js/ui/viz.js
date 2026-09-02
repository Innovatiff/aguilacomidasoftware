/**
 * The two figures the dashboard draws.
 *
 * Plain SVG and plain DOM, like everything else here — no chart library for two
 * shapes, on an app that ships no build step. What they are is decided by the
 * job the data has to do:
 *
 *   - **Takings, day by day.** Change over time, one series, and the point is
 *     *today against the days around it* — so it is a column chart in one hue
 *     with today emphasised and the rest recessive, not a rainbow of fourteen
 *     bars that all shout equally.
 *   - **The book, by state.** Part-to-whole across three states, so a single
 *     stacked bar: it answers "how much of the roster is behind?" in one glance,
 *     which three separate counts cannot.
 *
 * Two rules the marks follow, both about white space rather than ink: touching
 * fills are separated by a 2px gap in the surface colour, never by a stroke; and
 * nothing is labelled that the reader did not ask for — the extreme and today
 * carry labels, the rest carry a tooltip.
 *
 * Colour never says anything on its own. The share bar's three states each carry
 * a swatch, a name and a number in the legend under it, because the green and
 * the amber sit at ΔE 7.4 under protanopia — inside the floor band where the
 * palette validator only allows a pair with a second channel behind it.
 */

import { h, mount } from '../lib/dom.js';
import { money, number } from '../lib/format.js';
import { weekdayName, formatDay } from '../lib/dates.js';

/* --- Columns: what came in, day by day ------------------------------------ */

/**
 * @param {object[]} rows   `{ day, amount, count }`, oldest first
 * @param {string} [today]  the day to emphasise
 */
export function columnChart(rows, { today: todayKey, height = 168 } = {}) {
  const top = Math.max(...rows.map((r) => r.amount), 1);
  const best = rows.reduce((a, b) => (b.amount > a.amount ? b : a), rows[0]);

  const tip = h('div.viz__tip', { hidden: true });

  const column = (row) => {
    const isToday = row.day === todayKey;
    const tall = Math.round((row.amount / top) * (height - 26));
    // An empty day is still a day: a 3px stub keeps the rhythm of the week
    // visible instead of leaving a hole the eye reads as missing data.
    const barHeight = row.amount > 0 ? Math.max(tall, 6) : 3;

    const bar = h(`span.viz__bar${isToday ? '.is-today' : ''}${row.amount > 0 ? '' : '.is-empty'}`,
      { style: { height: `${barHeight}px` } });

    return h(`div.viz__col${isToday ? '.is-today' : ''}`, {
      tabindex: '0',
      onmouseenter: (e) => show(e.currentTarget, row),
      onmouseleave: hide,
      onfocus: (e) => show(e.currentTarget, row),
      onblur: hide,
    },
    // Only the two that carry the story: the best day, and today. A number on
    // every column is fourteen numbers nobody reads.
    (row === best && row.amount > 0) || (isToday && row.amount > 0)
      ? h('span.viz__cap', money(row.amount, { round: true }))
      : null,
    bar,
    h('span.viz__tick', weekdayName(row.day).slice(0, 3)));
  };

  const wrap = h('div.viz.viz--cols', { style: { '--viz-h': `${height}px` } },
    h('div.viz__plot', rows.map(column)),
    // Fourteen three-letter ticks need about 340px of label in 340px of phone.
    // Rather than let them run into each other — or clip the last value against
    // the right edge — the narrow layout drops both and says what the axis is
    // instead. The bars still carry the rhythm and every value is a tap away.
    h('div.viz__axis',
      h('span', `Hace ${rows.length} días`),
      h('span', 'Hoy')),
    tip);

  // Declarations, not consts: the columns above are built before this point in
  // the function body and both handlers are captured while they are built, so a
  // `const` here would still be in its dead zone when the first column asks
  // for it.
  function hide() { tip.hidden = true; }

  function show(node, row) {
    mount(tip,
      h('div.viz__tip-k', `${weekdayName(row.day)} ${formatDay(row.day)}`),
      h('div.viz__tip-v', money(row.amount)),
      h('div.viz__tip-n', row.count
        ? `${number(row.count)} ${row.count === 1 ? 'pago' : 'pagos'}`
        : 'Sin pagos'));
    tip.hidden = false;
    const box = node.getBoundingClientRect();
    const host = wrap.getBoundingClientRect();
    tip.style.left = `${box.left - host.left + box.width / 2}px`;
  }
  return wrap;
}

/* --- One bar, three states ------------------------------------------------ */

/**
 * @param {object[]} parts `{ key, label, value, tone }` — tone is ok | warn | bad
 */
export function shareBar(parts) {
  const total = parts.reduce((sum, p) => sum + p.value, 0);
  const shown = parts.filter((p) => p.value > 0);

  return h('div.viz__share',
    h('div.viz__sharebar',
      total
        ? shown.map((p) => h(`span.viz__seg.viz__seg--${p.tone}`, {
            style: { flexGrow: String(p.value) },
            title: `${p.label}: ${number(p.value)}`,
          }))
        : h('span.viz__seg.viz__seg--none', { style: { flexGrow: '1' } })),

    // The legend is the identity channel; the bar only shows proportion.
    h('div.viz__legend', parts.map((p) => h('div.viz__key',
      h(`span.viz__dot.viz__dot--${p.tone}`),
      h('span.viz__key-n', number(p.value)),
      h('span.viz__key-l', p.label)))));
}
