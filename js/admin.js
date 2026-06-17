import { auth, db, googleProvider } from "./firebase.js?v=40";

import {
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";

import {
  collection,
  addDoc,
  onSnapshot,
  doc,
  getDoc,
  updateDoc,
  serverTimestamp,
  writeBatch
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";

// ===== ログイン関連 =====

const loginBtn = document.getElementById("login-btn");
const logoutBtn = document.getElementById("logout-btn");
const statusEl = document.getElementById("login-status");
const uidEl = document.getElementById("uid");
const adminArea = document.getElementById("admin-area");

// ===== チーム管理関連 =====

const addTeamForm = document.getElementById("add-team-form");
const teamNameInput = document.getElementById("team-name-input");
const addTeamBtn = document.getElementById("add-team-btn");
const teamMessageEl = document.getElementById("team-message");
const teamCountEl = document.getElementById("team-count");
const teamsTbody = document.getElementById("teams-tbody");

let teams = [];
let teamsUnsubscribe = null;
let isCurrentUserAdmin = false;

function showAuthError(prefix, error) {
  console.error(error);
  statusEl.textContent =
    `${prefix}：${error.code || "no-code"} / ${error.message}`;
}

function showTeamMessage(message, isError = false) {
  teamMessageEl.textContent = message;
  teamMessageEl.className = isError ? "message error" : "message success";

  if (!isError) {
    setTimeout(() => {
      if (teamMessageEl.textContent === message) {
        teamMessageEl.textContent = "";
        teamMessageEl.className = "message";
      }
    }, 2500);
  }
}

function orderValue(team) {
  const n = Number(team.order);
  return Number.isFinite(n) ? n : 999999;
}

function sortTeams(list) {
  return [...list].sort((a, b) => {
    const orderDiff = orderValue(a) - orderValue(b);
    if (orderDiff !== 0) return orderDiff;

    const nameA = String(a.name || "");
    const nameB = String(b.name || "");
    return nameA.localeCompare(nameB, "ja");
  });
}

// ログイン状態をブラウザに保持
setPersistence(auth, browserLocalPersistence).catch((error) => {
  showAuthError("ログイン保持設定に失敗しました", error);
});

loginBtn.addEventListener("click", async () => {
  try {
    loginBtn.disabled = true;
    statusEl.textContent = "Googleログイン中...";

    await setPersistence(auth, browserLocalPersistence);
    await signInWithPopup(auth, googleProvider);

    statusEl.textContent = "ログイン確認中...";
  } catch (error) {
    showAuthError("ログインに失敗しました", error);
  } finally {
    loginBtn.disabled = false;
  }
});

logoutBtn.addEventListener("click", async () => {
  try {
    await signOut(auth);
  } catch (error) {
    showAuthError("ログアウトに失敗しました", error);
  }
});

onAuthStateChanged(auth, async (user) => {
  stopTeamsListener();

  if (!user) {
    isCurrentUserAdmin = false;

    statusEl.textContent = "未ログインです";
    uidEl.textContent = "";

    loginBtn.hidden = false;
    logoutBtn.hidden = true;
    adminArea.hidden = true;

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
      isCurrentUserAdmin = true;

      statusEl.textContent = `管理者としてログイン中：${user.email}`;
      adminArea.hidden = false;

      startTeamsListener();
    } else {
      isCurrentUserAdmin = false;

      statusEl.textContent =
        "ログインはできていますが、管理者登録されていません。FirestoreのadminsにUIDを登録してください。";
      adminArea.hidden = true;
    }
  } catch (error) {
    isCurrentUserAdmin = false;
    adminArea.hidden = true;
    showAuthError("管理者確認に失敗しました", error);
  }
});

// ===== チーム管理 =====

function startTeamsListener() {
  if (teamsUnsubscribe) return;

  const teamsRef = collection(db, "teams");

  teamsUnsubscribe = onSnapshot(
    teamsRef,
    (snapshot) => {
      teams = snapshot.docs.map((docSnap) => ({
        id: docSnap.id,
        ...docSnap.data()
      }));

      teams = sortTeams(teams);
      renderTeams();
    },
    (error) => {
      console.error(error);
      showTeamMessage(
        `チーム一覧の取得に失敗しました：${error.code || ""} ${error.message}`,
        true
      );
    }
  );
}

function stopTeamsListener() {
  if (teamsUnsubscribe) {
    teamsUnsubscribe();
    teamsUnsubscribe = null;
  }

  teams = [];
  renderTeams();
}

function renderTeams() {
  if (!teamsTbody) return;

  teamsTbody.replaceChildren();

  const visibleCount = teams.filter((team) => team.hidden !== true).length;
  const hiddenCount = teams.filter((team) => team.hidden === true).length;

  teamCountEl.textContent =
    `表示中：${visibleCount}チーム / 非表示：${hiddenCount}チーム`;

  if (teams.length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");

    td.colSpan = 4;
    td.textContent = "チームがまだ登録されていません。";

    tr.appendChild(td);
    teamsTbody.appendChild(tr);
    return;
  }

  teams.forEach((team, index) => {
    const tr = document.createElement("tr");

    if (team.hidden === true) {
      tr.classList.add("is-hidden-row");
    }

    // 順番
    const orderTd = document.createElement("td");
    orderTd.textContent = team.order ?? index + 1;

    // チーム名編集
    const nameTd = document.createElement("td");

    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.value = team.name || "";
    nameInput.className = "team-name-edit";

    nameInput.addEventListener("keydown", async (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        await saveTeamName(team.id, nameInput.value);
      }
    });

    nameTd.appendChild(nameInput);

    // 状態
    const statusTd = document.createElement("td");

    const badge = document.createElement("span");
    badge.className =
      team.hidden === true ? "badge badge-muted" : "badge badge-active";
    badge.textContent = team.hidden === true ? "非表示" : "表示中";

    statusTd.appendChild(badge);

    // 操作
    const actionTd = document.createElement("td");
    actionTd.className = "actions";

    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.textContent = "保存";
    saveBtn.addEventListener("click", async () => {
      await saveTeamName(team.id, nameInput.value);
    });

    const upBtn = document.createElement("button");
    upBtn.type = "button";
    upBtn.textContent = "↑";
    upBtn.disabled = index === 0;
    upBtn.addEventListener("click", async () => {
      await moveTeam(team.id, -1);
    });

    const downBtn = document.createElement("button");
    downBtn.type = "button";
    downBtn.textContent = "↓";
    downBtn.disabled = index === teams.length - 1;
    downBtn.addEventListener("click", async () => {
      await moveTeam(team.id, 1);
    });

    const hiddenBtn = document.createElement("button");
    hiddenBtn.type = "button";

    if (team.hidden === true) {
      hiddenBtn.textContent = "復元";
      hiddenBtn.addEventListener("click", async () => {
        await setTeamHidden(team.id, false);
      });
    } else {
      hiddenBtn.textContent = "非表示";
      hiddenBtn.addEventListener("click", async () => {
        const ok = confirm(
          `「${team.name}」を非表示にしますか？\nデータは削除されません。`
        );

        if (ok) {
          await setTeamHidden(team.id, true);
        }
      });
    }

    actionTd.appendChild(saveBtn);
    actionTd.appendChild(upBtn);
    actionTd.appendChild(downBtn);
    actionTd.appendChild(hiddenBtn);

    tr.appendChild(orderTd);
    tr.appendChild(nameTd);
    tr.appendChild(statusTd);
    tr.appendChild(actionTd);

    teamsTbody.appendChild(tr);
  });
}

addTeamForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!isCurrentUserAdmin) {
    showTeamMessage("管理者のみチームを追加できます。", true);
    return;
  }

  const name = teamNameInput.value.trim();

  if (!name) {
    showTeamMessage("チーム名を入力してください。", true);
    return;
  }

  const nextOrder =
    teams.length === 0
      ? 1
      : Math.max(...teams.map((team) => Number(team.order) || 0)) + 1;

  try {
    addTeamBtn.disabled = true;

    await addDoc(collection(db, "teams"), {
      name,
      order: nextOrder,
      hidden: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    teamNameInput.value = "";
    showTeamMessage(`「${name}」を追加しました。`);
  } catch (error) {
    console.error(error);
    showTeamMessage(
      `チーム追加に失敗しました：${error.code || ""} ${error.message}`,
      true
    );
  } finally {
    addTeamBtn.disabled = false;
  }
});

async function saveTeamName(teamId, newName) {
  if (!isCurrentUserAdmin) {
    showTeamMessage("管理者のみ編集できます。", true);
    return;
  }

  const name = newName.trim();

  if (!name) {
    showTeamMessage("チーム名を空にはできません。", true);
    return;
  }

  try {
    await updateDoc(doc(db, "teams", teamId), {
      name,
      updatedAt: serverTimestamp()
    });

    showTeamMessage("チーム名を保存しました。");
  } catch (error) {
    console.error(error);
    showTeamMessage(
      `チーム名の保存に失敗しました：${error.code || ""} ${error.message}`,
      true
    );
  }
}

async function setTeamHidden(teamId, hidden) {
  if (!isCurrentUserAdmin) {
    showTeamMessage("管理者のみ編集できます。", true);
    return;
  }

  try {
    await updateDoc(doc(db, "teams", teamId), {
      hidden,
      updatedAt: serverTimestamp()
    });

    showTeamMessage(hidden ? "チームを非表示にしました。" : "チームを復元しました。");
  } catch (error) {
    console.error(error);
    showTeamMessage(
      `状態変更に失敗しました：${error.code || ""} ${error.message}`,
      true
    );
  }
}

async function moveTeam(teamId, direction) {
  if (!isCurrentUserAdmin) {
    showTeamMessage("管理者のみ編集できます。", true);
    return;
  }

  const currentIndex = teams.findIndex((team) => team.id === teamId);
  const targetIndex = currentIndex + direction;

  if (currentIndex < 0 || targetIndex < 0 || targetIndex >= teams.length) {
    return;
  }

  const currentTeam = teams[currentIndex];
  const targetTeam = teams[targetIndex];

  const currentOrder = Number(currentTeam.order) || currentIndex + 1;
  const targetOrder = Number(targetTeam.order) || targetIndex + 1;

  try {
    const batch = writeBatch(db);

    batch.update(doc(db, "teams", currentTeam.id), {
      order: targetOrder,
      updatedAt: serverTimestamp()
    });

    batch.update(doc(db, "teams", targetTeam.id), {
      order: currentOrder,
      updatedAt: serverTimestamp()
    });

    await batch.commit();

    showTeamMessage("表示順を変更しました。");
  } catch (error) {
    console.error(error);
    showTeamMessage(
      `表示順の変更に失敗しました：${error.code || ""} ${error.message}`,
      true
    );
  }
}
