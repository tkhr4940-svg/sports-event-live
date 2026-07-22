import { auth, db } from "./firebase.js?v=50";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";

import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  updateDoc,
  writeBatch,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";

const STATUS_LABELS = {
  not_started: "未開始",
  in_progress: "試合中",
  finished: "終了"
};

const tournamentStageSelect = document.getElementById("tournament-stage-select");
const tournamentInfoEl = document.getElementById("tournament-info");
const tournamentMessageEl = document.getElementById("tournament-message");
const tournamentSeedSlotsEl = document.getElementById("tournament-seed-slots");
const saveSeedsBtn = document.getElementById("tournament-save-seeds-btn");
const buildMatchesBtn = document.getElementById("tournament-build-matches-btn");
const tournamentMatchesEl = document.getElementById("tournament-matches");

let isAdmin = false;

let teams = [];
let teamsMap = new Map();

let sports = [];
let sportsMap = new Map();

let tournamentStages = [];
let selectedStageId = "";
let selectedStage = null;

let tournamentMatches = [];
let tournamentMatchesMap = new Map();

let teamsUnsubscribe = null;
let sportsUnsubscribe = null;
let stagesUnsubscribe = null;
let matchesUnsubscribe = null;
let currentMatchesStageId = "";

function showTournamentMessage(message, isError = false) {
  if (!tournamentMessageEl) return;

  tournamentMessageEl.textContent = message;
  tournamentMessageEl.className = isError ? "message error" : "message success";

  if (!isError) {
    setTimeout(() => {
      if (tournamentMessageEl.textContent === message) {
        tournamentMessageEl.textContent = "";
        tournamentMessageEl.className = "message";
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
  if (!teamId) return "未定";
  return teamsMap.get(teamId)?.name || "不明なチーム";
}

function getSportName(sportId) {
  return sportsMap.get(sportId)?.name || sportId || "";
}

function readScore(value) {
  const text = String(value).trim();

  if (text === "") {
    return {
      ok: true,
      value: null
    };
  }

  const n = Number(text);

  if (!Number.isInteger(n) || n < 0) {
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

function getParticipantTeamIds(stage) {
  return Array.isArray(stage?.teamIds)
    ? stage.teamIds.filter(Boolean)
    : [];
}

function isPowerOfTwo(n) {
  return n > 0 && (n & (n - 1)) === 0;
}

function lowerPowerOfTwo(n) {
  return 2 ** Math.floor(Math.log2(n));
}

function getTournamentPlanFromTeamCount(teamCount) {
  if (teamCount < 2 || teamCount > 16) {
    return {
      valid: false,
      teamCount,
      baseSize: 0,
      preliminaryMatchCount: 0,
      byeTeamCount: 0,
      mainRoundCount: 0,
      totalRounds: 0,
      hasPreliminary: false,
      hasThirdPlace: false
    };
  }

  const baseSize = isPowerOfTwo(teamCount)
    ? teamCount
    : lowerPowerOfTwo(teamCount);

  const preliminaryMatchCount = isPowerOfTwo(teamCount)
    ? 0
    : teamCount - baseSize;

  const byeTeamCount = isPowerOfTwo(teamCount)
    ? 0
    : baseSize - preliminaryMatchCount;

  const mainRoundCount = Math.log2(baseSize);
  const totalRounds =
    mainRoundCount + (preliminaryMatchCount > 0 ? 1 : 0);

  return {
    valid: true,
    teamCount,
    baseSize,
    preliminaryMatchCount,
    byeTeamCount,
    mainRoundCount,
    totalRounds,
    hasPreliminary: preliminaryMatchCount > 0,
    hasThirdPlace: teamCount >= 4
  };
}

function getTournamentPlan(stage) {
  const teamCount = getParticipantTeamIds(stage).length;
  return getTournamentPlanFromTeamCount(teamCount);
}

// 互換用。今後は「16枠に丸める」のではなく、実チーム数を返す。
function getBracketSize(stage) {
  return getTournamentPlan(stage).teamCount;
}

function getMainRoundNameBySlotCount(slotCount) {
  if (slotCount === 16) return "1回戦";
  if (slotCount === 8) return "準々決勝";
  if (slotCount === 4) return "準決勝";
  if (slotCount === 2) return "決勝";
  return `${slotCount}チーム戦`;
}

function getSeedSlots(stage) {
  const participantIds = getParticipantTeamIds(stage);
  const slotCount = participantIds.length;

  const currentSlots = Array.isArray(stage?.settings?.seedSlots)
    ? stage.settings.seedSlots
    : [];

  const slots = Array.from({ length: slotCount }, (_, index) => {
    return currentSlots[index] || null;
  });

  if (currentSlots.length === 0) {
    participantIds.forEach((teamId, index) => {
      slots[index] = teamId;
    });
  }

  return slots;
}

function getSeedSlotLabel(index, plan) {
  const slotNumber = index + 1;

  if (!plan.hasPreliminary) {
    return `枠 ${slotNumber}`;
  }

  if (index < plan.byeTeamCount) {
    return `枠 ${slotNumber}（本戦から）`;
  }

  const preliminaryIndex = index - plan.byeTeamCount;
  const matchNumber = Math.floor(preliminaryIndex / 2) + 1;

  return `枠 ${slotNumber}（1回戦 第${matchNumber}試合）`;
}


function teamNameList(teamIds) {
  return teamIds.map((teamId) => getTeamName(teamId)).join("、");
}

// ===== ログイン確認 =====

onAuthStateChanged(auth, async (user) => {
  stopAllTournamentListeners();

  if (!user) {
    isAdmin = false;
    clearTournamentScreen();
    return;
  }

  try {
    const adminSnap = await getDoc(doc(db, "admins", user.uid));

    if (adminSnap.exists() && adminSnap.data().active === true) {
      isAdmin = true;
      startTournamentListeners();
    } else {
      isAdmin = false;
      clearTournamentScreen();
    }
  } catch (error) {
    console.error(error);
    isAdmin = false;
    showTournamentMessage(
      `トーナメント編集の管理者確認に失敗しました：${error.code || ""} ${error.message}`,
      true
    );
  }
});

function startTournamentListeners() {
  startTeamsListener();
  startSportsListener();
  startStagesListener();
}

function stopAllTournamentListeners() {
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

  stopMatchesListener();

  teams = [];
  teamsMap = new Map();

  sports = [];
  sportsMap = new Map();

  tournamentStages = [];
  selectedStageId = "";
  selectedStage = null;

  tournamentMatches = [];
  tournamentMatchesMap = new Map();
}

function clearTournamentScreen() {
  renderTournamentStageSelect();
  renderTournamentInfo();
  renderSeedSlots();
  renderTournamentMatches();
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

      renderTournamentInfo();
      renderSeedSlots();
      renderTournamentMatches();
    },
    (error) => {
      console.error(error);
      showTournamentMessage(
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

      renderTournamentInfo();
      renderTournamentStageSelect();
    },
    (error) => {
      console.error(error);
      showTournamentMessage(
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
      tournamentStages = snapshot.docs
        .map((docSnap) => ({
          id: docSnap.id,
          ...docSnap.data()
        }))
        .filter((stage) => stage.type === "tournament" && stage.hidden !== true);

      tournamentStages = sortByOrderAndName(tournamentStages);

      renderTournamentStageSelect();
    },
    (error) => {
      console.error(error);
      showTournamentMessage(
        `トーナメント表の取得に失敗しました：${error.code || ""} ${error.message}`,
        true
      );
    }
  );
}

// ===== トーナメント表選択 =====

if (tournamentStageSelect) {
  tournamentStageSelect.addEventListener("change", () => {
    selectTournamentStage(tournamentStageSelect.value);
  });
}

function renderTournamentStageSelect() {
  if (!tournamentStageSelect) return;

  const previousSelectedId = selectedStageId || tournamentStageSelect.value;

  tournamentStageSelect.replaceChildren();

  if (tournamentStages.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "作成済みのトーナメント表がありません";
    tournamentStageSelect.appendChild(option);

    selectedStageId = "";
    selectedStage = null;
    stopMatchesListener();
    renderTournamentInfo();
    renderSeedSlots();
    renderTournamentMatches();
    return;
  }

  tournamentStages.forEach((stage) => {
    const option = document.createElement("option");
    option.value = stage.id;

    const visibilityText = stage.visibility === "public" ? "公開" : "非公開";

    option.textContent =
      `${stage.name || "名称未設定"}（${getSportName(stage.sportId)} / ${visibilityText}）`;

    tournamentStageSelect.appendChild(option);
  });

  const stillExists = tournamentStages.some(
    (stage) => stage.id === previousSelectedId
  );

  selectedStageId = stillExists ? previousSelectedId : tournamentStages[0].id;

  tournamentStageSelect.value = selectedStageId;
  selectTournamentStage(selectedStageId);
}

function selectTournamentStage(stageId) {
  selectedStageId = stageId || "";

  selectedStage =
    tournamentStages.find((stage) => stage.id === selectedStageId) || null;

  renderTournamentInfo();
  renderSeedSlots();

  if (!selectedStageId) {
    stopMatchesListener();
    renderTournamentMatches();
    return;
  }

  startMatchesListener(selectedStageId);
}

function renderTournamentInfo() {
  if (!tournamentInfoEl) return;

  tournamentInfoEl.replaceChildren();

  if (!selectedStage) {
    tournamentInfoEl.textContent = "トーナメント表を選択してください。";
    return;
  }

  const plan = getTournamentPlan(selectedStage);

  if (!plan.valid) {
    tournamentInfoEl.textContent =
      "トーナメントは2〜16チームで作成してください。";
    return;
  }

  const teamIds = getParticipantTeamIds(selectedStage);

  const thirdPlace =
    selectedStage.settings?.thirdPlace === true && plan.teamCount >= 4;

  const lines = [
    `表名：${selectedStage.name || ""}`,
    `競技：${getSportName(selectedStage.sportId)}`,
    `参加チーム数：${teamIds.length}`,
    `配置枠：${plan.teamCount}枠`,
    `本戦：${plan.baseSize}チーム`,
    `1回戦：${plan.preliminaryMatchCount > 0 ? `${plan.preliminaryMatchCount}試合` : "なし"}`,
    `本戦から出場：${plan.byeTeamCount}チーム`,
    `3位決定戦：${thirdPlace ? "あり" : "なし"}`,
    `勝者決定：管理者が手動で選択`
  ];

  lines.forEach((line) => {
    const p = document.createElement("p");
    p.textContent = line;
    tournamentInfoEl.appendChild(p);
  });
}


// ===== 組み合わせ枠 =====

function renderSeedSlots() {
  if (!tournamentSeedSlotsEl) return;

  tournamentSeedSlotsEl.replaceChildren();

  if (!selectedStage) {
    tournamentSeedSlotsEl.textContent = "トーナメント表を選択してください。";
    return;
  }

  const plan = getTournamentPlan(selectedStage);

  if (!plan.valid) {
    tournamentSeedSlotsEl.textContent =
      "トーナメントは2〜16チームで作成してください。";
    return;
  }

  const seedSlots = getSeedSlots(selectedStage);
  const participantIds = getParticipantTeamIds(selectedStage);

  for (let i = 0; i < seedSlots.length; i++) {
    const wrapper = document.createElement("label");
    wrapper.className = "seed-slot";

    const title = document.createElement("span");
    title.textContent = getSeedSlotLabel(i, plan);

    const select = document.createElement("select");
    select.dataset.seedSlot = String(i);

    const emptyOption = document.createElement("option");
    emptyOption.value = "";
    emptyOption.textContent = "空き枠";
    select.appendChild(emptyOption);

    participantIds.forEach((teamId) => {
      const option = document.createElement("option");
      option.value = teamId;
      option.textContent = getTeamName(teamId);
      select.appendChild(option);
    });

    select.value = seedSlots[i] || "";

    wrapper.appendChild(title);
    wrapper.appendChild(select);

    tournamentSeedSlotsEl.appendChild(wrapper);
  }
}


function getSeedSlotValuesFromScreen() {
  return Array.from(
    tournamentSeedSlotsEl.querySelectorAll("select[data-seed-slot]")
  ).map((select) => select.value || null);
}

function validateSeedSlots(seedSlots) {
  if (!selectedStage) {
    return {
      ok: false,
      message: "トーナメント表を選択してください。"
    };
  }

  const participantIds = Array.isArray(selectedStage.teamIds)
    ? selectedStage.teamIds
    : [];

  const participantSet = new Set(participantIds);
  const placedSet = new Set();

  for (const teamId of seedSlots) {
    if (!teamId) continue;

    if (!participantSet.has(teamId)) {
      return {
        ok: false,
        message: "参加チーム以外が枠に入っています。"
      };
    }

    if (placedSet.has(teamId)) {
      return {
        ok: false,
        message: `「${getTeamName(teamId)}」が複数の枠に入っています。`
      };
    }

    placedSet.add(teamId);
  }

  const missingTeamIds = participantIds.filter((teamId) => !placedSet.has(teamId));

  if (missingTeamIds.length > 0) {
    return {
      ok: false,
      message: `未配置のチームがあります：${teamNameList(missingTeamIds)}`
    };
  }

  return {
    ok: true,
    seedSlots
  };
}

if (saveSeedsBtn) {
  saveSeedsBtn.addEventListener("click", saveSeedSlotsOnly);
}

async function saveSeedSlotsOnly() {
  if (!isAdmin) {
    showTournamentMessage("管理者のみ編集できます。", true);
    return;
  }

  if (!selectedStageId || !selectedStage) {
    showTournamentMessage("トーナメント表を選択してください。", true);
    return;
  }

  const seedSlots = getSeedSlotValuesFromScreen();
  const validation = validateSeedSlots(seedSlots);

  if (!validation.ok) {
    showTournamentMessage(validation.message, true);
    return;
  }

  const plan = getTournamentPlan(selectedStage);

  if (!plan.valid) {
    showTournamentMessage("トーナメントは2〜16チームで作成してください。", true);
    return;
  }

  try {
    const settings = {
      ...(selectedStage.settings || {}),

      // 旧仕様の bracketSize には実チーム数を入れる
      bracketSize: plan.teamCount,

      // 新仕様用
      actualTeamCount: plan.teamCount,
      mainBracketSize: plan.baseSize,
      preliminaryMatchCount: plan.preliminaryMatchCount,
      byeTeamCount: plan.byeTeamCount,
      totalRounds: plan.totalRounds,

      thirdPlace:
        selectedStage.settings?.thirdPlace === true && plan.teamCount >= 4,

      seedingMode: "manual",
      winnerSelection: "manual",
      seedSlots
    };

    await updateDoc(doc(db, "stages", selectedStageId), {
      settings,
      updatedAt: serverTimestamp()
    });

    showTournamentMessage("組み合わせを保存しました。");
  } catch (error) {
    console.error(error);
    showTournamentMessage(
      `組み合わせの保存に失敗しました：${error.code || ""} ${error.message}`,
      true
    );
  }
}


// ===== 試合作成／再作成 =====

if (buildMatchesBtn) {
  buildMatchesBtn.addEventListener("click", buildTournamentMatches);
}

async function buildTournamentMatches() {
  if (!isAdmin) {
    showTournamentMessage("管理者のみ編集できます。", true);
    return;
  }

  if (!selectedStageId || !selectedStage) {
    showTournamentMessage("トーナメント表を選択してください。", true);
    return;
  }

  const seedSlots = getSeedSlotValuesFromScreen();
  const validation = validateSeedSlots(seedSlots);

  if (!validation.ok) {
    showTournamentMessage(validation.message, true);
    return;
  }

  const plan = getTournamentPlan(selectedStage);

  if (!plan.valid) {
    showTournamentMessage("トーナメントは2〜16チームで作成してください。", true);
    return;
  }

  const ok = confirm(
    "トーナメント試合を作成／再作成します。\n既存の試合結果がある場合は上書きされます。\nよろしいですか？"
  );

  if (!ok) return;

  try {
    const stageRef = doc(db, "stages", selectedStageId);
    const matchesRef = collection(db, "stages", selectedStageId, "matches");

    const existingMatchesSnap = await getDocs(matchesRef);

    const batch = writeBatch(db);

    existingMatchesSnap.docs.forEach((docSnap) => {
      batch.delete(docSnap.ref);
    });

    const settings = {
      ...(selectedStage.settings || {}),

      // 旧仕様の bracketSize には実チーム数を入れる
      bracketSize: plan.teamCount,

      // 新仕様用
      actualTeamCount: plan.teamCount,
      mainBracketSize: plan.baseSize,
      preliminaryMatchCount: plan.preliminaryMatchCount,
      byeTeamCount: plan.byeTeamCount,
      totalRounds: plan.totalRounds,

      thirdPlace:
        selectedStage.settings?.thirdPlace === true && plan.teamCount >= 4,

      seedingMode: "manual",
      winnerSelection: "manual",
      seedSlots
    };

    batch.update(stageRef, {
      settings,
      updatedAt: serverTimestamp()
    });

    const matchDataList = generateTournamentMatchData(selectedStage, seedSlots);

    matchDataList.forEach((matchData) => {
      const { id, ...data } = matchData;
      const matchRef = doc(db, "stages", selectedStageId, "matches", id);
      batch.set(matchRef, data);
    });

    await batch.commit();

    showTournamentMessage("トーナメント試合を作成しました。");
  } catch (error) {
    console.error(error);
    showTournamentMessage(
      `トーナメント試合の作成に失敗しました：${error.code || ""} ${error.message}`,
      true
    );
  }
}


function generateTournamentMatchData(stage, seedSlots) {
  const placedTeamIds = seedSlots.filter(Boolean);
  const plan = getTournamentPlanFromTeamCount(placedTeamIds.length);

  if (!plan.valid) {
    throw new Error("トーナメントは2〜16チームで作成してください。");
  }

  const thirdPlace =
    stage.settings?.thirdPlace === true && plan.teamCount >= 4;

  const matches = [];
  const matchesById = new Map();

  function teamSlot(teamId) {
    return {
      kind: "team",
      teamId
    };
  }

  function winnerSlot(matchId) {
    return {
      kind: "winner",
      matchId
    };
  }

  function loserSlot(matchId) {
    return {
      kind: "loser",
      matchId
    };
  }

  function slotToTeamId(slot) {
    if (!slot) return null;
    return slot.kind === "team" ? slot.teamId : null;
  }

  function slotToSource(slot) {
    if (!slot) return null;

    if (slot.kind === "team") {
      return null;
    }

    return {
      type: slot.kind,
      matchId: slot.matchId
    };
  }

  function connectWinnerSourceToMatch(slot, targetMatch, side) {
    if (!slot || slot.kind !== "winner") return;

    const sourceMatch = matchesById.get(slot.matchId);
    if (!sourceMatch) return;

    sourceMatch.nextMatchId = targetMatch.id;
    sourceMatch.nextSlot = side;
  }

  function connectLoserSourceToMatch(slot, targetMatch, side) {
    if (!slot || slot.kind !== "loser") return;

    const sourceMatch = matchesById.get(slot.matchId);
    if (!sourceMatch) return;

    sourceMatch.loserNextMatchId = targetMatch.id;
    sourceMatch.loserNextSlot = side;
  }

  function addMatch({
    id,
    bracketType = "main",
    round,
    roundName,
    matchIndex,
    slotA,
    slotB,
    order
  }) {
    const matchId = id || `main_r${round}_m${matchIndex}`;

    const matchData = {
      id: matchId,
      type: "tournament",
      bracketType,
      round,
      roundName,
      matchIndex,
      order: order ?? round * 100 + matchIndex,

      teamAId: slotToTeamId(slotA),
      teamBId: slotToTeamId(slotB),

      // 後で横型表示を作るときに使える情報
      sourceA: slotToSource(slotA),
      sourceB: slotToSource(slotB),

      scoreA: null,
      scoreB: null,
      status: "not_started",
      winnerId: null,
      loserId: null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };

    matches.push(matchData);
    matchesById.set(matchId, matchData);

    connectWinnerSourceToMatch(slotA, matchData, "A");
    connectWinnerSourceToMatch(slotB, matchData, "B");

    connectLoserSourceToMatch(slotA, matchData, "A");
    connectLoserSourceToMatch(slotB, matchData, "B");

    return matchData;
  }

  let currentSlots = [];
  let round = 1;
  let semiFinalMatchIds = [];

  // 例：10チームの場合
  // byeTeamCount = 6
  // preliminaryMatchCount = 2
  //
  // 枠1〜6   → 本戦から
  // 枠7〜10  → 1回戦
  if (plan.hasPreliminary) {
    const byeTeams = placedTeamIds.slice(0, plan.byeTeamCount);
    const preliminaryTeams = placedTeamIds.slice(plan.byeTeamCount);

    const byeSlots = byeTeams.map(teamSlot);
    const preliminaryWinnerSlots = [];

    for (let i = 0; i < plan.preliminaryMatchCount; i++) {
      const teamAId = preliminaryTeams[i * 2];
      const teamBId = preliminaryTeams[i * 2 + 1];

      const match = addMatch({
        round,
        roundName: "1回戦",
        matchIndex: i + 1,
        slotA: teamSlot(teamAId),
        slotB: teamSlot(teamBId)
      });

      preliminaryWinnerSlots.push(winnerSlot(match.id));
    }

    // 本戦の枠に、不戦勝チームと1回戦勝者を配置
    currentSlots = [];

    const maxLength = Math.max(byeSlots.length, preliminaryWinnerSlots.length);

    for (let i = 0; i < maxLength; i++) {
      if (byeSlots[i]) {
        currentSlots.push(byeSlots[i]);
      }

      if (preliminaryWinnerSlots[i]) {
        currentSlots.push(preliminaryWinnerSlots[i]);
      }
    }

    round++;
  } else {
    currentSlots = placedTeamIds.map(teamSlot);
  }

  // 本戦
  while (currentSlots.length > 1) {
    const slotCount = currentSlots.length;
    const roundName = getMainRoundNameBySlotCount(slotCount);

    const nextSlots = [];
    const createdMatchIds = [];

    for (let i = 0; i < currentSlots.length; i += 2) {
      const matchIndex = i / 2 + 1;

      const match = addMatch({
        round,
        roundName,
        matchIndex,
        slotA: currentSlots[i],
        slotB: currentSlots[i + 1]
      });

      createdMatchIds.push(match.id);
      nextSlots.push(winnerSlot(match.id));
    }

    if (slotCount === 4) {
      semiFinalMatchIds = createdMatchIds;
    }

    currentSlots = nextSlots;
    round++;
  }

  // 3位決定戦
  if (thirdPlace && semiFinalMatchIds.length === 2) {
    const finalRound = round - 1;

    addMatch({
      id: "third_place",
      bracketType: "third_place",
      round: finalRound,
      roundName: "3位決定戦",
      matchIndex: 1,
      order: finalRound * 100 + 50,
      slotA: loserSlot(semiFinalMatchIds[0]),
      slotB: loserSlot(semiFinalMatchIds[1])
    });
  }

  return matches;
}


function applyByeWin(match, winnerId, matchesById) {
  match.status = "finished";
  match.winnerId = winnerId;
  match.loserId = null;

  if (!match.nextMatchId) return;

  const nextMatch = matchesById.get(match.nextMatchId);

  if (!nextMatch) return;

  if (match.nextSlot === "B") {
    nextMatch.teamBId = winnerId;
  } else {
    nextMatch.teamAId = winnerId;
  }
}

// ===== 試合取得・表示 =====

function startMatchesListener(stageId) {
  if (matchesUnsubscribe && currentMatchesStageId === stageId) {
    renderTournamentMatches();
    return;
  }

  stopMatchesListener();

  currentMatchesStageId = stageId;

  matchesUnsubscribe = onSnapshot(
    collection(db, "stages", stageId, "matches"),
    (snapshot) => {
      tournamentMatches = snapshot.docs
        .map((docSnap) => ({
          id: docSnap.id,
          ...docSnap.data()
        }))
        .filter((match) => match.type === "tournament");

      tournamentMatches.sort((a, b) => {
        const orderA = Number(a.order ?? 999999);
        const orderB = Number(b.order ?? 999999);
        return orderA - orderB;
      });

      tournamentMatchesMap = new Map(
        tournamentMatches.map((match) => [match.id, match])
      );

      renderTournamentMatches();
    },
    (error) => {
      console.error(error);
      showTournamentMessage(
        `試合データの取得に失敗しました：${error.code || ""} ${error.message}`,
        true
      );
    }
  );
}

function stopMatchesListener() {
  if (matchesUnsubscribe) {
    matchesUnsubscribe();
    matchesUnsubscribe = null;
  }

  currentMatchesStageId = "";
  tournamentMatches = [];
  tournamentMatchesMap = new Map();
}

function renderTournamentMatches() {
  if (!tournamentMatchesEl) return;

  tournamentMatchesEl.replaceChildren();

  if (!selectedStage) {
    tournamentMatchesEl.textContent = "トーナメント表を選択してください。";
    return;
  }

  if (tournamentMatches.length === 0) {
    tournamentMatchesEl.textContent =
      "まだ試合が作成されていません。上の「組み合わせを保存して試合を作成／再作成」を押してください。";
    return;
  }

  const mainMatches = tournamentMatches.filter(
    (match) => match.bracketType === "main"
  );

  const thirdPlaceMatches = tournamentMatches.filter(
    (match) => match.bracketType === "third_place"
  );

  const roundNumbers = Array.from(
    new Set(mainMatches.map((match) => Number(match.round)))
  ).sort((a, b) => a - b);

  roundNumbers.forEach((round) => {
    const roundMatches = mainMatches.filter(
      (match) => Number(match.round) === round
    );

    const title = roundMatches[0]?.roundName || `${round}回戦`;
    tournamentMatchesEl.appendChild(createMatchTable(title, roundMatches));
  });

  if (thirdPlaceMatches.length > 0) {
    tournamentMatchesEl.appendChild(
      createMatchTable("3位決定戦", thirdPlaceMatches)
    );
  }
}

function createMatchTable(title, matches) {
  const wrapper = document.createElement("section");
  wrapper.className = "tournament-round";

  const h4 = document.createElement("h4");
  h4.textContent = title;
  wrapper.appendChild(h4);

  const tableWrap = document.createElement("div");
  tableWrap.className = "table-wrap";

  const table = document.createElement("table");

  const thead = document.createElement("thead");
  thead.innerHTML = `
    <tr>
      <th>試合</th>
      <th>対戦</th>
      <th>得点A</th>
      <th>得点B</th>
      <th>状態</th>
      <th>勝者</th>
      <th>操作</th>
    </tr>
  `;

  const tbody = document.createElement("tbody");

  matches.forEach((match) => {
    const tr = document.createElement("tr");
    tr.dataset.matchId = match.id;

    const matchTd = document.createElement("td");
    matchTd.textContent =
      match.bracketType === "third_place"
        ? "3位決定戦"
        : `第${match.matchIndex}試合`;

    const matchupTd = document.createElement("td");
    matchupTd.innerHTML = `
      <div class="match-team-line">A：${getTeamName(match.teamAId)}</div>
      <div class="match-team-line">B：${getTeamName(match.teamBId)}</div>
    `;

    const scoreATd = document.createElement("td");
    const scoreAInput = document.createElement("input");
    scoreAInput.type = "number";
    scoreAInput.min = "0";
    scoreAInput.className = "score-input";
    scoreAInput.dataset.tournamentScore = "A";
    scoreAInput.value = match.scoreA ?? "";
    scoreATd.appendChild(scoreAInput);

    const scoreBTd = document.createElement("td");
    const scoreBInput = document.createElement("input");
    scoreBInput.type = "number";
    scoreBInput.min = "0";
    scoreBInput.className = "score-input";
    scoreBInput.dataset.tournamentScore = "B";
    scoreBInput.value = match.scoreB ?? "";
    scoreBTd.appendChild(scoreBInput);

    const statusTd = document.createElement("td");
    const statusSelect = document.createElement("select");
    statusSelect.className = "small-select";
    statusSelect.dataset.tournamentStatus = "match";

    Object.entries(STATUS_LABELS).forEach(([value, label]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      statusSelect.appendChild(option);
    });

    statusSelect.value = match.status || "not_started";
    statusTd.appendChild(statusSelect);

    const winnerTd = document.createElement("td");
    const winnerSelect = document.createElement("select");
    winnerSelect.className = "small-select";
    winnerSelect.dataset.tournamentWinner = "match";

    const emptyWinnerOption = document.createElement("option");
    emptyWinnerOption.value = "";
    emptyWinnerOption.textContent = "未選択";
    winnerSelect.appendChild(emptyWinnerOption);

    if (match.teamAId) {
      const optionA = document.createElement("option");
      optionA.value = match.teamAId;
      optionA.textContent = getTeamName(match.teamAId);
      winnerSelect.appendChild(optionA);
    }

    if (match.teamBId) {
      const optionB = document.createElement("option");
      optionB.value = match.teamBId;
      optionB.textContent = getTeamName(match.teamBId);
      winnerSelect.appendChild(optionB);
    }

    winnerSelect.value = match.winnerId || "";
    winnerTd.appendChild(winnerSelect);

    const actionTd = document.createElement("td");

    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.textContent = "保存";
    saveBtn.addEventListener("click", async () => {
      await saveTournamentMatchResult(match.id, tr);
    });

    actionTd.appendChild(saveBtn);

    tr.appendChild(matchTd);
    tr.appendChild(matchupTd);
    tr.appendChild(scoreATd);
    tr.appendChild(scoreBTd);
    tr.appendChild(statusTd);
    tr.appendChild(winnerTd);
    tr.appendChild(actionTd);

    tbody.appendChild(tr);
  });

  table.appendChild(thead);
  table.appendChild(tbody);

  tableWrap.appendChild(table);
  wrapper.appendChild(tableWrap);

  return wrapper;
}

// ===== 試合結果保存・勝ち上がり反映 =====

async function saveTournamentMatchResult(matchId, row) {
  if (!isAdmin) {
    showTournamentMessage("管理者のみ編集できます。", true);
    return;
  }

  if (!selectedStageId) {
    showTournamentMessage("トーナメント表を選択してください。", true);
    return;
  }

  const match = tournamentMatchesMap.get(matchId);

  if (!match) {
    showTournamentMessage("試合データが見つかりません。", true);
    return;
  }

  const scoreAInput = row.querySelector('[data-tournament-score="A"]');
  const scoreBInput = row.querySelector('[data-tournament-score="B"]');
  const statusSelect = row.querySelector('[data-tournament-status="match"]');
  const winnerSelect = row.querySelector('[data-tournament-winner="match"]');

  const scoreAResult = readScore(scoreAInput.value);
  const scoreBResult = readScore(scoreBInput.value);

  if (!scoreAResult.ok || !scoreBResult.ok) {
    showTournamentMessage("得点は0以上の整数で入力してください。", true);
    return;
  }

  const scoreA = scoreAResult.value;
  const scoreB = scoreBResult.value;

  if (
    (scoreA === null && scoreB !== null) ||
    (scoreA !== null && scoreB === null)
  ) {
    showTournamentMessage("得点を入力する場合は、両チームの得点を入力してください。", true);
    return;
  }

  const status = statusSelect.value;
  let winnerId = winnerSelect.value || null;

  const validWinnerIds = [match.teamAId, match.teamBId].filter(Boolean);

  if (winnerId && !validWinnerIds.includes(winnerId)) {
    showTournamentMessage("勝者は対戦チームの中から選択してください。", true);
    return;
  }

  if (status === "finished" && !winnerId) {
    showTournamentMessage("終了にする場合は勝者を選択してください。", true);
    return;
  }

  if (status !== "finished") {
    winnerId = null;
  }

  let loserId = null;

  if (winnerId && match.teamAId && match.teamBId) {
    loserId = winnerId === match.teamAId ? match.teamBId : match.teamAId;
  }

  if ((match.winnerId || null) !== (winnerId || null)) {
    const ok = confirm(
      "勝者を変更すると、次の試合や3位決定戦の枠が更新されます。\n必要に応じて次の試合結果を再入力してください。\nよろしいですか？"
    );

    if (!ok) return;
  }

  try {
    const batch = writeBatch(db);

    const matchRef = doc(db, "stages", selectedStageId, "matches", matchId);

    batch.update(matchRef, {
      scoreA,
      scoreB,
      status,
      winnerId,
      loserId,
      updatedAt: serverTimestamp()
    });

    // 勝者を次の試合へ反映
    if (match.nextMatchId) {
      addParticipantPropagationToBatch(
        batch,
        match.nextMatchId,
        match.nextSlot,
        winnerId
      );
    }

    // 準決勝敗者を3位決定戦へ反映
    if (match.loserNextMatchId) {
      addParticipantPropagationToBatch(
        batch,
        match.loserNextMatchId,
        match.loserNextSlot,
        loserId
      );
    }

    batch.update(doc(db, "stages", selectedStageId), {
      updatedAt: serverTimestamp()
    });

    await batch.commit();

    showTournamentMessage("試合結果を保存しました。");
  } catch (error) {
    console.error(error);
    showTournamentMessage(
      `試合結果の保存に失敗しました：${error.code || ""} ${error.message}`,
      true
    );
  }
}

function addParticipantPropagationToBatch(batch, targetMatchId, slot, participantId) {
  if (!targetMatchId) return;

  const targetMatch = tournamentMatchesMap.get(targetMatchId);

  if (!targetMatch) return;

  const fieldName = slot === "B" ? "teamBId" : "teamAId";
  const currentValue = targetMatch[fieldName] || null;
  const nextValue = participantId || null;

  const updates = {
    [fieldName]: nextValue,
    updatedAt: serverTimestamp()
  };

  if (currentValue !== nextValue) {
    updates.scoreA = null;
    updates.scoreB = null;
    updates.status = "not_started";
    updates.winnerId = null;
    updates.loserId = null;
  }

  batch.update(
    doc(db, "stages", selectedStageId, "matches", targetMatchId),
    updates
  );
}

// 初期表示
clearTournamentScreen();
