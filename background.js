// Download Router - Background Service Worker

// ── CONTEXT MENU ─────────────────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "save-with-router",
    title: "⬇ Save Image with Router",
    contexts: ["image"],
  });
});

chrome.contextMenus.onClicked.addListener((info, _tab) => {
  if (info.menuItemId === "save-with-router" && info.srcUrl) {
    chrome.downloads.download({ url: info.srcUrl });
  }
});

// ── DOWNLOAD INTERCEPTION ─────────────────────────────────────────────────────
chrome.downloads.onDeterminingFilename.addListener((downloadItem, suggest) => {
  chrome.storage.sync.get({ rules: [] }, ({ rules }) => {
    if (!rules.length) return suggest();

    const sorted = [...rules].sort((a, b) => a.priority - b.priority);

    const url = downloadItem.url || "";
    const filename = downloadItem.filename || "";
    const extension = filename.includes(".")
      ? "." + filename.split(".").pop().toLowerCase()
      : "";

    let hostname = "";
    try {
      hostname = new URL(url).hostname.replace(/^www\./, "");
    } catch {}

    for (const rule of sorted) {
      if (!rule.enabled) continue;

      let matched = false;

      if (rule.type === "domain") {
        const ruleHost = rule.value.replace(/^www\./, "").toLowerCase();
        matched =
          hostname.toLowerCase() === ruleHost ||
          hostname.toLowerCase().endsWith("." + ruleHost);
      } else if (rule.type === "extension") {
        const ruleExt = rule.value.startsWith(".")
          ? rule.value.toLowerCase()
          : "." + rule.value.toLowerCase();
        matched = extension === ruleExt;
      } else if (rule.type === "pattern") {
        try {
          const re = new RegExp(rule.value, "i");
          matched = re.test(filename) || re.test(url);
        } catch {}
      }

      if (matched) {
        let folder = rule.folder.trim().replace(/\\/g, "/");
        if (folder.startsWith("/")) folder = folder.slice(1);
        if (folder.endsWith("/")) folder = folder.slice(0, -1);

        const baseFilename = filename.split("/").pop();
        const newPath = folder ? `${folder}/${baseFilename}` : baseFilename;

        suggest({ filename: newPath, conflictAction: "uniquify" });
        return;
      }
    }

    suggest();
  });

  return true;
});
