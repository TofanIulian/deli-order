import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";
const firebaseConfig = {
  apiKey: "AIzaSyAcQ-6gJFU1hkS_APCbMDVYCIymOHbiMmY",
  authDomain: "deli-airport.firebaseapp.com",
  projectId: "deli-airport",
  storageBucket: "deli-airport.firebasestorage.app",
  messagingSenderId: "279704214605",
  appId: "1:279704214605:web:d4843d3bb19bf3bfdf1004"
};

const app = initializeApp(firebaseConfig);


export const db = getFirestore(app);
export const auth = getAuth(app);