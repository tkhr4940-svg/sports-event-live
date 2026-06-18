import { auth, db } from "./firebase.js?v=50";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";

import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  updateDoc,
  writeBatch,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";

const STAGE_TYPE_LABELS = {
  league: "リーグ戦",
  tournament: "トーナメント",
  ranking: "順位入力型"
};

const VISIBILITY_LABELS = {
  public: "公開",
  private: "非公開"
};

const publishSportFilter = document.getElementById("publish-sport-filter");
const publishTypeFilter = document.getElementById("publish-type-filter");
const publishStateFilter = document.getElementById("publish-state-filter");
const publishMessageEl = document.getElementById("publish-message");
const publishCountEl = document.getElementById("publish-count");
const publishStagesTbody = document.getElementById("publish-stages-tbody");

let isAdmin = false;

let sports = [];
let sportsMap = new Map();

let stages = [];

let sportsUnsubscribe = null;
let stagesUnsubscribe = null;

function showPublishMessage(message, isError = false) {
  if (!publishMessageEl) return;

  publishMessageEl.textContent = message;
  publishMessageEl.className = isError ? "message error" : "message success";

  if (!isError) {
    setTimeout(() => {
      if (publishMessageEl.textContent === message) {
        publishMessageEl.textContent = "";
        publishMessageEl.className = "message";
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
  return sportsMap.get(sportId)?.name || sportId || "";
}

function getVisibility(stage) {
  return stage.visibility === "public" ? "public" : "private";
}

function makeBadge(text, className) {
  const span = document.createElement("span");
  span.className = className;
  span.textContent = text;
  return span;
}

// ===== ログイン確認 =====

onAuthStateChanged(auth, async (user) => {
  stopPublishListeners();

  if (!user) {
    isAdmin = false;
    clearPublishScreen();
    return;
  }

  try {
    const adminSnap = await getDoc(doc(db, "admins", user.uid));

    if (adminSnap.exists() && adminSnap.data().active === true) {
      isAdmin = true;
      startPublishListeners();
    } else {
      isAdmin = false;
      clearPublishScreen();
    }
  } catch (error) {
    console.error(error);
    isAdmin = false;
    showPublishMessage(
      `公開管理の管理者確認に失敗しました：${error.code || ""} ${error.message}`,
      true
    );
  }
});

function startPublishListeners() {
  startSportsListener();
  startStagesListener();
}

function stopPublishListeners() {
  if (sportsUnsubscribe) {
    sportsUnsubscribe();
    sportsUnsubscribe = null;
  }

  if (stagesUnsubscribe) {
    stagesUnsubscribe();
    stagesUnsubscribe = null;
  }

  sports = [];
  sportsMap = new Map();
  stages = [];
}

function clearPublishScreen() {
  renderSportFilter();
  renderPublishStages();
}

// ===== データ取得 =====

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
      sportsMap = new Map(sports.map((sport) => [sport.id, sport]));

      renderSportFilter();
      renderPublishStages();
    },
    (error) => {
      console.error(error);
      showPublishMessage(
        `競技データの取得に失敗しました：${error.code || ""} ${error.message}`,
        true
      );
    }
  );
}

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

      renderPublishStages();
    },
    (error) => {
      console.error(error);
      showPublishMessage(
        `表データの取得に失敗しました：${error.code || ""} ${error.message}`,
        true
      );
    }
  );
}

// ===== フィルター =====

function renderSportFilter() {
  if (!publishSportFilter) return;

  const currentValue = publishSportFilter.value;

  publishSportFilter.replaceChildren();

  const allOption = document.createElement("option");
  allOption.value = "";
  allOption.textContent = "すべての競技";
  publishSportFilter.appendChild(allOption);

  sports.forEach((sport) => {
    const option = document.createElement("option");
    option.value = sport.id;
    option.textContent = sport.name || sport.id;
    publishSportFilter.appendChild(option);
  });

  if (sports.some((sport) => sport.id === currentValue)) {
    publishSportFilter.value = currentValue;
  }
}

[publishSportFilter, publishTypeFilter, publishStateFilter].forEach((select) => {
  if (!select) return;
  select.addEventListener("change", renderPublishStages);
});

function getFilteredStages() {
  const sportFilter = publishSportFilter?.value || "";
  const typeFilter = publishTypeFilter?.value || "";
  const stateFilter = publishStateFilter?.value || "";

  return stages.filter((stage) => {
    if (sportFilter && stage.sportId !== sportFilter) return false;
    if (typeFilter && stage.type !== typeFilter) return false;

    if (stateFilter === "public") {
      return stage.hidden !== true && getVisibility(stage) === "public";
    }

    if (stateFilter === "private") {
      return stage.hidden !== true && getVisibility(stage) !== "public";
    }

    if (stateFilter === "hidden") {
      return stage.hidden === true;
    }

    return true;
  });
}

