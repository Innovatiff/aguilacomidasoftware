/**
 * Security-rule tests.
 *
 * These run against the Firestore emulator, not the real project, so they are
 * free and safe to run as often as you like. They exist because the rules are
 * the only thing standing between one farm and another farm's payments — and a
 * rule that reads correctly can still be wrong.
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
const FARM_A  = 'rafa@elsol.ca';
const FARM_B  = 'ana@berryfields.ca';
const OUTSIDER = 'quien@ajeno.com';

/* --- Fixtures, written with rules bypassed --------------------------------- */

await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();

  await setDoc(doc(db, `staff/${KITCHEN}`), { email: KITCHEN, name: 'María' });

  await setDoc(doc(db, 'clients/cA'), {
    name: 'Rancho El Sol', email: FARM_A, mealsPerDay: 24, pricePerMeal: 9.5,
    status: 'active', cycleAnchor: '2026-01-05',
  });
  await setDoc(doc(db, 'clients/cB'), {
    name: 'Berry Fields', email: FARM_B, mealsPerDay: 40, pricePerMeal: 8.75,
    status: 'active', cycleAnchor: '2026-01-05',
  });
  await setDoc(doc(db, `clientEmails/${FARM_A}`), { clientId: 'cA', clientName: 'Rancho El Sol' });
  await setDoc(doc(db, `clientEmails/${FARM_B}`), { clientId: 'cB', clientName: 'Berry Fields' });

  await setDoc(doc(db, 'deliveries/cA_2026-08-19'), { clientId: 'cA', date: '2026-08-19', status: 'delivered', meals: 24 });
  await setDoc(doc(db, 'deliveries/cB_2026-08-19'), { clientId: 'cB', date: '2026-08-19', status: 'delivered', meals: 40 });
  await setDoc(doc(db, 'invoices/cA_2026-08-05'), { clientId: 'cA', amount: 2736, paid: 0, settled: false, dueDate: '2026-08-22' });
  await setDoc(doc(db, 'invoices/cB_2026-08-05'), { clientId: 'cB', amount: 4200, paid: 0, settled: false, dueDate: '2026-08-22' });

  await setDoc(doc(db, 'conversations/cA'), { clientId: 'cA', unreadAdmin: 3, unreadClient: 0 });
  await setDoc(doc(db, 'conversations/cA/messages/m1'), { text: 'hola', senderUid: 'farmA', senderRole: 'client' });
});

const as = (uid, email) => env.authenticatedContext(uid, email ? { email } : undefined).firestore();

const admin    = as('admin1', KITCHEN);
const farmA    = as('farmA', FARM_A);
const farmB    = as('farmB', FARM_B);
const outsider = as('nobody', OUTSIDER);
const anon     = env.unauthenticatedContext().firestore();

/* --- Anonymous -------------------------------------------------------------- */

console.log('\n--- Anonymous -------------------------------------------------');
await check('anon cannot read a farm', getDoc(doc(anon, 'clients/cA')), false);
await check('anon cannot read invoices', getDoc(doc(anon, 'invoices/cA_2026-08-05')), false);
await check('anon cannot see who is staff', getDoc(doc(anon, `staff/${KITCHEN}`)), false);

/* --- The kitchen ------------------------------------------------------------ */

console.log('\n--- The kitchen ------------------------------------------------');
await check('admin lists every farm', getDocs(collection(admin, 'clients')), true);
await check('admin reads any invoice', getDoc(doc(admin, 'invoices/cB_2026-08-05')), true);
await check('admin records a payment', updateDoc(doc(admin, 'invoices/cA_2026-08-05'), { paid: 100 }), true);
await check('admin registers a farm', setDoc(doc(admin, 'clients/cC'), { name: 'Valle Verde', email: 'luis@valle.ca' }), true);
await check('admin registers that farm\'s email', setDoc(doc(admin, 'clientEmails/luis@valle.ca'), { clientId: 'cC' }), true);
await check('admin adds a colleague to the team', setDoc(doc(admin, 'staff/jorge@aguila.ca'), { email: 'jorge@aguila.ca', name: 'Jorge' }), true);
await check('admin removes a colleague', deleteDoc(doc(admin, 'staff/jorge@aguila.ca')), true);

