// backend/src/firebaseAdmin.js
import admin from "firebase-admin";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const serviceAccount = require("/etc/secrets/serviceAccountkey.json","utf-8");

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

export const db = admin.firestore();
export const authAdmin = admin.auth();
export const FieldValue = admin.firestore.FieldValue;