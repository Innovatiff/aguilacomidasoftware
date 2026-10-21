/**
 * Which update this computer is running.
 *
 * There is no build step to stamp it, so it is written by hand with every
 * change that is pushed: `n` goes up by one — it is the number of commits on
 * the branch, so it can be checked against git — `day` is the day it was
 * pushed, and `what` says what that update brought.
 *
 * When a screen shows a lower number than the last update announced, the
 * change is not the problem: that computer, or the deploy, is behind. Reload
 * it, or check that Netlify published the latest push.
 */

import { formatDayShort } from './lib/dates.js';

export const VERSION = { n: 75, day: '2026-10-21', what: 'Calendario en «Último día» y número de versión' };

/** "Versión 75" — for the corners with room for a word and a number. */
export const versionShort = () => `Versión ${VERSION.n}`;

/** "21 oct" — the day it was pushed. */
export const versionDay = () => formatDayShort(VERSION.day);

/** "Versión 75 · 21 oct" */
export const versionLabel = () => `${versionShort()} · ${versionDay()}`;
