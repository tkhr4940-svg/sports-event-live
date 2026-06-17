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
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";

const STATUS_LABELS = {
  not_started: "未開始",
  in_progress: "試合中",
  finished: "終了"
};

const leagueStageSelect = document.getElementById("league-stage-select");
const leagueInfoEl = document.getElementById("league-info");
const leagueMessageEl = document.getElementById("league-message");
const leagueMatchesTbody = document.getElementById("league-matches-tbody");
const leagueStandingsTbody = document.getElementById("league-standings-tbody");
const leagueTieNote = document.getElementById("league-tie-note");
const saveManualRanksBtn = document.getElementById("league-save-manual-ranks-btn");

let isAdmin = false;

let teams = [];
let teamsMap = new Map();

let sports = [];
let sportsMap = new Map();

let leagueStages = [];
let selectedStageId = "";
let selectedStage = null;

let leagueMatches = [];

let teamsUnsubscribe = null;
let sportsUnsubscribe = null;
let stagesUnsubscribe = null;
let matchesUnsubscribe = null;
let currentMatchesStageId = "";

function showLeagueMessage(message, isError = false) {
  if (!leagueMessageEl) return;

  leagueMessageEl.textContent = message;
  leagueMessageEl.className = isError ? "message error" : "message success";

  if (!isError) {
    setTimeout(() => {
      if (leagueMessageEl.textContent === message) {
        leagueMessageEl.textContent = "";
        leagueMessageEl.className = "message";
      }
    }, 2500);
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

function normalizeManualRank(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function manualRankForSort(value) {
  const n = normalizeManualRank(value);
  return n === null ? Infinity : n;
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

// ===== ログイン確認 =====

onAuthStateChanged(auth, async (user) => {
  stopAllLeagueListeners();

  if (!user) {
    isAdmin = false;
    clearLeagueScreen();
    return;
  }

  try {
    const adminSnap = await getDoc(doc(db, "admins", user.uid));

    if (adminSnap.exists() && adminSnap.data().active === true) {
      isAdmin = true;
      startLeagueListeners();
    } else {
      isAdmin = false;
      clearLeagueScreen();
    }
  } catch (error) {
    console.error(error);
    isAdmin = false;
    showLeagueMessage(
      `リーグ戦編集の管理者確認に失敗しました：${error.code || ""} ${error.message}`,
      true
    );
  }
});

function startLeagueListeners() {
  startTeamsListener();
  startSportsListener();
  startStagesListener();
}

function stopAllLeagueListeners() {
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

  leagueStages = [];
  selectedStageId = "";
  selectedStage = null;
  leagueMatches = [];
}

function clearLeagueScreen() {
  renderLeagueStageSelect();
  renderLeagueInfo();
  renderLeagueMatches();
  renderLeagueStandings();
}

// ===== チーム・競技・表の取得 =====

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

      renderLeagueInfo();
      renderLeagueMatches();
      renderLeagueStandings();
    },
    (error) => {
      console.error(error);
      showLeagueMessage(
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

      renderLeagueInfo();
      renderLeagueStageSelect();
    },
    (error) => {
      console.error(error);
      showLeagueMessage(
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
      leagueStages = snapshot.docs
        .map((docSnap) => ({
          id: docSnap.id,
          ...docSnap.data()
        }))
        .filter((stage) => stage.type === "league" && stage.hidden !== true);

      leagueStages = sortByOrderAndName(leagueStages);

      renderLeagueStageSelect();
    },
    (error) => {
      console.error(error);
      showLeagueMessage(
        `リーグ戦表の取得に失敗しました：${error.code || ""} ${error.message}`,
        true
      );
    }
  );
}

// ===== リーグ戦表選択 =====

if (leagueStageSelect) {
  leagueStageSelect.addEventListener("change", () => {
    selectLeagueStage(leagueStageSelect.value);
  });
}

function renderLeagueStageSelect() {
  if (!leagueStageSelect) return;

  const previousSelectedId = selectedStageId || leagueStageSelect.value;

  leagueStageSelect.replaceChildren();

  if (leagueStages.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "作成済みのリーグ戦表がありません";
    leagueStageSelect.appendChild(option);

    selectedStageId = "";
    selectedStage = null;
    stopMatchesListener();
    renderLeagueInfo();
    renderLeagueMatches();
    renderLeagueStandings();
    return;
  }

  leagueStages.forEach((stage) => {
    const option = document.createElement("option");
    option.value = stage.id;

    const visibilityText = stage.visibility === "public" ? "公開" : "非公開";
    option.textContent =
      `${stage.name || "名称未設定"}（${getSportName(stage.sportId)} / ${visibilityText}）`;

    leagueStageSelect.appendChild(option);
  });

  const stillExists = leagueStages.some((stage) => stage.id === previousSelectedId);
  selectedStageId = stillExists ? previousSelectedId : leagueStages[0].id;

  leagueStageSelect.value = selectedStageId;
  selectLeagueStage(selectedStageId);
}

function selectLeagueStage(stageId) {
  selectedStageId = stageId || "";

  selectedStage =
    leagueStages.find((stage) => stage.id === selectedStageId) || null;

  renderLeagueInfo();

  if (!selectedStageId) {
    stopMatchesListener();
    renderLeagueMatches();
    renderLeagueStandings();
    return;
  }

  startMatchesListener(selectedStageId);
  renderLeagueStandings();
}

function renderLeagueInfo() {
  if (!leagueInfoEl) return;

  leagueInfoEl.replaceChildren();

  if (!selectedStage) {
    leagueInfoEl.textContent = "リーグ戦表を選択してください。";
    return;
  }

  const visibilityText =
    selectedStage.visibility === "public" ? "公開" : "非公開";

  const teamCount = Array.isArray(selectedStage.teamIds)
    ? selectedStage.teamIds.length
    : 0;

  const lines = [
    `表名：${selectedStage.name || ""}`,
    `競技：${getSportName(selectedStage.sportId)}`,
    `参加チーム数：${teamCount}`,
    `公開状態：${visibilityText}`,
    `順位ルール：勝ち点 → 得失点差 → 総得点 → 直接対決 → 手動順位`
  ];

  lines.forEach((line) => {
    const p = document.createElement("p");
    p.textContent = line;
    leagueInfoEl.appendChild(p);
  });
}

// ===== 試合データ =====

function startMatchesListener(stageId) {
  if (matchesUnsubscribe && currentMatchesStageId === stageId) {
    renderLeagueMatches();
    renderLeagueStandings();
    return;
  }

  stopMatchesListener();

  currentMatchesStageId = stageId;

  matchesUnsubscribe = onSnapshot(
    collection(db, "stages", stageId, "matches"),
    (snapshot) => {
      leagueMatches = snapshot.docs.map((docSnap) => ({
        id: docSnap.id,
        ...docSnap.data()
      }));

      leagueMatches.sort((a, b) => {
        const orderA = Number(a.order ?? a.matchNo ?? 999999);
        const orderB = Number(b.order ?? b.matchNo ?? 999999);
        return orderA - orderB;
      });

      renderLeagueMatches();
      renderLeagueStandings();
    },
    (error) => {
      console.error(error);
      showLeagueMessage(
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
  leagueMatches = [];
}

function renderLeagueMatches() {
  if (!leagueMatchesTbody) return;

  leagueMatchesTbody.replaceChildren();

  if (!selectedStage) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 6;
    td.textContent = "リーグ戦表を選択してください。";
    tr.appendChild(td);
    leagueMatchesTbody.appendChild(tr);
    return;
  }

  if (leagueMatches.length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 6;
    td.textContent = "試合カードがありません。";
    tr.appendChild(td);
    leagueMatchesTbody.appendChild(tr);
    return;
  }

  leagueMatches.forEach((match, index) => {
    const tr = document.createElement("tr");
    tr.dataset.matchId = match.id;

    const noTd = document.createElement("td");
    noTd.textContent = match.matchNo ?? index + 1;

    const matchupTd = document.createElement("td");
    matchupTd.textContent =
      `${getTeamName(match.teamAId)} vs ${getTeamName(match.teamBId)}`;

    const scoreATd = document.createElement("td");
    const scoreAInput = document.createElement("input");
    scoreAInput.type = "number";
    scoreAInput.min = "0";
    scoreAInput.className = "score-input";
    scoreAInput.dataset.score = "A";
    scoreAInput.value = match.scoreA ?? "";
    scoreATd.appendChild(scoreAInput);

    const scoreBTd = document.createElement("td");
    const scoreBInput = document.createElement("input");
    scoreBInput.type = "number";
    scoreBInput.min = "0";
    scoreBInput.className = "score-input";
    scoreBInput.dataset.score = "B";
    scoreBInput.value = match.scoreB ?? "";
    scoreBTd.appendChild(scoreBInput);

    const statusTd = document.createElement("td");
    const statusSelect = document.createElement("select");
    statusSelect.className = "small-select";
    statusSelect.dataset.status = "match";

    Object.entries(STATUS_LABELS).forEach(([value, label]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      statusSelect.appendChild(option);
    });

    statusSelect.value = match.status || "not_started";
    statusTd.appendChild(statusSelect);

    const actionTd = document.createElement("td");

    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.textContent = "保存";
    saveBtn.addEventListener("click", async () => {
      await saveMatchResult(match.id, tr);
    });

    actionTd.appendChild(saveBtn);

    tr.appendChild(noTd);
    tr.appendChild(matchupTd);
    tr.appendChild(scoreATd);
    tr.appendChild(scoreBTd);
    tr.appendChild(statusTd);
    tr.appendChild(actionTd);

    leagueMatchesTbody.appendChild(tr);
  });
}

async function saveMatchResult(matchId, row) {
  if (!isAdmin) {
    showLeagueMessage("管理者のみ編集できます。", true);
    return;
  }

  if (!selectedStageId) {
    showLeagueMessage("リーグ戦表を選択してください。", true);
    return;
  }

  const match = leagueMatches.find((item) => item.id === matchId);

  if (!match) {
    showLeagueMessage("試合データが見つかりません。", true);
    return;
  }

  const scoreAInput = row.querySelector('[data-score="A"]');
  const scoreBInput = row.querySelector('[data-score="B"]');
  const statusSelect = row.querySelector('[data-status="match"]');

  const scoreAResult = readScore(scoreAInput.value);
  const scoreBResult = readScore(scoreBInput.value);
  const status = statusSelect.value;

  if (!scoreAResult.ok || !scoreBResult.ok) {
    showLeagueMessage("得点は0以上の整数で入力してください。", true);
    return;
  }

  const scoreA = scoreAResult.value;
  const scoreB = scoreBResult.value;

  if (status === "finished" && (scoreA === null || scoreB === null)) {
    showLeagueMessage("終了にする場合は両チームの得点を入力してください。", true);
    return;
  }

  let winnerId = null;

  if (status === "finished" && scoreA !== null && scoreB !== null) {
    if (scoreA > scoreB) {
      winnerId = match.teamAId;
    } else if (scoreB > scoreA) {
      winnerId = match.teamBId;
    }
  }

  try {
    await updateDoc(doc(db, "stages", selectedStageId, "matches", matchId), {
      scoreA,
      scoreB,
      status,
      winnerId,
      updatedAt: serverTimestamp()
    });

    await updateDoc(doc(db, "stages", selectedStageId), {
      updatedAt: serverTimestamp()
    });

    showLeagueMessage("試合結果を保存しました。");
  } catch (error) {
    console.error(error);
    showLeagueMessage(
      `試合結果の保存に失敗しました：${error.code || ""} ${error.message}`,
      true
    );
  }
}

// ===== 順位計算 =====

function computeLeagueStandings() {
  if (!selectedStage) return [];

  const teamIds = Array.isArray(selectedStage.teamIds)
    ? selectedStage.teamIds
    : [];

  const manualRanks = selectedStage.manualRanks || {};

  const statsMap = new Map();

  function ensureStats(teamId) {
    if (!teamId) return null;

    if (!statsMap.has(teamId)) {
      statsMap.set(teamId, {
        teamId,
        played: 0,
        wins: 0,
        draws: 0,
        losses: 0,
        goalsFor: 0,
        goalsAgainst: 0,
        goalDifference: 0,
        points: 0,
        manualRank: normalizeManualRank(manualRanks[teamId]),
        displayRank: null
      });
    }

    return statsMap.get(teamId);
  }

  teamIds.forEach((teamId) => ensureStats(teamId));

  leagueMatches.forEach((match) => {
    if (match.status !== "finished") return;

    const scoreA = Number(match.scoreA);
    const scoreB = Number(match.scoreB);

    if (!Number.isFinite(scoreA) || !Number.isFinite(scoreB)) return;

    const teamA = ensureStats(match.teamAId);
    const teamB = ensureStats(match.teamBId);

    if (!teamA || !teamB) return;

    teamA.played += 1;
    teamB.played += 1;

    teamA.goalsFor += scoreA;
    teamA.goalsAgainst += scoreB;

    teamB.goalsFor += scoreB;
    teamB.goalsAgainst += scoreA;

    if (scoreA > scoreB) {
      teamA.wins += 1;
      teamB.losses += 1;
      teamA.points += 3;
    } else if (scoreB > scoreA) {
      teamB.wins += 1;
      teamA.losses += 1;
      teamB.points += 3;
    } else {
      teamA.draws += 1;
      teamB.draws += 1;
      teamA.points += 1;
      teamB.points += 1;
    }
  });

  const rows = Array.from(statsMap.values());

  rows.forEach((row) => {
    row.goalDifference = row.goalsFor - row.goalsAgainst;
  });

  rows.sort(compareStandingRows);

  rows.forEach((row, index) => {
    if (index === 0) {
      row.displayRank = 1;
      return;
    }

    const previous = rows[index - 1];

    if (isSameRank(previous, row)) {
      row.displayRank = previous.displayRank;
    } else {
      row.displayRank = index + 1;
    }
  });

  return rows;
}

function compareStandingRows(a, b) {
  if (b.points !== a.points) {
    return b.points - a.points;
  }

  if (b.goalDifference !== a.goalDifference) {
    return b.goalDifference - a.goalDifference;
  }

  if (b.goalsFor !== a.goalsFor) {
    return b.goalsFor - a.goalsFor;
  }

  const headToHead = compareHeadToHead(a.teamId, b.teamId);

  if (headToHead !== 0) {
    return headToHead;
  }

  const manualA = manualRankForSort(a.manualRank);
  const manualB = manualRankForSort(b.manualRank);

  if (manualA !== manualB) {
    return manualA - manualB;
  }

  const orderDiff = getTeamOrder(a.teamId) - getTeamOrder(b.teamId);

  if (orderDiff !== 0) {
    return orderDiff;
  }

  return getTeamName(a.teamId).localeCompare(getTeamName(b.teamId), "ja");
}

function compareHeadToHead(teamAId, teamBId) {
  let aPoints = 0;
  let bPoints = 0;
  let aGoalDiff = 0;
  let bGoalDiff = 0;
  let aGoalsFor = 0;
  let bGoalsFor = 0;
  let played = 0;

  leagueMatches.forEach((match) => {
    if (match.status !== "finished") return;

    const isPair =
      (match.teamAId === teamAId && match.teamBId === teamBId) ||
      (match.teamAId === teamBId && match.teamBId === teamAId);

    if (!isPair) return;

    const rawScoreA = Number(match.scoreA);
    const rawScoreB = Number(match.scoreB);

    if (!Number.isFinite(rawScoreA) || !Number.isFinite(rawScoreB)) return;

    let scoreForA;
    let scoreForB;

    if (match.teamAId === teamAId) {
      scoreForA = rawScoreA;
      scoreForB = rawScoreB;
    } else {
      scoreForA = rawScoreB;
      scoreForB = rawScoreA;
    }

    played += 1;

    aGoalsFor += scoreForA;
    bGoalsFor += scoreForB;

    aGoalDiff += scoreForA - scoreForB;
    bGoalDiff += scoreForB - scoreForA;

    if (scoreForA > scoreForB) {
      aPoints += 3;
    } else if (scoreForB > scoreForA) {
      bPoints += 3;
    } else {
      aPoints += 1;
      bPoints += 1;
    }
  });

  if (played === 0) return 0;

  if (aPoints !== bPoints) {
    return aPoints > bPoints ? -1 : 1;
  }

  if (aGoalDiff !== bGoalDiff) {
    return aGoalDiff > bGoalDiff ? -1 : 1;
  }

  if (aGoalsFor !== bGoalsFor) {
    return aGoalsFor > bGoalsFor ? -1 : 1;
  }

  return 0;
}

function isSameRank(a, b) {
  if (a.points !== b.points) return false;
  if (a.goalDifference !== b.goalDifference) return false;
  if (a.goalsFor !== b.goalsFor) return false;

  if (compareHeadToHead(a.teamId, b.teamId) !== 0) {
    return false;
  }

  const manualA = normalizeManualRank(a.manualRank);
  const manualB = normalizeManualRank(b.manualRank);

  return manualA === manualB;
}

function renderLeagueStandings() {
  if (!leagueStandingsTbody) return;

  leagueStandingsTbody.replaceChildren();

  if (!selectedStage) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 11;
    td.textContent = "リーグ戦表を選択してください。";
    tr.appendChild(td);
    leagueStandingsTbody.appendChild(tr);

    if (leagueTieNote) {
      leagueTieNote.textContent = "";
    }

    return;
  }

  const standings = computeLeagueStandings();

  if (standings.length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 11;
    td.textContent = "参加チームがありません。";
    tr.appendChild(td);
    leagueStandingsTbody.appendChild(tr);
    return;
  }

  let hasSameRank = false;

  standings.forEach((row, index) => {
    if (index > 0 && row.displayRank === standings[index - 1].displayRank) {
      hasSameRank = true;
    }

    const tr = document.createElement("tr");

    const rankTd = document.createElement("td");
    rankTd.textContent = `${row.displayRank}位`;

    const teamTd = document.createElement("td");
    teamTd.textContent = getTeamName(row.teamId);

    const playedTd = document.createElement("td");
    playedTd.textContent = row.played;

    const winsTd = document.createElement("td");
    winsTd.textContent = row.wins;

    const drawsTd = document.createElement("td");
    drawsTd.textContent = row.draws;

    const lossesTd = document.createElement("td");
    lossesTd.textContent = row.losses;

    const gfTd = document.createElement("td");
    gfTd.textContent = row.goalsFor;

    const gaTd = document.createElement("td");
    gaTd.textContent = row.goalsAgainst;

    const gdTd = document.createElement("td");
    gdTd.textContent = row.goalDifference;

    const pointsTd = document.createElement("td");
    pointsTd.textContent = row.points;

    const manualTd = document.createElement("td");
    const manualInput = document.createElement("input");
    manualInput.type = "number";
    manualInput.min = "1";
    manualInput.className = "rank-input";
    manualInput.dataset.teamId = row.teamId;
    manualInput.value = row.manualRank ?? "";

    manualTd.appendChild(manualInput);

    tr.appendChild(rankTd);
    tr.appendChild(teamTd);
    tr.appendChild(playedTd);
    tr.appendChild(winsTd);
    tr.appendChild(drawsTd);
    tr.appendChild(lossesTd);
    tr.appendChild(gfTd);
    tr.appendChild(gaTd);
    tr.appendChild(gdTd);
    tr.appendChild(pointsTd);
    tr.appendChild(manualTd);

    leagueStandingsTbody.appendChild(tr);
  });

  if (leagueTieNote) {
    leagueTieNote.textContent = hasSameRank
      ? "同順位があります。必要に応じて手動順位を入力して保存してください。"
      : "手動順位は、勝ち点・得失点差・総得点・直接対決でも並んだ場合に使用します。";
  }
}

// ===== 手動順位保存 =====

if (saveManualRanksBtn) {
  saveManualRanksBtn.addEventListener("click", saveManualRanks);
}

async function saveManualRanks() {
  if (!isAdmin) {
    showLeagueMessage("管理者のみ編集できます。", true);
    return;
  }

  if (!selectedStageId) {
    showLeagueMessage("リーグ戦表を選択してください。", true);
    return;
  }

  const inputs = Array.from(
    document.querySelectorAll(".rank-input[data-team-id]")
  );

  const ranks = {};
  const usedRanks = new Set();

  for (const input of inputs) {
    const teamId = input.dataset.teamId;
    const value = input.value.trim();

    if (value === "") {
      continue;
    }

    const rank = Number(value);

    if (!Number.isInteger(rank) || rank < 1) {
      showLeagueMessage("手動順位は1以上の整数で入力してください。", true);
      return;
    }

    if (usedRanks.has(rank)) {
      showLeagueMessage("同じ手動順位が入力されています。順位は重複しないようにしてください。", true);
      return;
    }

    usedRanks.add(rank);
    ranks[teamId] = rank;
  }

  try {
    await updateDoc(doc(db, "stages", selectedStageId), {
      manualRanks: ranks,
      updatedAt: serverTimestamp()
    });

    showLeagueMessage("手動順位を保存しました。");
  } catch (error) {
    console.error(error);
    showLeagueMessage(
      `手動順位の保存に失敗しました：${error.code || ""} ${error.message}`,
      true
    );
  }
}

// 初期表示
clearLeagueScreen();
