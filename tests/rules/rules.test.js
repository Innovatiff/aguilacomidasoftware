/**
 * Security-rule tests.
 *
 * These run against the Firestore emulator, not the real project, so they are
 * free and safe to run as often as you like. They exist because the rules are
 * the only thing standing between one farm and another farm's payments — and
 * a rule that reads correctly can still be wrong.
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
  doc, getDoc, setDoc, updateDoc, collection, query, where, getDocs, arrayUnion,
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

// --- Fixtures, written with rules bypassed -------------------------------
await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await setDoc(doc(db, 'users/admin1'), { name: 'María', role: 'admin', clientId: null });
  await setDoc(doc(db, 'users/farm1'), { name: 'Rafael', role: 'client', clientId: 'cA' });
  await setDoc(doc(db, 'users/loner'), { name: 'Curioso', role: 'client', clientId: null });
  await setDoc(doc(db, 'users/pending1'), { name: 'Jorge', role: 'pending', clientId: null });

  await setDoc(doc(db, 'clients/cA'), {
    name: 'Rancho El Sol', accessCode: 'AAA111', linkedUids: ['farm1'], status: 'active',
    mealsPerDay: 24, pricePerMeal: 9.5, cycleAnchor: '2026-01-05',
  });
  await setDoc(doc(db, 'clients/cB'), {
    name: 'Berry Fields', accessCode: 'BBB222', linkedUids: [], status: 'active',
    mealsPerDay: 40, pricePerMeal: 8.75, cycleAnchor: '2026-01-05',
  });

  await setDoc(doc(db, 'accessCodes/AAA111'), { clientId: 'cA', clientName: 'Rancho El Sol' });
  await setDoc(doc(db, 'accessCodes/BBB222'), { clientId: 'cB', clientName: 'Berry Fields' });

  await setDoc(doc(db, 'deliveries/cA_2026-08-19'), { clientId: 'cA', date: '2026-08-19', status: 'delivered', meals: 24 });
  await setDoc(doc(db, 'deliveries/cB_2026-08-19'), { clientId: 'cB', date: '2026-08-19', status: 'delivered', meals: 40 });
  await setDoc(doc(db, 'invoices/cA_2026-08-05'), { clientId: 'cA', amount: 2736, paid: 0, settled: false, dueDate: '2026-08-22' });
  await setDoc(doc(db, 'invoices/cB_2026-08-05'), { clientId: 'cB', amount: 4200, paid: 0, settled: false, dueDate: '2026-08-22' });

  await setDoc(doc(db, 'conversations/cA'), { clientId: 'cA', unreadAdmin: 3, unreadClient: 0 });
  await setDoc(doc(db, 'conversations/cA/messages/m1'), { text: 'hola', senderUid: 'farm1', senderRole: 'client' });
});

const admin  = env.authenticatedContext('admin1').firestore();
const farm   = env.authenticatedContext('farm1').firestore();
const loner  = env.authenticatedContext('loner').firestore();     // signed in, linked to nothing
const anon   = env.unauthenticatedContext().firestore();

console.log('\n--- Anonymous ------------------------------------------------');
await check('anon cannot read a farm', getDoc(doc(anon, 'clients/cA')), false);
await check('anon cannot read invoices', getDoc(doc(anon, 'invoices/cA_2026-08-05')), false);
await check('anon cannot resolve an access code', getDoc(doc(anon, 'accessCodes/AAA111')), false);

console.log('\n--- Admin ----------------------------------------------------');
await check('admin lists every farm', getDocs(collection(admin, 'clients')), true);
await check('admin reads any invoice', getDoc(doc(admin, 'invoices/cB_2026-08-05')), true);
await check('admin writes a delivery', updateDoc(doc(admin, 'deliveries/cA_2026-08-19'), { status: 'issue' }), true);
await check('admin records a payment', updateDoc(doc(admin, 'invoices/cA_2026-08-05'), { paid: 100 }), true);

console.log('\n--- A linked farm --------------------------------------------');
await check('farm reads its own record', getDoc(doc(farm, 'clients/cA')), true);
await check('farm reads its own invoice', getDoc(doc(farm, 'invoices/cA_2026-08-05')), true);
await check('farm queries its own deliveries',
  getDocs(query(collection(farm, 'deliveries'), where('clientId', '==', 'cA'))), true);
await check('farm posts to its own thread',
  setDoc(doc(farm, 'conversations/cA/messages/new1'),
    { text: 'buenas', senderUid: 'farm1', senderRole: 'client' }), true);

console.log('\n--- A farm reaching past its own data ------------------------');
await check("farm cannot read another farm", getDoc(doc(farm, 'clients/cB')), false);
await check("farm cannot read another farm's invoice", getDoc(doc(farm, 'invoices/cB_2026-08-05')), false);
await check('farm cannot list all deliveries', getDocs(collection(farm, 'deliveries')), false);
await check('farm cannot list all invoices', getDocs(collection(farm, 'invoices')), false);
await check('farm cannot list all farms', getDocs(collection(farm, 'clients')), false);
await check('farm cannot edit its own price',
  updateDoc(doc(farm, 'clients/cA'), { pricePerMeal: 1 }), false);
await check('farm cannot write off its own invoice',
  updateDoc(doc(farm, 'invoices/cA_2026-08-05'), { paid: 9999, settled: true }), false);
await check('farm cannot mark its own delivery delivered',
  updateDoc(doc(farm, 'deliveries/cA_2026-08-19'), { status: 'delivered' }), false);
await check('farm cannot promote itself to admin',
  updateDoc(doc(farm, 'users/farm1'), { role: 'admin' }), false);
await check('farm cannot post as somebody else',
  setDoc(doc(farm, 'conversations/cA/messages/spoof'),
    { text: 'x', senderUid: 'admin1', senderRole: 'admin' }), false);
await check('farm cannot post a system note',
  setDoc(doc(farm, 'conversations/cA/messages/sys'),
    { text: 'Pago recibido', senderUid: null, senderRole: 'system' }), false);
await check('nobody edits a sent message',
  updateDoc(doc(farm, 'conversations/cA/messages/m1'), { text: 'editado' }), false);

console.log('\n--- The attack: a signed-in stranger who learned a client id ---');
await check('stranger self-links into a farm they have no code for',
  updateDoc(doc(loner, 'clients/cB'), { linkedUids: arrayUnion('loner') }), false);
await check('stranger points their own profile at any farm',
  updateDoc(doc(loner, 'users/loner'), { clientId: 'cB' }), false);

console.log('\n--- Legitimate redemption -------------------------------------');
await check('holder of a valid code joins the farm',
  (async () => {
    await setDoc(doc(loner, 'redemptions/loner'), { code: 'BBB222' });
    await updateDoc(doc(loner, 'clients/cB'), { linkedUids: arrayUnion('loner') });
    await updateDoc(doc(loner, 'users/loner'), { clientId: 'cB' });
  })(), true);

console.log('\n--- Rotation and expiry ---------------------------------------');

// A third farm with an already-expired code.
await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await setDoc(doc(db, 'clients/cC'), {
    name: 'Valle Verde', accessCode: 'CCC333', linkedUids: [], status: 'active',
    accessCodeExpiresAt: new Date(Date.now() - 86400000),
  });
  await setDoc(doc(db, 'clients/cD'), {
    name: 'La Peña', accessCode: 'DDD444', linkedUids: [], status: 'active',
    accessCodeExpiresAt: new Date(Date.now() + 86400000),
  });
  await setDoc(doc(db, 'users/u2'), { name: 'Dos', role: 'client', clientId: null });
  await setDoc(doc(db, 'users/u3'), { name: 'Tres', role: 'client', clientId: null });
  await setDoc(doc(db, 'users/u4'), { name: 'Cuatro', role: 'client', clientId: null });
});

const u2 = env.authenticatedContext('u2').firestore();
const u3 = env.authenticatedContext('u3').firestore();
const u4 = env.authenticatedContext('u4').firestore();

await check('an expired code cannot be redeemed',
  (async () => {
    await setDoc(doc(u2, 'redemptions/u2'), { code: 'CCC333' });
    await updateDoc(doc(u2, 'clients/cC'), { linkedUids: arrayUnion('u2') });
  })(), false);

await check('an unexpired code still works',
  (async () => {
    await setDoc(doc(u3, 'redemptions/u3'), { code: 'DDD444' });
    await updateDoc(doc(u3, 'clients/cD'), { linkedUids: arrayUnion('u3') });
  })(), true);

await check("one farm's code cannot join a different farm",
  (async () => {
    await setDoc(doc(u4, 'redemptions/u4'), { code: 'DDD444' });
    await updateDoc(doc(u4, 'clients/cA'), { linkedUids: arrayUnion('u4') });
  })(), false);

// The kitchen rotates cD's code; u4's staged copy of the old one goes stale.
await env.withSecurityRulesDisabled(async (ctx) => {
  await updateDoc(doc(ctx.firestore(), 'clients/cD'), { accessCode: 'ZZZ999' });
});
await check('rotating the code invalidates a staged old one',
  updateDoc(doc(u4, 'clients/cD'), { linkedUids: arrayUnion('u4') }), false);

await check('a farm cannot stage a code for somebody else',
  setDoc(doc(u4, 'redemptions/u2'), { code: 'DDD444' }), false);

await check('an already-joined farm can be pointed at by the profile',
  updateDoc(doc(u3, 'users/u3'), { clientId: 'cD' }), true);

await check('a farm that never accepted you cannot be pointed at',
  updateDoc(doc(u4, 'users/u4'), { clientId: 'cD' }), false);

console.log('\n--- Staff accounts are provisioned, never self-served ---------');

const fresh = env.authenticatedContext('brandnew').firestore();

await check('a new account cannot write itself the admin role',
  setDoc(doc(fresh, 'users/brandnew'), { name: 'X', role: 'admin', clientId: null }), false);

await check('a new account cannot park itself as pending either',
  setDoc(doc(fresh, 'users/brandnew'), { name: 'X', role: 'pending', clientId: null }), false);

await check('a farm can still create its own client profile',
  setDoc(doc(fresh, 'users/brandnew'), { name: 'X', role: 'client', clientId: null }), true);

await check('a client profile cannot arrive pre-linked to a farm',
  setDoc(doc(env.authenticatedContext('brandnew2').firestore(), 'users/brandnew2'),
    { name: 'Y', role: 'client', clientId: 'cA' }), false);

await check('a client cannot promote itself later',
  updateDoc(doc(fresh, 'users/brandnew'), { role: 'admin' }), false);

await env.withSecurityRulesDisabled(async (ctx) => {
  await setDoc(doc(ctx.firestore(), 'users/revoked'), { name: 'Ex', role: 'pending', clientId: null });
});

await check('an admin enables an existing account',
  updateDoc(doc(admin, 'users/revoked'), { role: 'admin' }), true);

await check('an admin revokes access again',
  updateDoc(doc(admin, 'users/revoked'), { role: 'pending' }), true);

console.log('\n--- The staff email list -------------------------------------');

// The address listed in staffEmails() inside firestore.rules.
const STAFF_EMAIL = 'alanf7178@gmail.com';

const listed = env.authenticatedContext('listed-uid', { email: STAFF_EMAIL }).firestore();
const listedCaps = env.authenticatedContext('listed-caps', { email: STAFF_EMAIL.toUpperCase() }).firestore();
const stranger = env.authenticatedContext('stranger-uid', { email: 'quien@ajeno.com' }).firestore();
const noEmail = env.authenticatedContext('no-email-uid').firestore();

await check('a listed address writes its own admin profile on first sign-in',
  setDoc(doc(listed, 'users/listed-uid'),
    { name: 'Alan', email: STAFF_EMAIL, role: 'admin', clientId: null }), true);

await check('the listed address then really is an admin',
  getDocs(collection(listed, 'clients')), true);

await check('the list is matched case-insensitively',
  setDoc(doc(listedCaps, 'users/listed-caps'),
    { name: 'Alan', email: STAFF_EMAIL, role: 'admin', clientId: null }), true);

await check('an unlisted address cannot write itself an admin profile',
  setDoc(doc(stranger, 'users/stranger-uid'),
    { name: 'Z', role: 'admin', clientId: null }), false);

await check('an account with no email on its token cannot either',
  setDoc(doc(noEmail, 'users/no-email-uid'),
    { name: 'Z', role: 'admin', clientId: null }), false);

await check('a listed address cannot promote somebody else',
  setDoc(doc(listed, 'users/stranger-uid'),
    { name: 'Z', role: 'admin', clientId: null }), false);

// An account left over from the old sign-up flow: profile exists, role pending.
await env.withSecurityRulesDisabled(async (ctx) => {
  await setDoc(doc(ctx.firestore(), 'users/leftover'),
    { name: 'Alan', email: STAFF_EMAIL, role: 'pending', clientId: null });
});
const leftover = env.authenticatedContext('leftover', { email: STAFF_EMAIL }).firestore();

await check('a listed address upgrades its own leftover pending profile',
  setDoc(doc(leftover, 'users/leftover'), { role: 'admin' }, { merge: true }), true);

await check('an unlisted farm still cannot upgrade its own profile',
  setDoc(doc(stranger, 'users/stranger-uid'), { role: 'admin' }, { merge: true }), false);

await env.cleanup();

const failed = results.filter((r) => !r.passed);
console.log(`\n${results.length - failed.length}/${results.length} rule checks behaved as intended`);
if (failed.length) {
  console.log('\nNOT AS INTENDED:');
  failed.forEach((f) => console.log(`  ${f.shouldPass ? 'was denied but should be allowed' : 'was ALLOWED but should be denied'}: ${f.name}`));
}
process.exit(failed.length ? 1 : 0);
