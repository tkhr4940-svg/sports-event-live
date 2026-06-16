import { auth, db, googleProvider } from "./firebase.js";

import {
  signInWithRedirect,
  getRedirectResult,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";

import {
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";

const loginBtn = document.getElementById("login-btn");
const logoutBtn = document.getElementById("logout-btn");
const statusEl = document.getElementById("login-status");
const uidEl = document.getElementById("uid");

loginBtn.addEventListener("click", async () => {
  try {
    statusEl.textContent = "Googleログイン画面へ移動します...";
    await signInWithRedirect(auth, googleProvider);
  } catch (error) {
    console.error(error);
    statusEl.textContent =
      "ログイン開始に失敗しました：" + error.code + " / " + error.message;
  }
});

logoutBtn.addEventListener("click", async () => {
  await signOut(auth);
});

getRedirectResult(auth).catch((error) => {
  console.error(error);
  statusEl.textContent =
    "ログイン処理に失敗しました：" + error.code + " / " + error.message;
});

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    statusEl.textContent = "未ログインです";
    uidEl.textContent = "";
    loginBtn.hidden = false;
    logoutBtn.hidden = true;
    return;
  }

  loginBtn.hidden = true;
  logoutBtn.hidden = false;
  uidEl.textContent = user.uid;

  try {
    const adminRef = doc(db, "admins", user.uid);
    const adminSnap = await getDoc(adminRef);

    if (adminSnap.exists() && adminSnap.data().active === true) {
      statusEl.textContent = "管理者としてログイン中：" + user.email;
    } else {
      statusEl.textContent =
        "ログインはできていますが、まだ管理者登録されていません。下のUIDをFirebaseのadminsに登録してください。";
    }
  } catch (error) {
    console.error(error);
    statusEl.textContent =
      "管理者確認に失敗しました：" + error.code + " / " + error.message;
  }
});