// ===== 表示 =====

function renderPublishStages() {
  if (!publishStagesTbody) return;

  publishStagesTbody.replaceChildren();

  const filteredStages = getFilteredStages();

  const publicCount = stages.filter(
    (stage) => stage.hidden !== true && getVisibility(stage) === "public"
  ).length;

  const privateCount = stages.filter(
    (stage) => stage.hidden !== true && getVisibility(stage) !== "public"
  ).length;

  const hiddenCount = stages.filter((stage) => stage.hidden === true).length;

  if (publishCountEl) {
    publishCountEl.textContent =
      `表：${stages.length}件 / 公開：${publicCount}件 / 非公開：${privateCount}件 / 非表示：${hiddenCount}件`;
  }

  if (filteredStages.length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");

    td.colSpan = 8;
    td.textContent = "条件に一致する表がありません。";

    tr.appendChild(td);
    publishStagesTbody.appendChild(tr);
    return;
  }

  filteredStages.forEach((stage, index) => {
    const tr = document.createElement("tr");

    if (stage.hidden === true) {
      tr.classList.add("is-hidden-row");
    }

    const orderTd = document.createElement("td");
    orderTd.textContent = stage.order ?? index + 1;

    const nameTd = document.createElement("td");

    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.value = stage.name || "";
    nameInput.className = "stage-name-edit";

    nameInput.addEventListener("keydown", async (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        await saveStageName(stage.id, nameInput.value);
      }
    });

    nameTd.appendChild(nameInput);

    const sportTd = document.createElement("td");
    sportTd.textContent = getSportName(stage.sportId);

    const typeTd = document.createElement("td");
    typeTd.textContent = STAGE_TYPE_LABELS[stage.type] || stage.type || "";

    const teamCountTd = document.createElement("td");
    teamCountTd.textContent = Array.isArray(stage.teamIds)
      ? `${stage.teamIds.length}チーム`
      : "0チーム";

    const visibilityTd = document.createElement("td");

    const visibility = getVisibility(stage);
    const visibilityBadge = makeBadge(
      VISIBILITY_LABELS[visibility] || "非公開",
      visibility === "public" ? "badge badge-active" : "badge badge-muted"
    );

    visibilityTd.appendChild(visibilityBadge);

    const hiddenTd = document.createElement("td");

    const hiddenBadge = makeBadge(
      stage.hidden === true ? "非表示" : "有効",
      stage.hidden === true ? "badge badge-muted" : "badge badge-active"
    );

    hiddenTd.appendChild(hiddenBadge);

    const actionTd = document.createElement("td");
    actionTd.className = "actions";

    const saveNameBtn = document.createElement("button");
    saveNameBtn.type = "button";
    saveNameBtn.textContent = "名前保存";
    saveNameBtn.addEventListener("click", async () => {
      await saveStageName(stage.id, nameInput.value);
    });

    const publishBtn = document.createElement("button");
    publishBtn.type = "button";
    publishBtn.textContent = "公開";
    publishBtn.disabled =
      stage.hidden === true || getVisibility(stage) === "public";
    publishBtn.addEventListener("click", async () => {
      await setStageVisibility(stage.id, "public");
    });

    const privateBtn = document.createElement("button");
    privateBtn.type = "button";
    privateBtn.textContent = "非公開";
    privateBtn.disabled =
      stage.hidden === true || getVisibility(stage) !== "public";
    privateBtn.addEventListener("click", async () => {
      await setStageVisibility(stage.id, "private");
    });

    const upBtn = document.createElement("button");
    upBtn.type = "button";
    upBtn.textContent = "↑";
    upBtn.disabled = index === 0;
    upBtn.addEventListener("click", async () => {
      await moveStage(stage.id, -1);
    });

    const downBtn = document.createElement("button");
    downBtn.type = "button";
    downBtn.textContent = "↓";
    downBtn.disabled = index === filteredStages.length - 1;
    downBtn.addEventListener("click", async () => {
      await moveStage(stage.id, 1);
    });

    const hiddenBtn = document.createElement("button");
    hiddenBtn.type = "button";

    if (stage.hidden === true) {
      hiddenBtn.textContent = "復元";
      hiddenBtn.addEventListener("click", async () => {
        await restoreStage(stage.id);
      });
    } else {
      hiddenBtn.textContent = "非表示";
      hiddenBtn.className = "danger-button";
      hiddenBtn.addEventListener("click", async () => {
        const ok = confirm(
          `「${stage.name}」を非表示にしますか？\n閲覧者ページには表示されません。\nデータは削除されません。`
        );

        if (ok) {
          await hideStage(stage.id);
        }
      });
    }

    actionTd.appendChild(saveNameBtn);
    actionTd.appendChild(publishBtn);
    actionTd.appendChild(privateBtn);
    actionTd.appendChild(upBtn);
    actionTd.appendChild(downBtn);
    actionTd.appendChild(hiddenBtn);

    tr.appendChild(orderTd);
    tr.appendChild(nameTd);
    tr.appendChild(sportTd);
    tr.appendChild(typeTd);
    tr.appendChild(teamCountTd);
    tr.appendChild(visibilityTd);
    tr.appendChild(hiddenTd);
    tr.appendChild(actionTd);

    publishStagesTbody.appendChild(tr);
  });
}

