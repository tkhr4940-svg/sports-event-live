import { auth, db } from "./firebase.js?v=50";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";

import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  writeBatch,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";

const STATUS_LABELS = {
  normal: "通常",
  withdrawn: "棄権",
  disqualified: "失格"
};

const STATUS_ORDER = {
  normal: 1,
  withdrawn: 2,
  disqualified: 3
};

const rankingStageSelect = document.getElementById("ranking-stage-select");
const rankingInfoEl = document.getElementById("ranking-info");
const rankingMessageEl = document.getElementById("ranking-message");
const rankingEntriesTbody = document.getElementById("ranking-entries-tbody");
const rankingPreviewTbody = document.getElementById("ranking-preview-tbody");
const saveAllBtn = document.getElementById("ranking-save-all-btn");

let isAdmin = false;

let teams = [];
let teamsMap = new Map();

let sports = [];
let sportsMap = new Map();

let rankingStages = [];
let selectedStageId = "";
let selectedStage = null;

let rankingEntries = [];

let teamsUnsubscribe = null;
let sportsUnsubscribe = null;
let stagesUnsubscribe = null;
let entriesUnsubscribe = null;
let currentEntriesStageId = "";

function showRankingMessage(message, isError = false) {
  if (!rankingMessageEl) return;

  rankingMessageEl.textContent = message;
  rankingMessageEl.className = isError ? "message error" : "message success";

  if (!isError) {
    setTimeout(() => {
      if (rankingMessageEl.textContent === message) {
        rankingMessageEl.textContent = "";
        rankingMessageEl.className = "message";
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

function getTeamName(teamId) {
  return teamsMap.get(teamId)?.name || "不明なチーム";
}

function getTeamOrder(teamId) {
  const order = Number(teamsMap.get(teamId)?.order);
  return Number.isFinite(order) ? order : 999999;
}

function getSportName(sportId) {
  return sportsMap.get(sportId)?.name || sportId || "";
}

function parseRankInput(value) {
  const text = String(value).trim();

  if (text === "") {
    return {
      ok: true,
      value: null
    };
  }

  const n = Number(text);

  if (!Number.isInteger(n) || n < 1) {
    return {
      ok: false,
      value: null
    };
  }

  return {
    ok: true,
    value: n
  };
}

// ===== ログイン確認 =====

onAuthStateChanged(auth, async (user) => {
  stopAllRankingListeners();

  if (!user) {
    isAdmin = false;
    clearRankingScreen();
    return;
  }

  try {
    const adminSnap = await getDoc(doc(db, "admins", user.uid));

    if (adminSnap.exists() && adminSnap.data().active === true) {
      isAdmin = true;
      startRankingListeners();
    } else {
      isAdmin = false;
      clearRankingScreen();
    }
  } catch (error) {
    console.error(error);
    isAdmin = false;
    showRankingMessage(
      `順位入力型編集の管理者確認に失敗しました：${error.code || ""} ${error.message}`,
      true
    );
  }
});

function startRankingListeners() {
  startTeamsListener();
  startSportsListener();
  startStagesListener();
}

function stopAllRankingListeners() {
  if (teamsUnsubscribe) {
    teamsUnsubscribe();
    teamsUnsubscribe = null;
  }

  if (sportsUnsubscribe) {
    sportsUnsubscribe();
    sportsUnsubscribe = null;
  }

  if (stagesUnsubscribe) {
    stagesUnsubscribe();
    stagesUnsubscribe = null;
  }

  stopEntriesListener();

  teams = [];
  teamsMap = new Map();

  sports = [];
  sportsMap = new Map();

  rankingStages = [];
  selectedStageId = "";
  selectedStage = null;

  rankingEntries = [];
}

function clearRankingScreen() {
  renderRankingStageSelect();
  renderRankingInfo();
  renderRankingEntries();
  renderRankingPreviewFromForm();
}

// ===== データ取得 =====

function startTeamsListener() {
  if (teamsUnsubscribe) return;

  teamsUnsubscribe = onSnapshot(
    collection(db, "teams"),
    (snapshot) => {
      teams = snapshot.docs.map((docSnap) => ({
        id: docSnap.id,
        ...docSnap.data()
      }));

      teams = sortByOrderAndName(teams);
      teamsMap = new Map(teams.map((team) => [team.id, team]));

      renderRankingInfo();
      renderRankingEntries();
      renderRankingPreviewFromForm();
    },
    (error) => {
      console.error(error);
      showRankingMessage(
        `チーム取得に失敗しました：${error.code || ""} ${error.message}`,
        true
      );
    }
  );
}

function startSportsListener() {
  if (sportsUnsubscribe) return;

  sportsUnsubscribe = onSnapshot(
    collection(db, "sports"),
    (snapshot) => {
      sports = snapshot.docs.map((docSnap) => ({
        id: docSnap.id,
        ...docSnap.data()
      }));

      sports = sortByOrderAndName(sports);
      sportsMap = new Map(sports.map((sport) => [sport.id, sport]));

      renderRankingInfo();
      renderRankingStageSelect();
    },
    (error) => {
      console.error(error);
      showRankingMessage(
        `競技取得に失敗しました：${error.code || ""} ${error.message}`,
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
      rankingStages = snapshot.docs
        .map((docSnap) => ({
          id: docSnap.id,
          ...docSnap.data()
        }))
        .filter((stage) => stage.type === "ranking" && stage.hidden !== true);

      rankingStages = sortByOrderAndName(rankingStages);

      renderRankingStageSelect();
    },
    (error) => {
      console.error(error);
      showRankingMessage(
        `順位入力型の表の取得に失敗しました：${error.code || ""} ${error.message}`,
        true
      );
    }
  );
}

// ===== 表選択 =====

if (rankingStageSelect) {
  rankingStageSelect.addEventListener("change", () => {
    selectRankingStage(rankingStageSelect.value);
  });
}

function renderRankingStageSelect() {
  if (!rankingStageSelect) return;

  const previousSelectedId = selectedStageId || rankingStageSelect.value;

  rankingStageSelect.replaceChildren();

  if (rankingStages.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "作成済みの順位入力型の表がありません";
    rankingStageSelect.appendChild(option);

    selectedStageId = "";
    selectedStage = null;

    stopEntriesListener();
    renderRankingInfo();
    renderRankingEntries();
    renderRankingPreviewFromForm();

    return;
  }

  rankingStages.forEach((stage) => {
    const option = document.createElement("option");
    option.value = stage.id;

    const visibilityText = stage.visibility === "public" ? "公開" : "非公開";

    option.textContent =
      `${stage.name || "名称未設定"}（${getSportName(stage.sportId)} / ${visibilityText}）`;

    rankingStageSelect.appendChild(option);
  });

  const stillExists = rankingStages.some(
    (stage) => stage.id === previousSelectedId
  );

  selectedStageId = stillExists ? previousSelectedId : rankingStages[0].id;

  rankingStageSelect.value = selectedStageId;
  selectRankingStage(selectedStageId);
}

function selectRankingStage(stageId) {
  selectedStageId = stageId || "";

  selectedStage =
    rankingStages.find((stage) => stage.id === selectedStageId) || null;

  renderRankingInfo();

  if (!selectedStageId) {
    stopEntriesListener();
    renderRankingEntries();
    renderRankingPreviewFromForm();
    return;
  }

  startEntriesListener(selectedStageId);
}

function renderRankingInfo() {
  if (!rankingInfoEl) return;

  rankingInfoEl.replaceChildren();

  if (!selectedStage) {
    rankingInfoEl.textContent = "順位入力型の表を選択してください。";
    return;
  }

  const teamCount = Array.isArray(selectedStage.teamIds)
    ? selectedStage.teamIds.length
    : 0;

  const visibilityText =
    selectedStage.visibility === "public" ? "公開" : "非公開";

  const lines = [
    `表名：${selectedStage.name || ""}`,
    `競技：${getSportName(selectedStage.sportId)}`,
    `参加チーム数：${teamCount}`,
    `公開状態：${visibilityText}`,
    "同順位：許可",
    "表示形式：1位、1位、3位",
    "棄権・失格：通常順位の下に表示"
  ];

  lines.forEach((line) => {
    const p = document.createElement("p");
    p.textContent = line;
    rankingInfoEl.appendChild(p);
  });
}

// ===== 順位入力データ =====

function startEntriesListener(stageId) {
  if (entriesUnsubscribe && currentEntriesStageId === stageId) {
    renderRankingEntries();
    renderRankingPreviewFromForm();
    return;
  }

  stopEntriesListener();

  currentEntriesStageId = stageId;

  entriesUnsubscribe = onSnapshot(
    collection(db, "stages", stageId, "rankingEntries"),
    (snapshot) => {
      rankingEntries = snapshot.docs.map((docSnap) => ({
        id: docSnap.id,
        ...docSnap.data()
      }));

      rankingEntries.sort((a, b) => {
        const orderDiff = orderValue(a) - orderValue(b);
        if (orderDiff !== 0) return orderDiff;

        return getTeamOrder(a.teamId) - getTeamOrder(b.teamId);
      });

      renderRankingEntries();
      renderRankingPreviewFromForm();
    },
    (error) => {
      console.error(error);
      showRankingMessage(
        `順位入力データの取得に失敗しました：${error.code || ""} ${error.message}`,
        true
      );
    }
  );
}

function stopEntriesListener() {
  if (entriesUnsubscribe) {
    entriesUnsubscribe();
    entriesUnsubscribe = null;
  }

  currentEntriesStageId = "";
  rankingEntries = [];
}

function getEditableEntries() {
  if (!selectedStage) return [];

  const teamIds = Array.isArray(selectedStage.teamIds)
    ? selectedStage.teamIds
    : [];

  const entryByTeamId = new Map();

  rankingEntries.forEach((entry) => {
    if (entry.teamId) {
      entryByTeamId.set(entry.teamId, entry);
    }
  });

  return teamIds.map((teamId, index) => {
    const existing = entryByTeamId.get(teamId);

    return {
      id: existing?.id || "",
      exists: Boolean(existing),
      teamId,
      order: existing?.order || index + 1,
      rank: existing?.rank ?? null,
      status: existing?.status || "normal"
    };
  });
}

function renderRankingEntries() {
  if (!rankingEntriesTbody) return;

  rankingEntriesTbody.replaceChildren();

  if (!selectedStage) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");

    td.colSpan = 4;
    td.textContent = "順位入力型の表を選択してください。";

    tr.appendChild(td);
    rankingEntriesTbody.appendChild(tr);
    return;
  }

  const entries = getEditableEntries();

  if (entries.length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");

    td.colSpan = 4;
    td.textContent = "参加チームがありません。";

    tr.appendChild(td);
    rankingEntriesTbody.appendChild(tr);
    return;
  }

  entries.forEach((entry) => {
    const tr = document.createElement("tr");
    tr.dataset.teamId = entry.teamId;
    tr.dataset.entryId = entry.id || "";
    tr.dataset.order = String(entry.order || 999999);

    const teamTd = document.createElement("td");
    teamTd.textContent = getTeamName(entry.teamId);

    const rankTd = document.createElement("td");

    const rankInput = document.createElement("input");
    rankInput.type = "number";
    rankInput.min = "1";
    rankInput.className = "rank-input";
    rankInput.dataset.rankingRank = "input";
    rankInput.value = entry.rank ?? "";

    const statusTd = document.createElement("td");

    const statusSelect = document.createElement("select");
    statusSelect.className = "small-select";
    statusSelect.dataset.rankingStatus = "input";

    Object.entries(STATUS_LABELS).forEach(([value, label]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      statusSelect.appendChild(option);
    });

    statusSelect.value = entry.status || "normal";

    if (statusSelect.value !== "normal") {
      rankInput.disabled = true;
      rankInput.value = "";
    }

    rankInput.addEventListener("input", renderRankingPreviewFromForm);

    statusSelect.addEventListener("change", () => {
      if (statusSelect.value !== "normal") {
        rankInput.value = "";
        rankInput.disabled = true;
      } else {
        rankInput.disabled = false;
      }

      renderRankingPreviewFromForm();
    });

    rankTd.appendChild(rankInput);
    statusTd.appendChild(statusSelect);

    const previewTd = document.createElement("td");
    previewTd.dataset.rankingPreviewTeamId = entry.teamId;
    previewTd.textContent = "";

    tr.appendChild(teamTd);
    tr.appendChild(rankTd);
    tr.appendChild(statusTd);
    tr.appendChild(previewTd);

    rankingEntriesTbody.appendChild(tr);
  });
}

// ===== プレビュー計算 =====

function readRowsFromForm() {
  if (!rankingEntriesTbody) return [];

  const rows = Array.from(
    rankingEntriesTbody.querySelectorAll("tr[data-team-id]")
  );

  return rows.map((row) => {
    const teamId = row.dataset.teamId;
    const entryId = row.dataset.entryId || "";
    const order = Number(row.dataset.order) || 999999;

    const rankInput = row.querySelector('[data-ranking-rank="input"]');
    const statusSelect = row.querySelector('[data-ranking-status="input"]');

    const status = statusSelect?.value || "normal";
    const rankResult = parseRankInput(rankInput?.value || "");

    return {
      teamId,
      entryId,
      order,
      status,
      rank: status === "normal" ? rankResult.value : null,
      rankInvalid: status === "normal" ? !rankResult.ok : false
    };
  });
}

function buildPreviewRows(formRows) {
  const invalidRows = formRows.filter((row) => row.rankInvalid);

  if (invalidRows.length > 0) {
    return {
      ok: false,
      rows: []
    };
  }

  const normalRanked = formRows
    .filter((row) => row.status === "normal" && row.rank !== null)
    .sort((a, b) => {
      if (a.rank !== b.rank) return a.rank - b.rank;
      return a.order - b.order;
    });

  const normalUnranked = formRows
    .filter((row) => row.status === "normal" && row.rank === null)
    .sort((a, b) => a.order - b.order);

  const withdrawn = formRows
    .filter((row) => row.status === "withdrawn")
    .sort((a, b) => a.order - b.order);

  const disqualified = formRows
    .filter((row) => row.status === "disqualified")
    .sort((a, b) => a.order - b.order);

  const previewRows = [];

  let previousInputRank = null;
  let currentDisplayRank = 0;

  normalRanked.forEach((row, index) => {
    if (row.rank === previousInputRank) {
      // 同順位
    } else {
      currentDisplayRank = index + 1;
      previousInputRank = row.rank;
    }

    previewRows.push({
      ...row,
      displayText: `${currentDisplayRank}位`,
      statusText: "通常",
      sortStatus: STATUS_ORDER.normal
    });
  });

  normalUnranked.forEach((row) => {
    previewRows.push({
      ...row,
      displayText: "未入力",
      statusText: "通常",
      sortStatus: STATUS_ORDER.normal
    });
  });

  withdrawn.forEach((row) => {
    previewRows.push({
      ...row,
      displayText: "棄権",
      statusText: "棄権",
      sortStatus: STATUS_ORDER.withdrawn
    });
  });

  disqualified.forEach((row) => {
    previewRows.push({
      ...row,
      displayText: "失格",
      statusText: "失格",
      sortStatus: STATUS_ORDER.disqualified
    });
  });

  return {
    ok: true,
    rows: previewRows
  };
}

function renderRankingPreviewFromForm() {
  if (!rankingPreviewTbody) return;

  rankingPreviewTbody.replaceChildren();

  const formRows = readRowsFromForm();

  document
    .querySelectorAll("[data-ranking-preview-team-id]")
    .forEach((cell) => {
      cell.textContent = "";
      cell.classList.remove("error");
    });

  if (!selectedStage) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");

    td.colSpan = 3;
    td.textContent = "順位入力型の表を選択してください。";

    tr.appendChild(td);
    rankingPreviewTbody.appendChild(tr);
    return;
  }

  if (formRows.length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");

    td.colSpan = 3;
    td.textContent = "参加チームがありません。";

    tr.appendChild(td);
    rankingPreviewTbody.appendChild(tr);
    return;
  }

  const invalidRows = formRows.filter((row) => row.rankInvalid);

  if (invalidRows.length > 0) {
    invalidRows.forEach((row) => {
      const cell = document.querySelector(
        `[data-ranking-preview-team-id="${row.teamId}"]`
      );

      if (cell) {
        cell.textContent = "入力エラー";
        cell.classList.add("error");
      }
    });

    const tr = document.createElement("tr");
    const td = document.createElement("td");

    td.colSpan = 3;
    td.textContent = "順位は1以上の整数で入力してください。";
    td.className = "error";

    tr.appendChild(td);
    rankingPreviewTbody.appendChild(tr);
    return;
  }

  const preview = buildPreviewRows(formRows);

  if (!preview.ok) return;

  preview.rows.forEach((row) => {
    const cell = document.querySelector(
      `[data-ranking-preview-team-id="${row.teamId}"]`
    );

    if (cell) {
      cell.textContent = row.displayText;
    }

    const tr = document.createElement("tr");

    if (row.status === "withdrawn" || row.status === "disqualified") {
      tr.classList.add("is-hidden-row");
    }

    const displayTd = document.createElement("td");
    displayTd.textContent = row.displayText;

    const teamTd = document.createElement("td");
    teamTd.textContent = getTeamName(row.teamId);

    const statusTd = document.createElement("td");
    statusTd.textContent = row.statusText;

    tr.appendChild(displayTd);
    tr.appendChild(teamTd);
    tr.appendChild(statusTd);

    rankingPreviewTbody.appendChild(tr);
  });
}

// ===== 保存 =====

if (saveAllBtn) {
  saveAllBtn.addEventListener("click", saveAllRankingEntries);
}

async function saveAllRankingEntries() {
  if (!isAdmin) {
    showRankingMessage("管理者のみ編集できます。", true);
    return;
  }

  if (!selectedStageId || !selectedStage) {
    showRankingMessage("順位入力型の表を選択してください。", true);
    return;
  }

  const formRows = readRowsFromForm();

  if (formRows.length === 0) {
    showRankingMessage("保存するチームがありません。", true);
    return;
  }

  const invalidRows = formRows.filter((row) => row.rankInvalid);

  if (invalidRows.length > 0) {
    showRankingMessage("順位は1以上の整数で入力してください。", true);
    return;
  }

  try {
    const batch = writeBatch(db);

    formRows.forEach((row) => {
      const entryId = row.entryId || row.teamId;

      const entryRef = doc(
        db,
        "stages",
        selectedStageId,
        "rankingEntries",
        entryId
      );

      const data = {
        teamId: row.teamId,
        rank: row.status === "normal" ? row.rank : null,
        status: row.status,
        order: row.order,
        updatedAt: serverTimestamp()
      };

      if (!row.entryId) {
        data.createdAt = serverTimestamp();
      }

      batch.set(entryRef, data, { merge: true });
    });

    batch.update(doc(db, "stages", selectedStageId), {
      updatedAt: serverTimestamp()
    });

    await batch.commit();

    showRankingMessage("順位を保存しました。");
  } catch (error) {
    console.error(error);
    showRankingMessage(
      `順位の保存に失敗しました：${error.code || ""} ${error.message}`,
      true
    );
  }
}

// 初期表示
clearRankingScreen();
