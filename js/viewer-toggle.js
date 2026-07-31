const STORAGE_PREFIX = "viewer-sport-collapsed:";

function safeGetStorage(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSetStorage(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // localStorage が使えない環境では何もしない
  }
}

function setSportCollapsed(section, collapsed) {
  const button = section.querySelector(":scope > .viewer-sport-toggle");
  const title = section.querySelector(":scope > .viewer-sport-title");

  section.classList.toggle("is-collapsed", collapsed);

  if (button) {
    button.textContent = collapsed ? "表示" : "非表示";
    button.setAttribute("aria-expanded", String(!collapsed));
  }

  if (title && button) {
    const sportName = title.textContent.trim();
    button.setAttribute(
      "aria-label",
      collapsed ? `${sportName}を表示する` : `${sportName}を非表示にする`
    );
  }
}

function enhanceSportSection(section) {
  // すでにボタンが付いている場合は何もしない
  if (section.querySelector(":scope > .viewer-sport-toggle")) {
    return;
  }

  const title = section.querySelector(
    ":scope > .viewer-sport-title, :scope > h2, :scope > h3"
  );

  if (!title) {
    return;
  }

  const sportName = title.textContent.trim();

  // マーカーCSSが効くようにタイトル用クラスを付ける
  title.classList.add("viewer-sport-title");

  const button = document.createElement("button");
  button.type = "button";
  button.className = "viewer-sport-toggle";

  title.insertAdjacentElement("afterend", button);

  const storageKey = STORAGE_PREFIX + sportName;
  const savedValue = safeGetStorage(storageKey);

  // 初期状態は「表示」
  const initialCollapsed = savedValue === "1";
  setSportCollapsed(section, initialCollapsed);

  button.addEventListener("click", () => {
    const nextCollapsed = !section.classList.contains("is-collapsed");

    setSportCollapsed(section, nextCollapsed);
    safeSetStorage(storageKey, nextCollapsed ? "1" : "0");
  });
}

function enhanceSportSections() {
  const sections = document.querySelectorAll("#viewer-app .viewer-sport-section");

  sections.forEach((section) => {
    enhanceSportSection(section);
  });
}

function initSportToggle() {
  enhanceSportSections();

  const viewerApp = document.getElementById("viewer-app");

  if (!viewerApp) {
    return;
  }

  // viewer.js が後から結果を描画する場合にも対応
  const observer = new MutationObserver(() => {
    enhanceSportSections();
  });

  observer.observe(viewerApp, {
    childList: true,
    subtree: true,
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initSportToggle);
} else {
  initSportToggle();
}
