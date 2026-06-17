import { auth, db, googleProvider } from "./firebase.js?v=50";

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

// ===== 表示名 =====

const STAGE_TYPE_LABELS = {
  league: "リーグ戦",
  tournament: "トーナメント",
  ranking: "順位入力型"
};

const VISIBILITY_LABELS = {
  public: "公開",
  private: "非公開"
};

// ===== ログイン関連 =====

const loginBtn = document.getElementById("login-btn");
const logoutBtn = document.getElementById("logout-btn");
const statusEl = document.getElementById("login-status");
const uidEl = document.getElementById("uid");
const adminArea = document.getElementById("admin-area");

// ===== メニュー関連 =====

const menuButtons = document.querySelectorAll(".menu-button[data-view]");
const adminViews = document.querySelectorAll(".admin-view");

// ===== チーム管理関連 =====

const addTeamForm = document.getElementById("add-team-form");
const teamNameInput = document.getElementById("team-name-input");
const addTeamBtn = document.getElementById("add-team-btn");
const teamMessageEl = document.getElementById("team-message");
const teamCountEl = document.getElementById("team-count");
const teamsTbody = document.getElementById("teams-tbody");

// ===== 表の作成関連 =====

const createStageForm = document.getElementById("create-stage-form");
const stageSportSelect = document.getElementById("stage-sport-select");
const stageTypeSelect = document.getElementById("stage-type-select");
const stageNameInput = document.getElementById("stage-name-input");
const stageVisibilitySelect = document.getElementById("stage-visibility-select");
const stageTeamSelection = document.getElementById("stage-team-selection");
const stageRuleHelp = document.getElementById("stage-rule-help");
const stageMessageEl = document.getElementById("stage-message");
const createStageBtn = document.getElementById("create-stage-btn");
const selectAllTeamsBtn = document.getElementById("select-all-teams-btn");
const clearStageTeamsBtn = document.getElementById("clear-stage-teams-btn");
const stagesTbody = document.getElementById("stages-tbody");

// ===== 状態 =====

let teams = [];
let sports = [];
let stages = [];

let teamsUnsubscribe = null;
let sportsUnsubscribe = null;
let stagesUnsubscribe = null;

let isCurrentUserAdmin = false;

// ===== 共通関数 =====

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

function showStageMessage(message, isError = false) {
  stageMessageEl.textContent = message;
  stageMessageEl.className = isError ? "message error" : "message success";

  if (!isError) {
    setTimeout(() => {
      if (stageMessageEl.textContent === message) {
        stageMessageEl.textContent = "";
        stageMessageEl.className = "message";
      }
    }, 3000);
  }
}

function orderValue(item) {
  const n = Number(item.order);
  return Number.isFinite(n) ? n : 999999;
}

function sortByOrderAndName(list) {
  return [...list].sort((a, b) => {
    const orderDiff = orderValue(a) - orderValue(b);
    if (orderDiff !== 0) return orderDiff;

    const nameA = String(a.name || "");
    const nameB = String(b.name || "");
    return nameA.localeCompare(nameB, "ja");
  });
}

function getSportName(sportId) {
  const sport = sports.find((item) => item.id === sportId);
  return sport?.name || sportId || "";
}

function getSelectedStageTeamIds() {
  return Array.from(
    stageTeamSelection.querySelectorAll('input[name="stage-team"]:checked')
  ).map((input) => input.value);
}

function nextPowerOfTwoForTournament(teamCount) {
  if (teamCount <= 2) return 2;
  if (teamCount <= 4) return 4;
  if (teamCount <= 8) return 8;
  return 16;
}

// ===== メニュー切り替え =====

menuButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const viewName = button.dataset.view;
    showAdminView(viewName);
  });
});

function showAdminView(viewName) {
  menuButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.view === viewName);
  });

  adminViews.forEach((view) => {
    view.hidden = view.id !== `view-${viewName}`;
  });
}

