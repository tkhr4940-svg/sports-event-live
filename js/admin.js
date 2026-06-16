import { auth, db, googleProvider } from "./firebase.js?v=30";

import {
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";

import {
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";

const loginBtn = document.getElementById("login-btn");
const logoutBtn = document.getElementById("logout-btn");
const statusEl = document.getElementById("login-status");
const uidEl = document.getElementById("uid");

function showError(prefix, error) {
  console.error(error);
  statusEl.textContent =
    prefix + "：" + (error.code || "no-code") + " / " + error.message;
}

setPersistence(auth, browserLocalPersistence).catch((error) => {
  showError("ログイン保持設定に失敗しました", error);
});

loginBtn.addEventListener("click", async () => {
  try {
    loginBtn.disabled = true;
    statusEl.textContent = "Googleログイン中...";

    await setPersistence(auth, browserLocalPersistence);
    await signInWithPopup(auth, googleProvider);

    statusEl.textContent = "ログイン確認中...";
  } catch (error) {
    showError("ログインに失敗しました", error);
  } finally {
    loginBtn.disabled = false;
  }
});

logoutBtn.addEventListener("click", async () => {
  try {
    await signOut(auth);
  } catch (error) {
    showError("ログアウトに失敗しました", error);
  }
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
  statusEl.textContent = "ログイン済みです。管理者確認中...";

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
    showError("管理者確認に失敗しました", error);
  }
});
