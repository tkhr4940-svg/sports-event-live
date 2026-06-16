import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";
import { getAuth, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyAhIC6JEKhT1dzxdWyBvK4JPNsWm2_bm1c",
  authDomain: "sports-event-live.firebaseapp.com",
  projectId: "sports-event-live",
  storageBucket: "sports-event-live.firebasestorage.app",
  messagingSenderId: "966316263895",
  appId: "1:966316263895:web:ad98e427e08ab00f23a392"
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
