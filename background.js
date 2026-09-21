// Download Router — Background Service Worker (MV3)
//
// Routing happens in chrome.downloads.onDeterminingFilename, which fires while
// Chrome is still deciding where to put the file. That is the only supported
// hook for changing a download's path; there is no downloads.rename() API.

const DEFAULT_RULES = [
  {
    type: "extension",
    value: ".pdf",
    folder: "documents",
    priority: 1,
    enabled: true,
  },
  {
    type: "domain",
    value: "unsplash.com",
    folder: "images",
    priority: 2,
    enabled: true,
  },
];

const CONTEXT_MENUS = [
  { id: "route-image", title: "Save image with Router", contexts: ["image"] },
  { id: "route-link", title: "Save link with Router", contexts: ["link"] },
  { id: "route-video", title: "Save video with Router", contexts: ["video"] },
  { id: "route-audio", title: "Save audio with Router", contexts: ["audio"] },
];

// ── RULE CACHE ────────────────────────────────────────────────────────────────
// The service worker sleeps between downloads, so the cache is often cold. Keep
// a sync fast path for warm workers and fall back to an async read otherwise.
let rulesCache = null;
let rulesPromise = null;

function loadRules() {
  if (rulesCache) return Promise.resolve(rulesCache);
  if (!rulesPromise) {
    rulesPromise = chrome.storage.sync
      .get({ rules: [] })
      .then(({ rules }) => {
        rulesCache = Array.isArray(rules) ? rules : [];
        rulesPromise = null;
        return rulesCache;
      })
      .catch(() => {
        rulesPromise = null;
        return [];
      });
  }
  return rulesPromise;
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync" || !changes.rules) return;
  rulesCache = Array.isArray(changes.rules.newValue)
    ? changes.rules.newValue
    : [];
});

// ── SETUP ─────────────────────────────────────────────────────────────────────
function newId() {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : `r-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function buildContextMenus() {
  chrome.contextMenus.removeAll(() => {
    void chrome.runtime.lastError;
    for (const menu of CONTEXT_MENUS) {
      chrome.contextMenus.create(menu, () => void chrome.runtime.lastError);
    }
  });
}

chrome.runtime.onInstalled.addListener((details) => {
  buildContextMenus();

  if (details?.reason !== "install") return;

  chrome.storage.sync.get({ rules: [] }, ({ rules }) => {
    if (Array.isArray(rules) && rules.length > 0) return;
    chrome.storage.sync.set({
      rules: DEFAULT_RULES.map((rule) => ({ id: newId(), ...rule })),
    });
  });
});

chrome.runtime.onStartup?.addListener(() => {
  buildContextMenus();
  loadRules();
});

// ── URL / PATH HELPERS ────────────────────────────────────────────────────────
function normalizeHostname(value) {
  let v = String(value ?? "").trim();
  if (!v) return "";

  // blob:https://site.com/uuid — unwrap to the origin that created it
  if (/^blob:/i.test(v)) v = v.slice(5);
  if (/^(data|chrome|about|file):/i.test(v)) return "";

  try {
    const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(v);
    v = new URL(hasScheme ? v : `https://${v}`).hostname;
  } catch {
    v = v.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, "");
    v = v.split(/[/?#]/)[0];
    v = v.split("@").pop() || "";
    v = v.replace(/:\d+$/, "");
  }

  return v.replace(/^www\./i, "").toLowerCase();
}