// ===== 操作 =====

async function saveStageName(stageId, newName) {
  if (!isAdmin) {
    showPublishMessage("管理者のみ編集できます。", true);
    return;
  }

  const name = newName.trim();

  if (!name) {
    showPublishMessage("表の名前を空にはできません。", true);
    return;
  }

  try {
    await updateDoc(doc(db, "stages", stageId), {
      name,
      updatedAt: serverTimestamp()
    });

    showPublishMessage("表の名前を保存しました。");
  } catch (error) {
    console.error(error);
    showPublishMessage(
      `表の名前の保存に失敗しました：${error.code || ""} ${error.message}`,
      true
    );
  }
}

async function setStageVisibility(stageId, visibility) {
  if (!isAdmin) {
    showPublishMessage("管理者のみ編集できます。", true);
    return;
  }

  try {
    await updateDoc(doc(db, "stages", stageId), {
      visibility,
      hidden: false,
      updatedAt: serverTimestamp()
    });

    showPublishMessage(
      visibility === "public" ? "公開にしました。" : "非公開にしました。"
    );
  } catch (error) {
    console.error(error);
    showPublishMessage(
      `公開状態の変更に失敗しました：${error.code || ""} ${error.message}`,
      true
    );
  }
}

async function hideStage(stageId) {
  if (!isAdmin) {
    showPublishMessage("管理者のみ編集できます。", true);
    return;
  }

  try {
    await updateDoc(doc(db, "stages", stageId), {
      hidden: true,
      visibility: "private",
      updatedAt: serverTimestamp()
    });

    showPublishMessage("表を非表示にしました。");
  } catch (error) {
    console.error(error);
    showPublishMessage(
      `非表示への変更に失敗しました：${error.code || ""} ${error.message}`,
      true
    );
  }
}

async function restoreStage(stageId) {
  if (!isAdmin) {
    showPublishMessage("管理者のみ編集できます。", true);
    return;
  }

  try {
    await updateDoc(doc(db, "stages", stageId), {
      hidden: false,
      visibility: "private",
      updatedAt: serverTimestamp()
    });

    showPublishMessage("表を復元しました。復元後は非公開状態です。");
  } catch (error) {
    console.error(error);
    showPublishMessage(
      `復元に失敗しました：${error.code || ""} ${error.message}`,
      true
    );
  }
}

async function moveStage(stageId, direction) {
  if (!isAdmin) {
    showPublishMessage("管理者のみ編集できます。", true);
    return;
  }

  const filteredStages = getFilteredStages();

  const currentIndex = filteredStages.findIndex((stage) => stage.id === stageId);
  const targetIndex = currentIndex + direction;

  if (
    currentIndex < 0 ||
    targetIndex < 0 ||
    targetIndex >= filteredStages.length
  ) {
    return;
  }

  const currentStage = filteredStages[currentIndex];
  const targetStage = filteredStages[targetIndex];

  const currentOrder = Number(currentStage.order) || currentIndex + 1;
  const targetOrder = Number(targetStage.order) || targetIndex + 1;

  try {
    const batch = writeBatch(db);

    batch.update(doc(db, "stages", currentStage.id), {
      order: targetOrder,
      updatedAt: serverTimestamp()
    });

    batch.update(doc(db, "stages", targetStage.id), {
      order: currentOrder,
      updatedAt: serverTimestamp()
    });

    await batch.commit();

    showPublishMessage("表示順を変更しました。");
  } catch (error) {
    console.error(error);
    showPublishMessage(
      `表示順の変更に失敗しました：${error.code || ""} ${error.message}`,
      true
    );
  }
}

// 初期表示
clearPublishScreen();
