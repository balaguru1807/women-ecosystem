// client/src/firebase.js
import { initializeApp } from "firebase/app";

import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
} from "firebase/auth";

import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  addDoc,
  deleteDoc,
  collection,
  getDocs,
  query,
  where,
  onSnapshot,
  serverTimestamp,
  orderBy,
  limit,
  arrayUnion,
  arrayRemove,
} from "firebase/firestore";


const firebaseConfig = {
  apiKey: "AIzaSyD_hEnC_Gt_aKPQzCBnas9mOf6ah2SWBr4",
  authDomain: "smartcampus-eca42.firebaseapp.com",
  projectId: "smartcampus-eca42",
  storageBucket: "smartcampus-eca42.firebasestorage.app",
  messagingSenderId: "822538863313",
  appId: "1:822538863313:web:fbff045ef607053a46fbf0"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);

// ✅ Google Provider
export const googleProvider = new GoogleAuthProvider();

// ✅ Export auth helpers
export {
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
};

// ✅ Export firestore helpers
export {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  addDoc,
  deleteDoc,
  collection,
  getDocs,
  query,
  where,
  onSnapshot,
  serverTimestamp,
  orderBy,
  limit,
  arrayUnion,
  arrayRemove,
};