// Strips control characters and anything Windows or macOS rejects in a name.
function sanitizeSegment(segment) {
  return String(segment)
    .replace(/[\u0000-\u001f<>:"|?*\\]/g, "")
    .replace(/[.\s]+$/, "") // trailing dots and spaces break on Windows
    .trim();
}

function sanitizeFolder(folder) {
  return String(folder ?? "")
    .replace(/\\/g, "/")
    .split("/")
    .map(sanitizeSegment)
    .filter((seg) => seg && !/^\.+$/.test(seg)) // drops "." and ".." traversal
    .join("/");
}

function sanitizeFilename(name) {
  const clean = sanitizeSegment(name).slice(0, 180);
  return clean || "download";
}

function basenameOf(path) {
  return (
    String(path ?? "")
      .split(/[\\/]/)
      .pop() || ""
  );
}

function extensionOf(basename) {
  return basename.includes(".")
    ? "." + basename.split(".").pop().toLowerCase()
    : "";
}

// Downloads this extension started itself (exporting rules, for instance)
// must never be rerouted.
function isOwnDownload(item) {
  const url = item?.url || "";
  return (
    item?.byExtension?.id === chrome.runtime.id ||
    url.includes(`extension://${chrome.runtime.id}`)
  );
}

// ── MATCHING ──────────────────────────────────────────────────────────────────
// Remembers which page a context-menu download came from, so a domain rule can
// match the site you were on even when the file itself lives on a CDN.
const originHints = new Map();

function rememberOrigin(url, pageUrl) {
  if (!url || !pageUrl) return;
  originHints.set(url, { pageUrl, at: Date.now() });
  const cutoff = Date.now() - 60_000;
  for (const [key, val] of originHints) {
    if (val.at < cutoff) originHints.delete(key);
  }
}

function hostnamesFor(downloadItem) {
  const hint = originHints.get(downloadItem.url)?.pageUrl;
  const hosts = new Set();
  for (const candidate of [
    downloadItem.finalUrl,
    downloadItem.url,
    downloadItem.referrer,
    hint,
  ]) {
    const host = normalizeHostname(candidate);
    if (host) hosts.add(host);
  }
  return [...hosts];
}

function ruleMatches(rule, ctx) {
  if (rule.type === "domain") {
    const ruleHost = normalizeHostname(rule.value);
    if (!ruleHost) return false;
    return ctx.hostnames.some(
      (host) => host === ruleHost || host.endsWith("." + ruleHost),
    );
  }

  if (rule.type === "extension") {
    const raw = String(rule.value ?? "")
      .trim()
      .toLowerCase();
    if (!raw) return false;
    const ruleExt = raw.startsWith(".") ? raw : "." + raw;
    return ctx.extension === ruleExt;
  }

  if (rule.type === "pattern") {
    try {
      const re = new RegExp(rule.value, "i");
      return re.test(ctx.basename) || re.test(ctx.url);
    } catch {
      return false; // an invalid regex simply never matches
    }
  }

  return false;
}

function computeRoutedPath(downloadItem, rules) {
  if (!Array.isArray(rules) || !rules.length) return null;

  const basename = sanitizeFilename(basenameOf(downloadItem.filename));
  const ctx = {
    url: downloadItem.finalUrl || downloadItem.url || "",
    basename,
    extension: extensionOf(basename),
    hostnames: hostnamesFor(downloadItem),
  };

  const sorted = [...rules].sort(
    (a, b) => (a.priority ?? 999) - (b.priority ?? 999),
  );

  for (const rule of sorted) {
    if (rule.enabled === false) continue;
    if (!ruleMatches(rule, ctx)) continue;

    const folder = sanitizeFolder(rule.folder);
    if (!folder) return null; // rule points at the Downloads root: nothing to do
    return `${folder}/${basename}`;
  }

  return null;
}

// ── INTERCEPTION ──────────────────────────────────────────────────────────────
function suggestionFor(downloadItem, rules) {
  if (isOwnDownload(downloadItem)) return null;
  const filename = computeRoutedPath(downloadItem, rules);
  return filename ? { filename, conflictAction: "uniquify" } : null;
}

if (chrome.downloads.onDeterminingFilename) {
  chrome.downloads.onDeterminingFilename.addListener(
    (downloadItem, suggest) => {
      // Warm worker: answer synchronously so Chrome never races us.
      if (rulesCache) {
        const suggestion = suggestionFor(downloadItem, rulesCache);
        if (suggestion) suggest(suggestion);
        else suggest();
        return;
      }

      // Cold worker: returning true parks the download until we answer.
      loadRules()
        .then((rules) => {
          const suggestion = suggestionFor(downloadItem, rules);
          if (suggestion) suggest(suggestion);
          else suggest();
        })
        .catch(() => suggest());

      return true;
    },
  );
} else if (chrome.downloads.onCreated) {
  // Firefox has no onDeterminingFilename, so restart the download with the
  // routed path instead. Only safe for plain http(s) GETs; anything else is
  // left alone rather than risking a broken re-request.
  chrome.downloads.onCreated.addListener(async (downloadItem) => {
    if (isOwnDownload(downloadItem)) return;
    if (!/^https?:/i.test(downloadItem.url || "")) return;

    const rules = await loadRules();
    const filename = computeRoutedPath(downloadItem, rules);
    if (!filename) return;

    try {
      await chrome.downloads.cancel(downloadItem.id);
      await chrome.downloads.erase({ id: downloadItem.id });
      await chrome.downloads.download({
        url: downloadItem.url,
        filename,
        conflictAction: "uniquify",
      });
    } catch {
      /* already finished, or cancelled by the user */
    }
  });
}

// ── CONTEXT MENU ──────────────────────────────────────────────────────────────
function guessFilename(url) {
  try {
    return decodeURIComponent(basenameOf(new URL(url).pathname)) || "download";
  } catch {
    return "download";
  }
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!CONTEXT_MENUS.some((menu) => menu.id === info.menuItemId)) return;

  const url = info.srcUrl || info.linkUrl;
  if (!url) return;

  const pageUrl = info.pageUrl || tab?.url;
  rememberOrigin(url, pageUrl);

  // Resolve the path up front as well as relying on interception, so the menu
  // still routes correctly on browsers that cannot intercept downloads.
  const rules = await loadRules();
  const filename = computeRoutedPath(
    { url, finalUrl: url, referrer: pageUrl, filename: guessFilename(url) },
    rules,
  );

  chrome.downloads.download(
    filename ? { url, filename, conflictAction: "uniquify" } : { url },
    () => void chrome.runtime.lastError,
  );
});

loadRules();
