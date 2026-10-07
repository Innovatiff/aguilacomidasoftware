/**
 * Putting a list in order by dragging its rows — or with the arrow keys.
 *
 * Made for the manager's setup screen, which runs on whatever the manager has
 * in hand: the office PC with a mouse, or a phone with a thumb. So it is built
 * on pointer events rather than HTML drag-and-drop, which does nothing at all
 * on a phone; the row being dragged is the real row, not a ghost image of it;
 * and everything a drag does, the keyboard does too.
 *
 * The list owns nothing. Every row carries `data-key`, the handle carries
 * `data-grip`, and when a drag or a key press ends `onChange` is called with
 * the keys in their new order. The caller keeps the order and redraws, which
 * is also what renumbers the rows.
 *
 * @param {HTMLElement} list    the element whose children are the rows
 * @param {object}      opts
 * @param {Function}    opts.onChange  (keys, movedKey) => void
 * @returns {Function} stops listening
 */
export function sortable(list, { onChange }) {
  let drag = null;

  const rows = () => [...list.children].filter((el) => el.dataset.key != null);
  const keys = () => rows().map((el) => el.dataset.key);
  const middle = (el) => {
    const box = el.getBoundingClientRect();
    return box.top + box.height / 2;
  };
  // The sheet scrolls, not the page — a long libreta is taller than a phone.
  const scroller = () => list.closest('.sheet__body') || document.scrollingElement;

  function begin(event) {
    const grip = event.target.closest('[data-grip]');
    if (!grip || !list.contains(grip)) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const row = grip.closest('[data-key]');
    if (!row || row.parentElement !== list) return;

    event.preventDefault();
    grip.setPointerCapture?.(event.pointerId);
    drag = {
      row,
      id: event.pointerId,
      y: event.clientY,
      // Where the pointer would be if the row had not moved. The row is drawn
      // at (pointer − origin), so as neighbours are moved past it the origin
      // follows and the row stays under the finger.
      origin: event.clientY,
      before: keys().join('\n'),
      frame: 0,
    };
    row.classList.add('is-dragging');
    list.classList.add('is-sorting');
    drag.frame = requestAnimationFrame(edges);
  }

  function track(event) {
    if (!drag || event.pointerId !== drag.id) return;
    event.preventDefault();
    drag.y = event.clientY;
    settle();
  }

  /**
   * Moves the row past every neighbour whose middle the pointer has crossed.
   *
   * It is always the neighbour that moves, never the row being dragged: taking
   * an element out of the document, even to put it straight back one place
   * over, makes the browser drop its pointer capture — and the drag ended after
   * the first row it crossed.
   */
  function settle() {
    const { row } = drag;
    // A guard, not a condition: each pass moves the row one place, and a fast
    // flick can cross several rows between two events.
    for (let guard = 0; guard < 500; guard += 1) {
      const next = row.nextElementSibling;
      const prev = row.previousElementSibling;
      if (next?.dataset.key != null && drag.y > middle(next)) {
        shift(() => row.before(next));
      } else if (prev?.dataset.key != null && drag.y < middle(prev)) {
        shift(() => row.after(prev));
      } else {
        break;
      }
    }
    row.style.transform = `translateY(${drag.y - drag.origin}px)`;
  }

  /** Runs a DOM move and keeps the dragged row where it was on the screen. */
  function shift(move) {
    const before = drag.row.offsetTop;
    move();
    drag.origin += drag.row.offsetTop - before;
  }

  /*
   * Near the top or bottom of what is visible, the list scrolls by itself —
   * faster the closer the pointer is to the edge. Without it, a location can
   * only be dragged as far as the screen goes, which on a phone is about six
   * rows.
   */
  function edges() {
    if (!drag) return;
    const box = scroller();
    const view = box === document.scrollingElement
      ? { top: 0, bottom: window.innerHeight }
      : box.getBoundingClientRect();
    const zone = 56;
    let step = 0;
    if (drag.y < view.top + zone) step = -Math.ceil((view.top + zone - drag.y) / 5);
    else if (drag.y > view.bottom - zone) step = Math.ceil((drag.y - (view.bottom - zone)) / 5);

    if (step) {
      const before = box.scrollTop;
      box.scrollTop += step;
      const moved = box.scrollTop - before;
      if (moved) {
        drag.origin -= moved;
        settle();
      }
    }
    drag.frame = requestAnimationFrame(edges);
  }

  function end(event) {
    if (!drag || (event && event.pointerId !== drag.id)) return;
    cancelAnimationFrame(drag.frame);
    const { row, before } = drag;
    drag = null;
    row.style.transform = '';
    row.classList.remove('is-dragging');
    list.classList.remove('is-sorting');
    const after = keys();
    if (after.join('\n') !== before) onChange(after, row.dataset.key);
  }

  /** On the handle, the arrow keys move the row one place, Home and End to the ends. */
  function press(event) {
    const grip = event.target.closest('[data-grip]');
    if (!grip || !list.contains(grip) || drag) return;
    const row = grip.closest('[data-key]');
    const order = keys();
    const at = order.indexOf(row?.dataset.key);
    if (at === -1) return;

    const to = {
      ArrowUp: at - 1, ArrowDown: at + 1, Home: 0, End: order.length - 1,
    }[event.key];
    if (to == null) return;
    event.preventDefault();
    if (to < 0 || to >= order.length || to === at) return;

    const [moved] = order.splice(at, 1);
    order.splice(to, 0, moved);
    onChange(order, moved);
  }

  list.addEventListener('pointerdown', begin);
  list.addEventListener('pointermove', track);
  list.addEventListener('pointerup', end);
  list.addEventListener('pointercancel', end);
  list.addEventListener('lostpointercapture', end);
  list.addEventListener('keydown', press);

  return () => {
    if (drag) end();
    list.removeEventListener('pointerdown', begin);
    list.removeEventListener('pointermove', track);
    list.removeEventListener('pointerup', end);
    list.removeEventListener('pointercancel', end);
    list.removeEventListener('lostpointercapture', end);
    list.removeEventListener('keydown', press);
  };
}
