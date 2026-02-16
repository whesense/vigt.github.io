// shared/iframe_autoheight.js
// Posts the iframe document height to the parent so the parent page can resize the iframe.
// Works same-origin and cross-origin (via postMessage); parent matches by contentWindow.

function isEmbeddedFrame() {
  try {
    return window.self !== window.top;
  } catch (_) {
    return true;
  }
}

function syncEmbeddedClass() {
  const embedded = isEmbeddedFrame();
  if (document.documentElement) {
    document.documentElement.classList.toggle("is-embedded", embedded);
  }
  if (document.body) {
    document.body.classList.toggle("is-embedded", embedded);
  }
}

function measureHeight() {
  const de = document.documentElement;
  const b = document.body;
  const h1 = de ? de.scrollHeight : 0;
  const h2 = de ? de.offsetHeight : 0;
  const h3 = b ? b.scrollHeight : 0;
  const h4 = b ? b.offsetHeight : 0;
  return Math.max(h1, h2, h3, h4, 0);
}

function clampHeight(h) {
  const raw = Number(h);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  // Keep only a broad safety bound; do not cap near viewport height,
  // otherwise taller demos get clipped on mobile.
  const cap = 12000;
  return Math.max(200, Math.min(Math.round(raw), cap));
}

let lastSent = 0;
let rafId = null;
let warmupTimer = null;
function sendHeightSoon() {
  if (rafId != null) return;
  rafId = requestAnimationFrame(() => {
    rafId = null;
    const h = clampHeight(measureHeight());
    if (!h || Math.abs(h - lastSent) < 2) return;
    lastSent = h;
    window.parent?.postMessage(
      {
        type: "vigt:iframeHeight",
        height: h,
      },
      "*"
    );
  });
}

function startWarmupPings(durationMs = 8000, periodMs = 250) {
  if (warmupTimer != null) {
    clearInterval(warmupTimer);
    warmupTimer = null;
  }
  const maxTicks = Math.max(1, Math.ceil(durationMs / periodMs));
  let ticks = 0;
  warmupTimer = setInterval(() => {
    ticks += 1;
    sendHeightSoon();
    if (ticks >= maxTicks) {
      clearInterval(warmupTimer);
      warmupTimer = null;
    }
  }, periodMs);
}

// Initial + reactive updates
window.addEventListener("load", () => {
  syncEmbeddedClass();
  sendHeightSoon();
  startWarmupPings();
});
window.addEventListener("resize", sendHeightSoon);
window.addEventListener("orientationchange", () => {
  syncEmbeddedClass();
  sendHeightSoon();
  startWarmupPings(3000, 250);
});
window.addEventListener("pageshow", () => {
  syncEmbeddedClass();
  sendHeightSoon();
  startWarmupPings(3000, 250);
});
document.addEventListener("DOMContentLoaded", () => {
  syncEmbeddedClass();
  sendHeightSoon();
  startWarmupPings();
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") sendHeightSoon();
});

if ("ResizeObserver" in window) {
  const ro = new ResizeObserver(() => sendHeightSoon());
  if (document.documentElement) ro.observe(document.documentElement);
  if (document.body) ro.observe(document.body);
}

// Fonts can shift layout after load.
if (document.fonts && "addEventListener" in document.fonts) {
  document.fonts.addEventListener("loadingdone", sendHeightSoon);
}

// Kick once right away.
syncEmbeddedClass();
sendHeightSoon();