// ===== ログイン処理 =====

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
  stopSportsListener();
  stopStagesListener();

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
      startSportsListener();
      startStagesListener();
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

      teams = sortByOrderAndName(teams);
      renderTeams();
      renderStageTeamSelection();
      updateStageRuleHelp();
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
  renderStageTeamSelection();
}

function renderTeams() {
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

    const orderTd = document.createElement("td");
    orderTd.textContent = team.order ?? index + 1;

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

    const statusTd = document.createElement("td");

    const badge = document.createElement("span");
    badge.className =
      team.hidden === true ? "badge badge-muted" : "badge badge-active";
    badge.textContent = team.hidden === true ? "非表示" : "表示中";

    statusTd.appendChild(badge);

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

// ===== 競技データ =====

function startSportsListener() {
  if (sportsUnsubscribe) return;

  sportsUnsubscribe = onSnapshot(
    collection(db, "sports"),
    (snapshot) => {
      sports = snapshot.docs
        .map((docSnap) => ({
          id: docSnap.id,
          ...docSnap.data()
        }))
        .filter((sport) => sport.enabled !== false);

      sports = sortByOrderAndName(sports);

      renderSportsSelect();
      renderStages();
    },
    (error) => {
      console.error(error);
      showStageMessage(
        `競技データの取得に失敗しました：${error.code || ""} ${error.message}`,
        true
      );
    }
  );
}

function stopSportsListener() {
  if (sportsUnsubscribe) {
    sportsUnsubscribe();
    sportsUnsubscribe = null;
  }

  sports = [];
  renderSportsSelect();
  renderStages();
}

function renderSportsSelect() {
  const currentValue = stageSportSelect.value;

  stageSportSelect.replaceChildren();

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "競技を選択";
  stageSportSelect.appendChild(placeholder);

  sports.forEach((sport) => {
    const option = document.createElement("option");
    option.value = sport.id;
    option.textContent = sport.name || sport.id;
    stageSportSelect.appendChild(option);
  });

  if (sports.some((sport) => sport.id === currentValue)) {
    stageSportSelect.value = currentValue;
  }
}

// ===== 作成済み表データ =====

function startStagesListener() {
  if (stagesUnsubscribe) return;

  stagesUnsubscribe = onSnapshot(
    collection(db, "stages"),
    (snapshot) => {
      stages = snapshot.docs.map((docSnap) => ({
        id: docSnap.id,
        ...docSnap.data()
      }));

      stages = sortByOrderAndName(stages);
      renderStages();
    },
    (error) => {
      console.error(error);
      showStageMessage(
        `表一覧の取得に失敗しました：${error.code || ""} ${error.message}`,
        true
      );
    }
  );
}

function stopStagesListener() {
  if (stagesUnsubscribe) {
    stagesUnsubscribe();
    stagesUnsubscribe = null;
  }

  stages = [];
  renderStages();
}

function renderStages() {
  stagesTbody.replaceChildren();

  if (stages.length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");

    td.colSpan = 7;
    td.textContent = "作成済みの表はまだありません。";

    tr.appendChild(td);
    stagesTbody.appendChild(tr);
    return;
  }

  stages.forEach((stage, index) => {
    const tr = document.createElement("tr");

    if (stage.hidden === true) {
      tr.classList.add("is-hidden-row");
    }

    const orderTd = document.createElement("td");
    orderTd.textContent = stage.order ?? index + 1;

    const nameTd = document.createElement("td");
    nameTd.textContent = stage.name || "";

    const sportTd = document.createElement("td");
    sportTd.textContent = getSportName(stage.sportId);

    const typeTd = document.createElement("td");
    typeTd.textContent = STAGE_TYPE_LABELS[stage.type] || stage.type || "";

    const teamCountTd = document.createElement("td");
    teamCountTd.textContent = Array.isArray(stage.teamIds)
      ? `${stage.teamIds.length}チーム`
      : "0チーム";

    const visibilityTd = document.createElement("td");

    const visibilityBadge = document.createElement("span");
    visibilityBadge.className =
      stage.visibility === "public" ? "badge badge-active" : "badge badge-muted";
    visibilityBadge.textContent =
      VISIBILITY_LABELS[stage.visibility] || stage.visibility || "非公開";

    visibilityTd.appendChild(visibilityBadge);

    const hiddenTd = document.createElement("td");

    const hiddenBadge = document.createElement("span");
    hiddenBadge.className =
      stage.hidden === true ? "badge badge-muted" : "badge badge-active";
    hiddenBadge.textContent = stage.hidden === true ? "非表示" : "有効";

    hiddenTd.appendChild(hiddenBadge);

    tr.appendChild(orderTd);
    tr.appendChild(nameTd);
    tr.appendChild(sportTd);
    tr.appendChild(typeTd);
    tr.appendChild(teamCountTd);
    tr.appendChild(visibilityTd);
    tr.appendChild(hiddenTd);

    stagesTbody.appendChild(tr);
  });
}

// ===== 表の作成 =====

function renderStageTeamSelection() {
  const checkedTeamIds = new Set(getSelectedStageTeamIds());

  stageTeamSelection.replaceChildren();

  const visibleTeams = teams.filter((team) => team.hidden !== true);

  if (visibleTeams.length === 0) {
    stageTeamSelection.textContent =
      "表示中のチームがありません。先にチーム管理でチームを追加してください。";
    return;
  }

  visibleTeams.forEach((team) => {
    const label = document.createElement("label");
    label.className = "checkbox-item";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.name = "stage-team";
    checkbox.value = team.id;
    checkbox.checked = checkedTeamIds.has(team.id);

    checkbox.addEventListener("change", updateStageRuleHelp);

    const text = document.createElement("span");
    text.textContent = team.name || "(名称未設定)";

    label.appendChild(checkbox);
    label.appendChild(text);

    stageTeamSelection.appendChild(label);
  });
}

function updateStageRuleHelp() {
  const type = stageTypeSelect.value;
  const selectedCount = getSelectedStageTeamIds().length;

  let ruleText = "";

  if (type === "league") {
    ruleText =
      "リーグ戦は3〜8チーム対応です。作成時に総当たりの試合カードを自動作成します。";
  } else if (type === "tournament") {
    ruleText =
      "トーナメントは2〜16チーム対応です。組み合わせは後でトーナメント編集画面で調整します。";
  } else if (type === "ranking") {
    ruleText =
      "順位入力型は複数チームで一斉対戦し、順位だけを入力する形式です。同順位・棄権・失格に対応予定です。";
  }

  stageRuleHelp.textContent =
    `${ruleText} 現在 ${selectedCount} チーム選択中です。`;
}

stageTypeSelect.addEventListener("change", updateStageRuleHelp);

selectAllTeamsBtn.addEventListener("click", () => {
  stageTeamSelection
    .querySelectorAll('input[name="stage-team"]')
    .forEach((checkbox) => {
      checkbox.checked = true;
    });

  updateStageRuleHelp();
});

clearStageTeamsBtn.addEventListener("click", () => {
  stageTeamSelection
    .querySelectorAll('input[name="stage-team"]')
    .forEach((checkbox) => {
      checkbox.checked = false;
    });

  updateStageRuleHelp();
});

createStageForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!isCurrentUserAdmin) {
    showStageMessage("管理者のみ表を作成できます。", true);
    return;
  }

  const validation = validateStageForm();

  if (!validation.ok) {
    showStageMessage(validation.message, true);
    return;
  }

  const {
    sportId,
    type,
    name,
    visibility,
    selectedTeamIds
  } = validation;

  const nextOrder =
    stages.length === 0
      ? 1
      : Math.max(...stages.map((stage) => Number(stage.order) || 0)) + 1;

  const stageRef = doc(collection(db, "stages"));
  const batch = writeBatch(db);

  const baseStageData = {
    name,
    sportId,
    type,
    teamIds: selectedTeamIds,
    visibility,
    hidden: false,
    order: nextOrder,
    createdBy: auth.currentUser?.uid || null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };

  if (type === "league") {
    baseStageData.settings = {
      winPoint: 3,
      drawPoint: 1,
      losePoint: 0,
      rankingRules: [
        "points",
        "goalDifference",
        "goalsFor",
        "headToHead",
        "manual"
      ],
      scoreMode: "rawScore"
    };
  }

  if (type === "tournament") {
    const bracketSize = nextPowerOfTwoForTournament(selectedTeamIds.length);
    const seedSlots = Array.from({ length: bracketSize }, (_, index) => {
      return selectedTeamIds[index] || null;
    });

    baseStageData.settings = {
      bracketSize,
      thirdPlace: selectedTeamIds.length >= 4,
      seedingMode: "manual",
      winnerSelection: "manual",
      seedSlots
    };
  }

  if (type === "ranking") {
    baseStageData.settings = {
      allowTies: true,
      rankStyle: "1,1,3",
      recordEnabled: false,
      specialStatuses: ["withdrawn", "disqualified"]
    };
  }

  batch.set(stageRef, baseStageData);

  if (type === "league") {
    const matches = generateLeagueMatches(selectedTeamIds);

    matches.forEach((match) => {
      const matchRef = doc(collection(stageRef, "matches"));

      batch.set(matchRef, {
        type: "league",
        matchNo: match.matchNo,
        order: match.matchNo,
        teamAId: match.teamAId,
        teamBId: match.teamBId,
        scoreA: null,
        scoreB: null,
        status: "not_started",
        winnerId: null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
    });
  }

  if (type === "ranking") {
    selectedTeamIds.forEach((teamId, index) => {
      const entryRef = doc(collection(stageRef, "rankingEntries"));

      batch.set(entryRef, {
        teamId,
        rank: null,
        status: "normal",
        order: index + 1,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
    });
  }

  try {
    createStageBtn.disabled = true;

    await batch.commit();

    createStageForm.reset();

    stageTeamSelection
      .querySelectorAll('input[name="stage-team"]')
      .forEach((checkbox) => {
        checkbox.checked = false;
      });

    updateStageRuleHelp();

    showStageMessage(`「${name}」を作成しました。`);
  } catch (error) {
    console.error(error);
    showStageMessage(
      `表の作成に失敗しました：${error.code || ""} ${error.message}`,
      true
    );
  } finally {
    createStageBtn.disabled = false;
  }
});

function validateStageForm() {
  const sportId = stageSportSelect.value;
  const type = stageTypeSelect.value;
  const name = stageNameInput.value.trim();
  const visibility = stageVisibilitySelect.value;
  const selectedTeamIds = getSelectedStageTeamIds();

  if (!sportId) {
    return {
      ok: false,
      message: "競技を選択してください。"
    };
  }

  if (!type) {
    return {
      ok: false,
      message: "表の種類を選択してください。"
    };
  }

  if (!name) {
    return {
      ok: false,
      message: "表の名前を入力してください。"
    };
  }

  if (type === "league") {
    if (selectedTeamIds.length < 3 || selectedTeamIds.length > 8) {
      return {
        ok: false,
        message: "リーグ戦は3〜8チームを選択してください。"
      };
    }
  }

  if (type === "tournament") {
    if (selectedTeamIds.length < 2 || selectedTeamIds.length > 16) {
      return {
        ok: false,
        message: "トーナメントは2〜16チームを選択してください。"
      };
    }
  }

  if (type === "ranking") {
    if (selectedTeamIds.length < 2) {
      return {
        ok: false,
        message: "順位入力型は2チーム以上を選択してください。"
      };
    }
  }

  return {
    ok: true,
    sportId,
    type,
    name,
    visibility,
    selectedTeamIds
  };
}

function generateLeagueMatches(teamIds) {
  const matches = [];
  let matchNo = 1;

  for (let i = 0; i < teamIds.length; i++) {
    for (let j = i + 1; j < teamIds.length; j++) {
      matches.push({
        matchNo,
        teamAId: teamIds[i],
        teamBId: teamIds[j]
      });

      matchNo += 1;
    }
  }

  return matches;
}

// 初期表示
renderSportsSelect();
renderStageTeamSelection();
updateStageRuleHelp();