/* --- A registered farm ------------------------------------------------------ */

console.log('\n--- A registered farm ------------------------------------------');
await check('farm reads its own record', getDoc(doc(farmA, 'clients/cA')), true);
await check('farm reads its own invoice', getDoc(doc(farmA, 'invoices/cA_2026-08-05')), true);
await check('farm queries its own deliveries',
  getDocs(query(collection(farmA, 'deliveries'), where('clientId', '==', 'cA'))), true);
await check('farm posts to its own thread',
  setDoc(doc(farmA, 'conversations/cA/messages/new1'),
    { text: 'buenas', senderUid: 'farmA', senderRole: 'client' }), true);
await check('farm saves its own name and phone',
  setDoc(doc(farmA, 'users/farmA'), { name: 'Rafael', phone: '6045550143' }), true);

/* --- A farm reaching past its own data -------------------------------------- */

console.log('\n--- A farm reaching past its own data --------------------------');
await check('farm cannot read another farm', getDoc(doc(farmA, 'clients/cB')), false);
await check('farm cannot read another farm\'s invoice', getDoc(doc(farmA, 'invoices/cB_2026-08-05')), false);
await check('farm cannot read another farm\'s thread', getDoc(doc(farmA, 'conversations/cB')), false);
await check('farm cannot list all deliveries', getDocs(collection(farmA, 'deliveries')), false);
await check('farm cannot list all invoices', getDocs(collection(farmA, 'invoices')), false);
await check('farm cannot list all farms', getDocs(collection(farmA, 'clients')), false);
await check('farm cannot query another farm\'s deliveries',
  getDocs(query(collection(farmA, 'deliveries'), where('clientId', '==', 'cB'))), false);
await check('farm cannot edit its own price', updateDoc(doc(farmA, 'clients/cA'), { pricePerMeal: 1 }), false);
await check('farm cannot write off its own invoice',
  updateDoc(doc(farmA, 'invoices/cA_2026-08-05'), { paid: 9999, settled: true }), false);
await check('farm cannot mark its own delivery delivered',
  updateDoc(doc(farmA, 'deliveries/cA_2026-08-19'), { status: 'delivered' }), false);
await check('farm cannot post into another farm\'s thread',
  setDoc(doc(farmA, 'conversations/cB/messages/x'),
    { text: 'x', senderUid: 'farmA', senderRole: 'client' }), false);
await check('farm cannot post as somebody else',
  setDoc(doc(farmA, 'conversations/cA/messages/spoof'),
    { text: 'x', senderUid: 'admin1', senderRole: 'admin' }), false);
await check('farm cannot post a system note',
  setDoc(doc(farmA, 'conversations/cA/messages/sys'),
    { text: 'Pago recibido', senderUid: null, senderRole: 'system' }), false);
await check('nobody edits a sent message',
  updateDoc(doc(farmA, 'conversations/cA/messages/m1'), { text: 'editado' }), false);
await check('farm B cannot reach farm A', getDoc(doc(farmB, 'clients/cA')), false);

/* --- The two lists are the authorisation ------------------------------------ */

console.log('\n--- The two lists are the authorisation ------------------------');
await check('a farm cannot make itself staff',
  setDoc(doc(farmA, `staff/${FARM_A}`), { email: FARM_A }), false);
await check('a farm cannot repoint its own email at another farm',
  setDoc(doc(farmA, `clientEmails/${FARM_A}`), { clientId: 'cB' }), false);
await check('a farm cannot register a new email for itself',
  setDoc(doc(farmA, 'clientEmails/otro@correo.com'), { clientId: 'cA' }), false);
await check('a farm cannot smuggle a role onto its profile',
  setDoc(doc(farmA, 'users/farmA'), { name: 'Rafael', role: 'admin' }), false);

/* --- A signed-in account on neither list ------------------------------------ */

console.log('\n--- A signed-in account on neither list -------------------------');
await check('an outsider reads nothing', getDoc(doc(outsider, 'clients/cA')), false);
await check('an outsider cannot list farms', getDocs(collection(outsider, 'clients')), false);
await check('an outsider cannot make itself staff',
  setDoc(doc(outsider, `staff/${OUTSIDER}`), { email: OUTSIDER }), false);
await check('an outsider cannot register itself as a farm',
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
