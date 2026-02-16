const INVIDEO_BASE = "https://invideochat.vercel.app";

function buildInVideoUrl() {
  const params = new URLSearchParams(window.location.search);
  const videoId = params.get("v");
  if (!videoId) return null;

  const url = new URL(`${INVIDEO_BASE}/watch`);
  url.searchParams.set("v", videoId);
  url.searchParams.set("autoplay", "1");

  const t = params.get("t");
  if (t) url.searchParams.set("t", t);

  const list = params.get("list");
  if (list) url.searchParams.set("list", list);

  return url.toString();
}

/** Pause the YouTube video reliably */
function pauseYouTubeVideo() {
  const video = document.querySelector("video");
  if (video && !video.paused) {
    video.pause();
  }
}

/**
 * Find the actions container next to Like/Share/Save.
 * YouTube changes DOM frequently — try multiple selectors in priority order.
 */
function findActionsBar() {
  const selectors = [
    "ytd-watch-metadata #actions #top-level-buttons-computed",
    "ytd-watch-metadata #actions ytd-menu-renderer #top-level-buttons-computed",
    "#actions ytd-menu-renderer #top-level-buttons-computed",
    "ytd-watch-metadata #actions-inner #menu ytd-menu-renderer #top-level-buttons-computed",
    "#top-level-buttons-computed",
    "ytd-watch-metadata #actions-inner #menu ytd-menu-renderer",
    "ytd-watch-metadata #actions ytd-menu-renderer",
    "#info #menu-container ytd-menu-renderer #top-level-buttons-computed",
    "ytd-watch-metadata ytd-menu-renderer",
  ];

  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el) return el;
  }
  return null;
}

function injectButton() {
  if (document.getElementById("invideo-button")) return;

  const actionsBar = findActionsBar();
  if (!actionsBar) return false;

  const invideoUrl = buildInVideoUrl();
  if (!invideoUrl) return false;

  const btn = document.createElement("a");
  btn.id = "invideo-button";
  btn.href = invideoUrl;
  btn.target = "_blank";
  btn.rel = "noopener";
  btn.className = "invideo-yt-btn";

  // ChalkboardSimple ↔ Chalkboard hover swap (matches ChalkIcon.tsx)
  btn.innerHTML =
    '<span class="invideo-icon-wrap">' +
    '<svg viewBox="0 0 256 256" width="24" height="24" class="invideo-yt-icon invideo-icon-simple">' +
    '<path d="M240,192h-8V168a8,8,0,0,0-8-8H160a8,8,0,0,0-8,8v24H40V56H216v80a8,8,0,0,0,16,0V56a16,16,0,0,0-16-16H40A16,16,0,0,0,24,56V192H16a8,8,0,0,0,0,16H240a8,8,0,0,0,0-16Zm-72-16h48v16H168Z" fill="currentColor"/>' +
    "</svg>" +
    '<svg viewBox="0 0 256 256" width="24" height="24" class="invideo-yt-icon invideo-icon-full">' +
    '<path d="M240,192h-8V56a16,16,0,0,0-16-16H40A16,16,0,0,0,24,56V192H16a8,8,0,0,0,0,16H240a8,8,0,0,0,0-16ZM40,56H216V192H200V168a8,8,0,0,0-8-8H120a8,8,0,0,0-8,8v24H72V88H184v48a8,8,0,0,0,16,0V80a8,8,0,0,0-8-8H64a8,8,0,0,0-8,8V192H40ZM184,192H128V176h56Z" fill="currentColor"/>' +
    "</svg>" +
    "</span>" +
    "<span>InVideo</span>";

  btn.addEventListener("click", (e) => {
    pauseYouTubeVideo();
  });

  actionsBar.appendChild(btn);
  return true;
}

// Retry injection with increasing delays (YouTube renders async)
function injectWithRetry(attempts = 0) {
  if (attempts > 20) return;
  if (document.getElementById("invideo-button")) return;
  if (window.location.pathname !== "/watch") return;

  if (!injectButton()) {
    setTimeout(() => injectWithRetry(attempts + 1), 500 + attempts * 200);
  }
}

// YouTube is an SPA — re-inject on client-side navigation
let lastUrl = location.href;
const observer = new MutationObserver(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    const old = document.getElementById("invideo-button");
    if (old) old.remove();
  }
  if (window.location.pathname === "/watch") {
    injectButton();
  }
});
observer.observe(document.body, { childList: true, subtree: true });

// Initial injection with retry
injectWithRetry();
