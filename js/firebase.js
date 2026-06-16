import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";
import { getAuth, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "あなたのapiKey",
  authDomain: "sports-event-live.authDomain",
  projectId: "あなたのprojectId",
  storageBucket: "あなたのstorageBucket",
  messagingSenderId: "あなたのmessagingSenderId",
  appId: "あなたのappId"
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
