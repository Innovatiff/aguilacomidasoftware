/**
 * Inline SVG icons — one stroke-based set, 24x24, currentColor.
 * Shipping them as strings avoids a sprite request and lets any icon be
 * dropped straight into an `h()` tree via `icon('truck')`.
 */

import { svg } from './dom.js';

const wrap = (paths) =>
  `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
        stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

export const PATHS = {
  home:      '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M9.5 21v-6h5v6"/>',
  farm:      '<path d="M3 21V9.5L12 4l9 5.5V21"/><path d="M3 21h18"/><path d="M9 21v-6h6v6"/><path d="M9 12h6"/>',
  users:     '<path d="M16 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 20v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  userPlus:  '<path d="M15 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/>',
  truck:     '<path d="M3 16V6a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v10"/><path d="M15 9h3.6a1 1 0 0 1 .84.46L21.8 13H15"/><path d="M21.8 13v3h-1.3M8.5 16H15M3 16h1.5"/><circle cx="6.5" cy="18" r="2"/><circle cx="18.5" cy="18" r="2"/>',
  receipt:   '<path d="M5 21V4a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v17l-3-1.6-3 1.6-3-1.6L7 21l-2-1.6z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
  chat:      '<path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9 9 0 0 1-3.9-.9L3 21l1.9-4.6A8.4 8.4 0 0 1 4 11.5 8.4 8.4 0 0 1 12.5 3 8.4 8.4 0 0 1 21 11.5z"/>',
  settings:  '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 7 19.4a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 3 15H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 7a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 2.6h.09A1.7 1.7 0 0 0 11 1V1a2 2 0 1 1 4 0v.09A1.7 1.7 0 0 0 17 2.6a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 21.4 7V7a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1z"/>',
  chevronR:  '<path d="m9 18 6-6-6-6"/>',
  chevronL:  '<path d="m15 18-6-6 6-6"/>',
  chevronD:  '<path d="m6 9 6 6 6-6"/>',
  arrowLeft: '<path d="M19 12H5M12 19l-7-7 7-7"/>',
  arrowRight:'<path d="M5 12h14M12 5l7 7-7 7"/>',
  plus:      '<path d="M12 5v14M5 12h14"/>',
  search:    '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.1-4.1"/>',
  check:     '<path d="m20 6-11 11-5-5"/>',
  checkDouble:'<path d="m1.5 12.5 4 4 8-8"/><path d="m10 16.5 1.5 1.5 9-9"/>',
  clock:     '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.2 1.9"/>',
  alert:     '<path d="M10.3 3.9 1.9 18a2 2 0 0 0 1.7 3h16.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4.5M12 17.5h.01"/>',
  info:      '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>',
  x:         '<path d="M18 6 6 18M6 6l12 12"/>',
  phone:     '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/>',
  pin:       '<path d="M20 10.5c0 5.6-8 12-8 12s-8-6.4-8-12a8 8 0 1 1 16 0z"/><circle cx="12" cy="10.5" r="3"/>',
  send:      '<path d="M21.5 2.5 11 13"/><path d="M21.5 2.5 15 21.5l-4-8.5-8.5-4z"/>',
  edit:      '<path d="M11 4H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-6"/><path d="M18.4 2.6a2 2 0 0 1 2.8 2.8L12 14.7l-3.8.9.9-3.8z"/>',
  logout:    '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/>',
  calendar:  '<rect x="3" y="4.5" width="18" height="16.5" rx="2"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/>',
  box:       '<path d="m21 8-9-5-9 5v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/>',
  utensils:  '<path d="M4 2.5v6a3 3 0 0 0 6 0v-6M7 8.5V21"/><path d="M17.5 2.5c-1.7 1.4-2.5 3.4-2.5 5.8 0 1.9.6 3.2 2.5 3.7V21"/>',
  wallet:    '<path d="M20 8V6.5a2 2 0 0 0-2-2H5.5A2.5 2.5 0 0 0 3 7v10a2.5 2.5 0 0 0 2.5 2.5H18a2 2 0 0 0 2-2V16"/><path d="M21 8.5h-4.5a3.5 3.5 0 0 0 0 7H21z"/>',
  card:      '<rect x="2" y="5" width="20" height="14" rx="2.5"/><path d="M2 10h20"/>',
  cash:      '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/>',
  bell:      '<path d="M18 8.5a6 6 0 1 0-12 0c0 6-2.5 7.5-2.5 7.5h17S18 14.5 18 8.5z"/><path d="M13.7 20a2 2 0 0 1-3.4 0"/>',
  filter:    '<path d="M3 4.5h18l-7 8.5v6l-4 2v-8z"/>',
  refresh:   '<path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v5h-5"/>',
  copy:      '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  key:       '<circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.8 12.2 8.7-8.7M17 6l2.5 2.5M14.5 8.5 17 11"/>',
  ban:       '<circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/>',
  pause:     '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
  play:      '<path d="M6 4.5 20 12 6 19.5z"/>',
  trend:     '<path d="M22 7 13.5 15.5 9 11l-7 7"/><path d="M16 7h6v6"/>',
  eagle:     '<path d="M12 3.2 5.5 6.4v4.3c0 4.3 2.7 8.2 6.5 9.6 3.8-1.4 6.5-5.3 6.5-9.6V6.4z"/><path d="M9.2 11.2 12 13.6l2.8-2.4M12 8.4v5.2"/>',
  note:      '<path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H15l5 5v11.5A1.5 1.5 0 0 1 18.5 21h-13A1.5 1.5 0 0 1 4 19.5z"/><path d="M14.5 3v5.5H20"/>',
  download:  '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7.5 10.5 4.5 4.5 4.5-4.5M12 15V3"/>',
  shield:    '<path d="M12 22s8-3.6 8-10V5.5L12 2.5 4 5.5V12c0 6.4 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>',
  mail:      '<rect x="2.5" y="4.5" width="19" height="15" rx="2.5"/><path d="m3 7 9 6 9-6"/>',
  lock:      '<rect x="4" y="10.5" width="16" height="10.5" rx="2"/><path d="M8 10.5V7a4 4 0 1 1 8 0v3.5"/>',
  eye:       '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff:    '<path d="M10.6 5.2A9.7 9.7 0 0 1 12 5c6.4 0 10 7 10 7a17.7 17.7 0 0 1-3.4 4.3M6.5 6.6A17.6 17.6 0 0 0 2 12s3.6 7 10 7a9.6 9.6 0 0 0 4.3-1"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2M2 2l20 20"/>',
  more:      '<circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/>',
  route:     '<circle cx="6" cy="19" r="3"/><circle cx="18" cy="5" r="3"/><path d="M9 19h6a4 4 0 0 0 0-8H9a4 4 0 0 1 0-8h6"/>',
  clipboard: '<rect x="8" y="2.5" width="8" height="4" rx="1.5"/><path d="M16 4.5h2a2 2 0 0 1 2 2V20a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6.5a2 2 0 0 1 2-2h2"/><path d="M8.5 12h7M8.5 16h4"/>',
};

/** `icon('truck')` -> an <svg> element. */
export function icon(name, className) {
  const node = svg(wrap(PATHS[name] || PATHS.info));
  // Added, not assigned: the base `icon` class is what gives every glyph its
  // 20px box, and dropping it makes the SVG fall back to its intrinsic size.
  if (className) node.classList.add(...className.split(/\s+/).filter(Boolean));
  return node;
}

/** Raw markup, for the rare place that builds an innerHTML string. */
export const iconHTML = (name) => wrap(PATHS[name] || PATHS.info);
