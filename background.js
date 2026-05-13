// Download Router - Background Service Worker

// ── CONTEXT MENU ─────────────────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener((details) => {
  chrome.contextMenus.create({
    id: "save-with-router",
    title: "Save Image with Router", // ⬇
    contexts: ["image"],
  });

  if (details?.reason !== "install") return;

  chrome.storage.sync.get({ rules: [] }, ({ rules }) => {
    if (Array.isArray(rules) && rules.length > 0) return;

    chrome.storage.sync.set({
      rules: [
        {
          id: crypto.randomUUID(),
          type: "extension",
          value: ".pdf",
          folder: "documents",
          priority: 1,
          enabled: true,
        },
        {
          id: crypto.randomUUID(),
          type: "domain",
          value: "unsplash.com",
          folder: "images",
          priority: 2,
          enabled: true,
        },
      ],
    });
  });
});

chrome.contextMenus.onClicked.addListener((info, _tab) => {
  if (info.menuItemId === "save-with-router" && info.srcUrl) {
    chrome.downloads.download({ url: info.srcUrl });
  }
});

function normalizeHostname(value) {
  let v = String(value ?? "").trim();
  if (!v) return "";

  try {
    const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(v);
    v = new URL(hasScheme ? v : `https://${v}`).hostname;
  } catch {
    v = v.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, "");
    v = v.split(/[/?#]/)[0];
    v = v.split("@").pop() || "";
    v = v.replace(/:\d+$/, "");
  }

  v = v.replace(/^www\./i, "").toLowerCase();
  return v;
}

// ── DOWNLOAD INTERCEPTION ─────────────────────────────────────────────────────
function computeRoutedPath(downloadItem, rules) {
  if (!rules?.length) return null;

  const sorted = [...rules].sort((a, b) => a.priority - b.priority);

  const url = downloadItem.url || "";
  const fullFilename = downloadItem.filename || "";
  const baseFilename = fullFilename.split(/[\\/]/).pop() || "";
  const extension = baseFilename.includes(".")
    ? "." + baseFilename.split(".").pop().toLowerCase()
    : "";

  const hostname = normalizeHostname(url);

  for (const rule of sorted) {
    if (rule.enabled === false) continue;

    let matched = false;

    if (rule.type === "domain") {
      const ruleHost = normalizeHostname(rule.value);
      matched =
        !!ruleHost &&
        !!hostname &&
        (hostname === ruleHost || hostname.endsWith("." + ruleHost));
    } else if (rule.type === "extension") {
      const ruleExt = String(rule.value || "").startsWith(".")
        ? String(rule.value || "").toLowerCase()
        : "." + String(rule.value || "").toLowerCase();
      matched = extension === ruleExt;
    } else if (rule.type === "pattern") {
      try {
        const re = new RegExp(rule.value, "i");
        matched = re.test(baseFilename) || re.test(url);
      } catch {}
    }

    if (!matched) continue;

    let folder = String(rule.folder || "")
      .trim()
      .replace(/\\/g, "/");
    if (folder.startsWith("/")) folder = folder.slice(1);
    if (folder.endsWith("/")) folder = folder.slice(0, -1);

    return folder ? `${folder}/${baseFilename}` : baseFilename;
  }

  return null;
}

chrome.downloads.onCreated.addListener((downloadItem) => {
  if (!chrome.downloads?.rename) return;

  chrome.storage.sync.get({ rules: [] }, ({ rules }) => {
    const newPath = computeRoutedPath(downloadItem, rules);
    if (!newPath) return;

    chrome.downloads.rename(downloadItem.id, newPath, () => {
      void chrome.runtime?.lastError;
    });
  });
});
