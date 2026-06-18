import { db } from "./firebase.js?v=50";

import {
  collection,
  onSnapshot,
  query,
  where
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";

const STAGE_TYPE_LABELS = {
  league: "リーグ戦",
  tournament: "トーナメント",
  ranking: "順位入力型"
};

const STATUS_LABELS = {
  not_started: "未開始",
  in_progress: "試合中",
  finished: "終了"
};

const RANKING_STATUS_LABELS = {
  normal: "通常",
  withdrawn: "棄権",
  disqualified: "失格"
};

const appEl = document.getElementById("viewer-app");
const viewerStatusEl = document.getElementById("viewer-status");
const viewerErrorEl = document.getElementById("viewer-error");

let teams = [];
let sports = [];
let stages = [];

let teamsMap = new Map();
let sportsMap = new Map();

let stageData = new Map();
let childUnsubs = new Map();

let loaded = {
  teams: false,
  sports: false,
  stages: false
};

// ===== 共通関数 =====

function el(tag, options = {}, children = []) {
  const node = document.createElement(tag);

  if (options.className) node.className = options.className;
  if (options.text !== undefined) node.textContent = String(options.text);
  if (options.id) node.id = options.id;
  if (options.colSpan) node.colSpan = options.colSpan;

  children.forEach((child) => {
    if (child instanceof Node) {
      node.appendChild(child);
    } else {
      node.appendChild(document.createTextNode(String(child)));
    }
  });

  return node;
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

function getTeamOrder(teamId) {
  const order = Number(teamsMap.get(teamId)?.order);
  return Number.isFinite(order) ? order : 999999;
}

function getSportName(sportId) {
  return sportsMap.get(sportId)?.name || sportId || "";
}

function formatScore(value) {
  return value === null || value === undefined ? "-" : String(value);
}

function formatTimestamp(value) {
  if (!value) return "";

  let date = null;

  if (typeof value.toDate === "function") {
    date = value.toDate();
  } else if (value instanceof Date) {
    date = value;
  } else if (typeof value.seconds === "number") {
    date = new Date(value.seconds * 1000);
  }

  if (!date) return "";

  return new Intl.DateTimeFormat("ja-JP", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function updateViewerStatus() {
  if (!viewerStatusEl) return;

  if (!loaded.teams || !loaded.sports || !loaded.stages) {
    viewerStatusEl.textContent = "読み込み中...";
    return;
  }

  const now = new Intl.DateTimeFormat("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date());

  viewerStatusEl.textContent =
    `表示更新：${now} / 公開中の表：${stages.length}件`;
}

function showViewerError(message) {
  if (!viewerErrorEl) return;

  viewerErrorEl.hidden = false;
  viewerErrorEl.textContent = message;
}

function clearViewerError() {
  if (!viewerErrorEl) return;

  viewerErrorEl.hidden = true;
  viewerErrorEl.textContent = "";
}

function makeBadge(text, className = "badge badge-muted") {
  return el("span", {
    className,
    text
  });
}

function makeTable(headers, rows) {
  const wrap = el("div", { className: "table-wrap" });
  const table = el("table");
  const thead = el("thead");
  const tbody = el("tbody");

  const headerTr = el("tr");

  headers.forEach((header) => {
    headerTr.appendChild(el("th", { text: header }));
  });

  thead.appendChild(headerTr);

  rows.forEach((row) => {
    const tr = el("tr");

    row.forEach((cell) => {
      const td = el("td", {
        text: cell === null || cell === undefined ? "" : cell
      });

      tr.appendChild(td);
    });

    tbody.appendChild(tr);
  });

  table.appendChild(thead);
  table.appendChild(tbody);
  wrap.appendChild(table);

  return wrap;
}

// ===== Firestore 監視 =====

onSnapshot(
  collection(db, "teams"),
  (snapshot) => {
    teams = snapshot.docs.map((docSnap) => ({
      id: docSnap.id,
      ...docSnap.data()
    }));

    teams = sortByOrderAndName(teams);
    teamsMap = new Map(teams.map((team) => [team.id, team]));

    loaded.teams = true;
    updateViewerStatus();
    render();
  },
  (error) => {
    console.error(error);
    showViewerError(`チームデータの取得に失敗しました：${error.message}`);
  }
);

onSnapshot(
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

    loaded.sports = true;
    updateViewerStatus();
    render();
  },
  (error) => {
    console.error(error);
    showViewerError(`競技データの取得に失敗しました：${error.message}`);
  }
);

const publicStagesQuery = query(
  collection(db, "stages"),
  where("visibility", "==", "public"),
  where("hidden", "==", false)
);

onSnapshot(
  publicStagesQuery,
  (snapshot) => {
    clearViewerError();

    stages = snapshot.docs.map((docSnap) => ({
      id: docSnap.id,
      ...docSnap.data()
    }));

    stages = sortByOrderAndName(stages);

    loaded.stages = true;

    updateStageChildListeners();
    updateViewerStatus();
    render();
  },
  (error) => {
    console.error(error);

    showViewerError(
      `公開中の表の取得に失敗しました：${error.code || ""} ${error.message}`
    );
  }
);

// ===== 各表の子データ監視 =====

function updateStageChildListeners() {
  const currentStageIds = new Set(stages.map((stage) => stage.id));

  for (const [stageId, info] of childUnsubs.entries()) {
    if (!currentStageIds.has(stageId)) {
      info.unsubscribe();
      childUnsubs.delete(stageId);
      stageData.delete(stageId);
    }
  }

  stages.forEach((stage) => {
    const existing = childUnsubs.get(stage.id);

    if (existing && existing.type === stage.type) {
      return;
    }

    if (existing) {
      existing.unsubscribe();
      childUnsubs.delete(stage.id);
    }

    startStageChildListener(stage);
  });
}

function ensureStageData(stageId) {
  if (!stageData.has(stageId)) {
    stageData.set(stageId, {
      matches: [],
      rankingEntries: []
    });
  }

  return stageData.get(stageId);
}

function startStageChildListener(stage) {
  ensureStageData(stage.id);

  if (stage.type === "league" || stage.type === "tournament") {
    const unsubscribe = onSnapshot(
      collection(db, "stages", stage.id, "matches"),
      (snapshot) => {
        const data = ensureStageData(stage.id);

        data.matches = snapshot.docs
          .map((docSnap) => ({
            id: docSnap.id,
            ...docSnap.data()
          }))
          .filter((match) => match.type === stage.type)
          .sort((a, b) => {
            const orderA = Number(a.order ?? a.matchNo ?? 999999);
            const orderB = Number(b.order ?? b.matchNo ?? 999999);
            return orderA - orderB;
          });

        updateViewerStatus();
        render();
      },
      (error) => {
        console.error(error);
        showViewerError(`試合データの取得に失敗しました：${error.message}`);
      }
    );

    childUnsubs.set(stage.id, {
      type: stage.type,
      unsubscribe
    });

    return;
  }

  if (stage.type === "ranking") {
    const unsubscribe = onSnapshot(
      collection(db, "stages", stage.id, "rankingEntries"),
      (snapshot) => {
        const data = ensureStageData(stage.id);

        data.rankingEntries = snapshot.docs
          .map((docSnap) => ({
            id: docSnap.id,
            ...docSnap.data()
          }))
          .sort((a, b) => {
            const orderDiff = orderValue(a) - orderValue(b);
            if (orderDiff !== 0) return orderDiff;

            return getTeamOrder(a.teamId) - getTeamOrder(b.teamId);
          });

        updateViewerStatus();
        render();
      },
      (error) => {
        console.error(error);
        showViewerError(`順位データの取得に失敗しました：${error.message}`);
      }
    );

    childUnsubs.set(stage.id, {
      type: stage.type,
      unsubscribe
    });
  }
}

// ===== 全体描画 =====

function render() {
  if (!appEl) return;

  appEl.replaceChildren();

  if (!loaded.teams || !loaded.sports || !loaded.stages) {
    appEl.appendChild(
      el("section", { className: "card", text: "読み込み中..." })
    );
    return;
  }

  if (stages.length === 0) {
    appEl.appendChild(
      el("section", {
        className: "card empty-message",
        text: "現在、公開中の表はありません。"
      })
    );
    return;
  }

  const stagesBySportId = new Map();

  stages.forEach((stage) => {
    const sportId = stage.sportId || "other";

    if (!stagesBySportId.has(sportId)) {
      stagesBySportId.set(sportId, []);
    }

    stagesBySportId.get(sportId).push(stage);
  });

  const orderedSportIds = [];

  sports.forEach((sport) => {
    if (stagesBySportId.has(sport.id)) {
      orderedSportIds.push(sport.id);
    }
  });

  for (const sportId of stagesBySportId.keys()) {
    if (!orderedSportIds.includes(sportId)) {
      orderedSportIds.push(sportId);
    }
  }

  orderedSportIds.forEach((sportId) => {
    const sportStages = sortByOrderAndName(stagesBySportId.get(sportId) || []);

    const section = el("section", {
      className: "viewer-sport-section card"
    });

    section.appendChild(
      el("h2", {
        text: getSportName(sportId)
      })
    );

    sportStages.forEach((stage) => {
      section.appendChild(renderStage(stage));
    });

    appEl.appendChild(section);
  });
}

function renderStage(stage) {
  const card = el("article", {
    className: "viewer-stage-card"
  });

  const header = el("div", {
    className: "viewer-stage-header"
  });

  const titleWrap = el("div");

  titleWrap.appendChild(
    el("h3", {
      text: stage.name || "名称未設定"
    })
  );

  const meta = el("div", {
    className: "viewer-stage-meta"
  });

  meta.appendChild(
    makeBadge(STAGE_TYPE_LABELS[stage.type] || stage.type || "", "badge badge-info")
  );

  meta.appendChild(
    makeBadge("公開中", "badge badge-active")
  );

  const updatedText = formatTimestamp(stage.updatedAt);

  if (updatedText) {
    meta.appendChild(
      makeBadge(`更新：${updatedText}`, "badge badge-muted")
    );
  }

  titleWrap.appendChild(meta);
  header.appendChild(titleWrap);
  card.appendChild(header);

  if (stage.type === "league") {
    card.appendChild(renderLeagueStage(stage));
  } else if (stage.type === "tournament") {
    card.appendChild(renderTournamentStage(stage));
  } else if (stage.type === "ranking") {
    card.appendChild(renderRankingStage(stage));
  } else {
    card.appendChild(
      el("p", {
        text: "未対応の表タイプです。"
      })
    );
  }

  return card;
}

// ===== リーグ戦表示 =====

function renderLeagueStage(stage) {
  const wrapper = el("div");

  const data = stageData.get(stage.id) || { matches: [] };
  const matches = data.matches || [];

  const standings = computeLeagueStandings(stage, matches);

  wrapper.appendChild(
    el("h4", {
      className: "viewer-table-title",
      text: "順位表"
    })
  );

  if (standings.length === 0) {
    wrapper.appendChild(
      el("p", {
        className: "empty-message",
        text: "順位表データがありません。"
      })
    );
  } else {
    wrapper.appendChild(
      makeTable(
        ["順位", "チーム", "試合", "勝", "分", "負", "得点", "失点", "得失点差", "勝点"],
        standings.map((row) => [
          `${row.displayRank}位`,
          getTeamName(row.teamId),
          row.played,
          row.wins,
          row.draws,
          row.losses,
          row.goalsFor,
          row.goalsAgainst,
          row.goalDifference,
          row.points
        ])
      )
    );
  }

  wrapper.appendChild(
    el("h4", {
      className: "viewer-table-title",
      text: "試合結果"
    })
  );

  if (matches.length === 0) {
    wrapper.appendChild(
      el("p", {
        className: "empty-message",
        text: "試合データがまだありません。"
      })
    );
  } else {
    wrapper.appendChild(
      makeTable(
        ["No", "対戦", "スコア", "状態"],
        matches.map((match, index) => [
          match.matchNo ?? index + 1,
          `${getTeamName(match.teamAId)} vs ${getTeamName(match.teamBId)}`,
          `${formatScore(match.scoreA)} - ${formatScore(match.scoreB)}`,
          STATUS_LABELS[match.status] || match.status || ""
        ])
      )
    );
  }

  return wrapper;
}

function computeLeagueStandings(stage, matches) {
  const teamIds = Array.isArray(stage.teamIds) ? stage.teamIds : [];
  const manualRanks = stage.manualRanks || {};

  const statsMap = new Map();

  function normalizeManualRank(value) {
    const n = Number(value);
    return Number.isInteger(n) && n > 0 ? n : null;
  }

  function manualRankForSort(value) {
    const n = normalizeManualRank(value);
    return n === null ? Infinity : n;
  }

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

  matches.forEach((match) => {
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

  function compareHeadToHead(teamAId, teamBId) {
    let aPoints = 0;
    let bPoints = 0;
    let aGoalDiff = 0;
    let bGoalDiff = 0;
    let aGoalsFor = 0;
    let bGoalsFor = 0;
    let played = 0;

    matches.forEach((match) => {
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

  function compareRows(a, b) {
    if (b.points !== a.points) return b.points - a.points;
    if (b.goalDifference !== a.goalDifference) return b.goalDifference - a.goalDifference;
    if (b.goalsFor !== a.goalsFor) return b.goalsFor - a.goalsFor;

    const headToHead = compareHeadToHead(a.teamId, b.teamId);
    if (headToHead !== 0) return headToHead;

    const manualA = manualRankForSort(a.manualRank);
    const manualB = manualRankForSort(b.manualRank);

    if (manualA !== manualB) return manualA - manualB;

    const orderDiff = getTeamOrder(a.teamId) - getTeamOrder(b.teamId);
    if (orderDiff !== 0) return orderDiff;

    return getTeamName(a.teamId).localeCompare(getTeamName(b.teamId), "ja");
  }

  function isSameRank(a, b) {
    if (a.points !== b.points) return false;
    if (a.goalDifference !== b.goalDifference) return false;
    if (a.goalsFor !== b.goalsFor) return false;

    if (compareHeadToHead(a.teamId, b.teamId) !== 0) return false;

    const manualA = normalizeManualRank(a.manualRank);
    const manualB = normalizeManualRank(b.manualRank);

    return manualA === manualB;
  }

  rows.sort(compareRows);

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

// ===== トーナメント表示 =====

function renderTournamentStage(stage) {
  const wrapper = el("div");

  const data = stageData.get(stage.id) || { matches: [] };
  const matches = data.matches || [];

  if (matches.length === 0) {
    wrapper.appendChild(
      el("p", {
        className: "empty-message",
        text: "トーナメント試合がまだ作成されていません。"
      })
    );
    return wrapper;
  }

  const mainMatches = matches.filter((match) => match.bracketType === "main");
  const thirdPlaceMatches = matches.filter(
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

    wrapper.appendChild(
      el("h4", {
        className: "viewer-table-title",
        text: title
      })
    );

    wrapper.appendChild(renderTournamentMatchTable(roundMatches));
  });

  if (thirdPlaceMatches.length > 0) {
    wrapper.appendChild(
      el("h4", {
        className: "viewer-table-title",
        text: "3位決定戦"
      })
    );

    wrapper.appendChild(renderTournamentMatchTable(thirdPlaceMatches));
  }

  return wrapper;
}

function renderTournamentMatchTable(matches) {
  return makeTable(
    ["試合", "A", "スコア", "B", "状態", "勝者"],
    matches.map((match) => {
      const label =
        match.bracketType === "third_place"
          ? "3位決定戦"
          : `第${match.matchIndex}試合`;

      const teamA = formatTournamentTeam(match.teamAId, match.winnerId);
      const teamB = formatTournamentTeam(match.teamBId, match.winnerId);

      return [
        label,
        teamA,
        `${formatScore(match.scoreA)} - ${formatScore(match.scoreB)}`,
        teamB,
        getTournamentStatusLabel(match),
        match.winnerId ? getTeamName(match.winnerId) : "-"
      ];
    })
  );
}

function formatTournamentTeam(teamId, winnerId) {
  if (!teamId) return "未定";

  const name = getTeamName(teamId);

  if (winnerId === teamId) {
    return `★ ${name}`;
  }

  return name;
}

function getTournamentStatusLabel(match) {
  const hasA = Boolean(match.teamAId);
  const hasB = Boolean(match.teamBId);

  if (match.status === "finished" && match.winnerId && hasA !== hasB) {
    return "不戦勝";
  }

  return STATUS_LABELS[match.status] || match.status || "";
}

// ===== 順位入力型表示 =====

function renderRankingStage(stage) {
  const wrapper = el("div");

  const data = stageData.get(stage.id) || { rankingEntries: [] };
  const entries = data.rankingEntries || [];

  const rows = buildRankingDisplayRows(stage, entries);

  if (rows.length === 0) {
    wrapper.appendChild(
      el("p", {
        className: "empty-message",
        text: "順位データがまだありません。"
      })
    );

    return wrapper;
  }

  wrapper.appendChild(
    makeTable(
      ["表示", "チーム", "状態"],
      rows.map((row) => [
        row.displayText,
        getTeamName(row.teamId),
        row.statusText
      ])
    )
  );

  return wrapper;
}

function buildRankingDisplayRows(stage, entries) {
  const teamIds = Array.isArray(stage.teamIds) ? stage.teamIds : [];

  const entryByTeamId = new Map();

  entries.forEach((entry) => {
    if (entry.teamId) {
      entryByTeamId.set(entry.teamId, entry);
    }
  });

  const formRows = teamIds.map((teamId, index) => {
    const entry = entryByTeamId.get(teamId);

    return {
      teamId,
      order: entry?.order || index + 1,
      rank: entry?.rank ?? null,
      status: entry?.status || "normal"
    };
  });

  const normalRanked = formRows
    .filter((row) => row.status === "normal" && row.rank !== null)
    .sort((a, b) => {
      if (Number(a.rank) !== Number(b.rank)) {
        return Number(a.rank) - Number(b.rank);
      }

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

  const displayRows = [];

  let previousInputRank = null;
  let currentDisplayRank = 0;

  normalRanked.forEach((row, index) => {
    if (Number(row.rank) !== Number(previousInputRank)) {
      currentDisplayRank = index + 1;
      previousInputRank = row.rank;
    }

    displayRows.push({
      ...row,
      displayText: `${currentDisplayRank}位`,
      statusText: "通常"
    });
  });

  normalUnranked.forEach((row) => {
    displayRows.push({
      ...row,
      displayText: "未入力",
      statusText: "通常"
    });
  });

  withdrawn.forEach((row) => {
    displayRows.push({
      ...row,
      displayText: "棄権",
      statusText: RANKING_STATUS_LABELS.withdrawn
    });
  });

  disqualified.forEach((row) => {
    displayRows.push({
      ...row,
      displayText: "失格",
      statusText: RANKING_STATUS_LABELS.disqualified
    });
  });

  return displayRows;
}
