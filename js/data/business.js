/**
 * What goes at the top of a printed receipt.
 *
 * The name, the address, the phone. It lives in `config/business` rather than
 * in the source because it is the kitchen's information, not the software's:
 * a phone number that changes should be a field somebody types, not a release.
 *
 * The defaults are what the store's own till already prints, so the first
 * receipt out of this system looks like the last one out of that one — which
 * is the point. Somebody holding both should not be able to tell that anything
 * changed except what the receipt is for.
 */

import { db, doc, getDoc, setDoc, onSnapshot, serverTimestamp, docData } from '../firebase.js';

const businessRef = () => doc(db, 'config', 'business');

export const DEFAULT_BUSINESS = {
  name: 'EL AGUILA MARKET',
  address: '42 ERIE SOUTH',
  city: 'LEAMINGTON ON N8H 3A9',
  phone: '519-322-4222',
  email: 'PLEAGUILA@GMAIL.COM',
  footer: 'GRACIAS POR SU PAGO',
};

/** Stored values over defaults, with blanks treated as "not set". */
export function normalizeBusiness(data) {
  const out = { ...DEFAULT_BUSINESS };
  for (const key of Object.keys(DEFAULT_BUSINESS)) {
    const value = String(data?.[key] ?? '').trim();
    if (value) out[key] = value;
  }
  // The one field that is allowed to be genuinely empty: a store with no email
  // should print no email line rather than somebody else's.
  if (data && Object.prototype.hasOwnProperty.call(data, 'email')
    && String(data.email ?? '').trim() === '') out.email = '';
  return out;
}

export function watchBusiness(onData, onError) {
  return onSnapshot(businessRef(),
    (snap) => onData(normalizeBusiness(docData(snap))), onError);
}

export const getBusiness = async () => normalizeBusiness(docData(await getDoc(businessRef())));

export async function saveBusiness(values, author) {
  const clean = {};
  for (const key of Object.keys(DEFAULT_BUSINESS)) {
    clean[key] = String(values?.[key] ?? '').trim();
  }
  if (!clean.name) throw new Error('El recibo necesita al menos el nombre del negocio.');

  await setDoc(businessRef(), {
    ...clean,
    updatedAt: serverTimestamp(),
    updatedByName: author?.name || '',
  }, { merge: true });

  return normalizeBusiness(clean);
}
