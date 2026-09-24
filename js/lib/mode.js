/**
 * Which door the app was opened through.
 *
 * There are two, and they run exactly the same code:
 *
 *   index.html    the panel — the office, the counter, the manager's phone.
 *   empaque.html  the kitchen — installed on the two computers where the food
 *                 is packed, and on nothing else.
 *
 * The kitchen door opens on the keypad, has no panel navigation at all, and
 * puts Empacar at the top of the menu. Everything else is identical, because
 * it *is* the same app: a payment taken at the kitchen computer is the same
 * payment as one taken at the counter.
 *
 * The answer is a property of the page, never of the machine. A flag in
 * storage would follow the manager into their own window the one time they
 * opened the kitchen address to check on it, and turn their panel into a
 * kiosk they could not get out of.
 */

/** True when this page is one of the kitchen's packing computers. */
export const kitchen = () => document.body?.dataset.mode === 'kitchen';
