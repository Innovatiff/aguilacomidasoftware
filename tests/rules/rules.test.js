/**
 * Security-rule tests.
 *
 * These run against the Firestore emulator, not the real project, so they are
 * free and safe to run as often as you like. They exist because the rules are
 * the only thing standing between one worker and another worker's payments —
 * and a rule that reads correctly can still be wrong.
 *
 *   npm install     (once)
 *   npm test
 *
 * See README.md in this folder.
 */

import fs from 'node:fs';
import {
  initializeTestEnvironment, assertFails, assertSucceeds,
} from '@firebase/rules-unit-testing';
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc, collection, query, where, getDocs,
} from 'firebase/firestore';

const results = [];
const check = async (name, promise, shouldPass) => {
  let passed;
  try { await (shouldPass ? assertSucceeds(promise) : assertFails(promise)); passed = true; }
  catch { passed = false; }
  results.push({ name, passed, shouldPass });
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${shouldPass ? '[allow]' : '[deny] '} ${name}`);
};

const env = await initializeTestEnvironment({
  projectId: 'demo-aguila',
  firestore: {
    rules: fs.readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8'),
    host: '127.0.0.1',
    port: 8790,
  },
});

await env.clearFirestore();

const KITCHEN = 'maria@aguila.ca';
// Two people at the *same* farm, plus one at another: the interesting case is
// that working alongside somebody grants nothing about them.
const RAFA  = 'rafa@correo.com';      // Mucci Farms, Casa 1
const SOFIA = 'sofia@correo.com';     // Mucci Farms, Casa 1 — same farm as Rafa
const ANA   = 'ana@correo.com';       // Berry Fields Farm
const OUTSIDER = 'quien@ajeno.com';

/* --- Fixtures, written with rules bypassed --------------------------------- */

await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();

  await setDoc(doc(db, `staff/${KITCHEN}`), { email: KITCHEN, name: 'María' });

  await setDoc(doc(db, 'farms/fA'), {
    name: 'Mucci Farms', pricePerMeal: 9.5, status: 'active', cycleAnchor: '2026-01-05',
    locations: [{ id: 'loc_a', name: 'Casa 1' }, { id: 'loc_b', name: 'Bloque Norte' }],
  });
  await setDoc(doc(db, 'farms/fB'), {
    name: 'Berry Fields Farm', pricePerMeal: 8.75, status: 'active', cycleAnchor: '2026-01-05',
    locations: [{ id: 'loc_c', name: 'Campo Sur' }],
  });

  const person = (id, name, email, farmId, farmName, locationId, locationName) => setDoc(
    doc(db, `clients/${id}`), {
      name, email, farmId, farmName, locationId, locationName,
      mealsPerDay: 2, pricePerMeal: 9.5, status: 'active', cycleAnchor: '2026-01-05',
    });

  await person('cA', 'Rafael Núñez', RAFA, 'fA', 'Mucci Farms', 'loc_a', 'Casa 1');
  await person('cS', 'Sofía Márquez', SOFIA, 'fA', 'Mucci Farms', 'loc_a', 'Casa 1');
  await person('cB', 'Ana Gutiérrez', ANA, 'fB', 'Berry Fields Farm', 'loc_c', 'Campo Sur');

  await setDoc(doc(db, `clientEmails/${RAFA}`), { clientId: 'cA', clientName: 'Rafael Núñez' });
  await setDoc(doc(db, `clientEmails/${SOFIA}`), { clientId: 'cS', clientName: 'Sofía Márquez' });
  await setDoc(doc(db, `clientEmails/${ANA}`), { clientId: 'cB', clientName: 'Ana Gutiérrez' });

  await setDoc(doc(db, 'invoices/cA_2026-08-05'), { clientId: 'cA', farmId: 'fA', amount: 266, paid: 0, settled: false, dueDate: '2026-08-22' });
  await setDoc(doc(db, 'invoices/cS_2026-08-05'), { clientId: 'cS', farmId: 'fA', amount: 133, paid: 0, settled: false, dueDate: '2026-08-22' });
  await setDoc(doc(db, 'invoices/cB_2026-08-05'), { clientId: 'cB', farmId: 'fB', amount: 122, paid: 0, settled: false, dueDate: '2026-08-22' });

  await setDoc(doc(db, 'config/pricing'), {
    tiers: [{ mealsPerDay: 1, price: 75 }, { mealsPerDay: 2, price: 140 }],
  });

  await setDoc(doc(db, 'receipts/rA'), {
    clientId: 'cA', clientName: 'Rafael Núñez', amount: 140, method: 'cash',
    date: '2026-08-20', folio: 'R-260820-AAAA', balanceAfter: 0,
    applied: [{ invoiceId: 'cA_2026-08-05', periodStart: '2026-08-05', periodEnd: '2026-08-18', amount: 140 }],
  });
  await setDoc(doc(db, 'receipts/rB'), {
    clientId: 'cB', clientName: 'Ana Gutiérrez', amount: 75, method: 'cash',
    date: '2026-08-20', folio: 'R-260820-BBBB', balanceAfter: 0, applied: [],
  });

  await setDoc(doc(db, 'conversations/cA'), { clientId: 'cA', unreadAdmin: 3, unreadClient: 0 });
  await setDoc(doc(db, 'conversations/cA/messages/m1'), { text: 'hola', senderUid: 'rafa', senderRole: 'client' });
});

const as = (uid, email) => env.authenticatedContext(uid, email ? { email } : undefined).firestore();

const admin    = as('admin1', KITCHEN);
const rafa     = as('rafa', RAFA);
const sofia    = as('sofia', SOFIA);
const ana      = as('ana', ANA);
const outsider = as('nobody', OUTSIDER);
const anon     = env.unauthenticatedContext().firestore();

/* --- Anonymous -------------------------------------------------------------- */

console.log('\n--- Anonymous -------------------------------------------------');
await check('anon cannot read a client', getDoc(doc(anon, 'clients/cA')), false);
await check('anon cannot read a farm', getDoc(doc(anon, 'farms/fA')), false);
await check('anon cannot read invoices', getDoc(doc(anon, 'invoices/cA_2026-08-05')), false);
await check('anon cannot see who is staff', getDoc(doc(anon, `staff/${KITCHEN}`)), false);

/* --- The kitchen ------------------------------------------------------------ */

console.log('\n--- The kitchen ------------------------------------------------');
await check('admin lists every farm', getDocs(collection(admin, 'farms')), true);
await check('admin lists every client', getDocs(collection(admin, 'clients')), true);
await check('admin reads any invoice', getDoc(doc(admin, 'invoices/cB_2026-08-05')), true);
await check('admin records a payment', updateDoc(doc(admin, 'invoices/cA_2026-08-05'), { paid: 100 }), true);
await check('admin registers a farm',
  setDoc(doc(admin, 'farms/fC'), { name: 'Valle Verde', locations: [], pricePerMeal: 10 }), true);
await check('admin adds a location to a farm',
  updateDoc(doc(admin, 'farms/fC'), { locations: [{ id: 'loc_z', name: 'Casa 9' }] }), true);
await check('admin registers a client at that farm',
  setDoc(doc(admin, 'clients/cC'), {
    name: 'Luis Peña', email: 'luis@correo.com', farmId: 'fC', farmName: 'Valle Verde',
    locationId: 'loc_z', locationName: 'Casa 9',
  }), true);
await check('admin registers that client\'s email', setDoc(doc(admin, 'clientEmails/luis@correo.com'), { clientId: 'cC' }), true);
await check('admin adds a colleague to the team', setDoc(doc(admin, 'staff/jorge@aguila.ca'), { email: 'jorge@aguila.ca', name: 'Jorge' }), true);
await check('admin removes a colleague', deleteDoc(doc(admin, 'staff/jorge@aguila.ca')), true);
await check('admin changes the price list',
  setDoc(doc(admin, 'config/pricing'), { tiers: [{ mealsPerDay: 1, price: 80 }] }), true);
await check('admin writes a receipt',
  setDoc(doc(admin, 'receipts/rNew'), { clientId: 'cA', amount: 140, folio: 'R-1', date: '2026-08-21' }), true);

/* --- A registered client ---------------------------------------------------- */

console.log('\n--- A registered client ----------------------------------------');
await check('client reads their own record', getDoc(doc(rafa, 'clients/cA')), true);
await check('client reads the farm they eat at', getDoc(doc(rafa, 'farms/fA')), true);
await check('client reads their own invoice', getDoc(doc(rafa, 'invoices/cA_2026-08-05')), true);
await check('client queries their own invoices',
  getDocs(query(collection(rafa, 'invoices'), where('clientId', '==', 'cA'))), true);
await check('client reads the price list', getDoc(doc(rafa, 'config/pricing')), true);
await check('client reads their own receipt', getDoc(doc(rafa, 'receipts/rA')), true);
await check('client lists their own receipts',
  getDocs(query(collection(rafa, 'receipts'), where('clientId', '==', 'cA'))), true);
await check('client posts to their own thread',
  setDoc(doc(rafa, 'conversations/cA/messages/new1'),
    { text: 'buenas', senderUid: 'rafa', senderRole: 'client' }), true);
await check('client saves their own name and phone',
  setDoc(doc(rafa, 'users/rafa'), { name: 'Rafael', phone: '6045550143' }), true);

/* --- A client reaching past their own data ---------------------------------- */

console.log('\n--- A client reaching past their own data ----------------------');
await check('client cannot read another client', getDoc(doc(rafa, 'clients/cB')), false);
await check('client cannot read another client\'s invoice', getDoc(doc(rafa, 'invoices/cB_2026-08-05')), false);
await check('client cannot read another client\'s thread', getDoc(doc(rafa, 'conversations/cB')), false);
await check('client cannot list all invoices', getDocs(collection(rafa, 'invoices')), false);
await check('client cannot query another client\'s invoices',
  getDocs(query(collection(rafa, 'invoices'), where('clientId', '==', 'cB'))), false);
await check('client cannot list all clients', getDocs(collection(rafa, 'clients')), false);
await check('client cannot list all farms', getDocs(collection(rafa, 'farms')), false);
await check('client cannot edit their own price', updateDoc(doc(rafa, 'clients/cA'), { pricePerMeal: 1 }), false);
await check('client cannot move themselves to another farm',
  updateDoc(doc(rafa, 'clients/cA'), { farmId: 'fB' }), false);
await check('client cannot rename a location of their farm',
  updateDoc(doc(rafa, 'farms/fA'), { locations: [{ id: 'loc_a', name: 'Mía' }] }), false);
await check('client cannot change their farm\'s price',
  updateDoc(doc(rafa, 'farms/fA'), { pricePerMeal: 1 }), false);
await check('client cannot change the price list',
  setDoc(doc(rafa, 'config/pricing'), { tiers: [{ mealsPerDay: 2, price: 1 }] }), false);
await check('client cannot write themselves a receipt',
  setDoc(doc(rafa, 'receipts/fake'), { clientId: 'cA', amount: 999, folio: 'R-X' }), false);
await check('nobody edits a receipt, not even to fix it',
  updateDoc(doc(admin, 'receipts/rA'), { amount: 1 }), false);
await check('nobody deletes a receipt', deleteDoc(doc(admin, 'receipts/rA')), false);
await check('client cannot list every receipt', getDocs(collection(rafa, 'receipts')), false);
await check('client cannot read somebody else\'s receipt', getDoc(doc(rafa, 'receipts/rB')), false);
await check('client cannot write off their own invoice',
  updateDoc(doc(rafa, 'invoices/cA_2026-08-05'), { paid: 9999, settled: true }), false);
await check('client cannot post into another client\'s thread',
  setDoc(doc(rafa, 'conversations/cB/messages/x'),
    { text: 'x', senderUid: 'rafa', senderRole: 'client' }), false);
await check('client cannot post as somebody else',
  setDoc(doc(rafa, 'conversations/cA/messages/spoof'),
    { text: 'x', senderUid: 'admin1', senderRole: 'admin' }), false);
await check('client cannot post a system note',
  setDoc(doc(rafa, 'conversations/cA/messages/sys'),
    { text: 'Pago recibido', senderUid: null, senderRole: 'system' }), false);
await check('nobody edits a sent message',
  updateDoc(doc(rafa, 'conversations/cA/messages/m1'), { text: 'editado' }), false);

/* --- Two people at the same farm -------------------------------------------- */

// The case the whole restructure introduces: standing in the same field as
// somebody grants nothing about them. Only the farm document is shared.
console.log('\n--- Two people at the same farm ---------------------------------');
await check('a colleague reads the same farm', getDoc(doc(sofia, 'farms/fA')), true);
await check('a colleague cannot read your record', getDoc(doc(sofia, 'clients/cA')), false);
await check('a colleague cannot read your invoice', getDoc(doc(sofia, 'invoices/cA_2026-08-05')), false);
await check('a colleague cannot read your receipt', getDoc(doc(sofia, 'receipts/rA')), false);
await check('a colleague cannot read your thread', getDoc(doc(sofia, 'conversations/cA')), false);
await check('a colleague cannot post in your thread',
  setDoc(doc(sofia, 'conversations/cA/messages/y'),
    { text: 'y', senderUid: 'sofia', senderRole: 'client' }), false);
await check('somebody at another farm cannot read this farm', getDoc(doc(ana, 'farms/fA')), false);
await check('somebody at another farm cannot reach this one\'s people',
  getDoc(doc(ana, 'clients/cA')), false);

/* --- The two lists are the authorisation ------------------------------------ */

console.log('\n--- The two lists are the authorisation ------------------------');
await check('a client cannot make themselves staff',
  setDoc(doc(rafa, `staff/${RAFA}`), { email: RAFA }), false);
await check('a client cannot repoint their own email at another client',
  setDoc(doc(rafa, `clientEmails/${RAFA}`), { clientId: 'cB' }), false);
await check('a client cannot register a new email for themselves',
  setDoc(doc(rafa, 'clientEmails/otro@correo.com'), { clientId: 'cA' }), false);
await check('a client cannot smuggle a role onto their profile',
  setDoc(doc(rafa, 'users/rafa'), { name: 'Rafael', role: 'admin' }), false);
await check('a client cannot invent a farm',
  setDoc(doc(rafa, 'farms/fZ'), { name: 'Mío', locations: [] }), false);

/* --- A signed-in account on neither list ------------------------------------ */

console.log('\n--- A signed-in account on neither list -------------------------');
await check('an outsider reads nothing', getDoc(doc(outsider, 'clients/cA')), false);
await check('an outsider cannot read a farm', getDoc(doc(outsider, 'farms/fA')), false);
await check('an outsider cannot list clients', getDocs(collection(outsider, 'clients')), false);
await check('an outsider cannot make itself staff',
  setDoc(doc(outsider, `staff/${OUTSIDER}`), { email: OUTSIDER }), false);
await check('an outsider cannot register itself as a client',
  setDoc(doc(outsider, `clientEmails/${OUTSIDER}`), { clientId: 'cA' }), false);
await check('an outsider cannot read somebody else\'s staff entry',
  getDoc(doc(outsider, `staff/${KITCHEN}`)), false);
await check('an account may check its own staff entry',
  getDoc(doc(outsider, `staff/${OUTSIDER}`)), true);

/* --- The first administrator ------------------------------------------------- */

console.log('\n--- The first administrator ------------------------------------');

// A fresh project: clear everything so no staff exists.
await env.clearFirestore();

const FIRST = 'primero@aguila.ca';
const SECOND = 'segundo@aguila.ca';
const first = as('first-uid', FIRST);
const second = as('second-uid', SECOND);

await check('nobody can add themselves to staff before claiming the seat',
  setDoc(doc(first, `staff/${FIRST}`), { email: FIRST }), false);

await check('the seat cannot be claimed for another uid',
  setDoc(doc(second, 'config/bootstrap'), { ownerUid: 'first-uid', at: new Date() }), false);

await check('the first caller claims the seat',
  setDoc(doc(first, 'config/bootstrap'), { ownerUid: 'first-uid', ownerEmail: FIRST, at: new Date() }), true);

await check('the founder then adds themselves to staff',
  setDoc(doc(first, `staff/${FIRST}`), { email: FIRST, name: 'Primero' }), true);

await check('the founder really is an admin now',
  getDocs(collection(first, 'clients')), true);

await check('a second caller cannot claim the seat',
  setDoc(doc(second, 'config/bootstrap'), { ownerUid: 'second-uid', at: new Date() }), false);

await check('a second account cannot add itself to staff',
  setDoc(doc(second, `staff/${SECOND}`), { email: SECOND }), false);

await check('the founder record cannot be overwritten, even by an admin',
  updateDoc(doc(first, 'config/bootstrap'), { ownerUid: 'second-uid' }), false);

await check('an admin may still write other settings',
  setDoc(doc(first, 'config/pricing'), { tiers: [{ mealsPerDay: 1, price: 75 }] }), true);

await check('the founder record cannot be deleted',
  deleteDoc(doc(first, 'config/bootstrap')), false);

await check('the founder adds the second account from the panel',
  setDoc(doc(first, `staff/${SECOND}`), { email: SECOND, name: 'Segundo' }), true);

await check('the second account can now run the panel',
  getDocs(collection(second, 'clients')), true);

await check('the founder cannot claim the seat twice to re-grant itself',
  setDoc(doc(first, 'config/bootstrap'), { ownerUid: 'first-uid', at: new Date() }), false);

/* --- Case handling ----------------------------------------------------------- */

console.log('\n--- Case handling ------------------------------------------------');
const shouty = as('first-uid-caps', FIRST.toUpperCase());
await check('a listed address matches regardless of case',
  getDocs(collection(shouty, 'clients')), true);

await env.cleanup();

const failed = results.filter((r) => !r.passed);
console.log(`\n${results.length - failed.length}/${results.length} rule checks behaved as intended`);
if (failed.length) {
  console.log('\nNOT AS INTENDED:');
  failed.forEach((f) => console.log(
    `  ${f.shouldPass ? 'was denied but should be allowed' : 'was ALLOWED but should be denied'}: ${f.name}`));
}
process.exit(failed.length ? 1 : 0);
