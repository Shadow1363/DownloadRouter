// Download Router — Popup Script

const MATCH_TYPES = ["domain", "extension", "pattern"];
const THEME_ORDER = ["auto", "light", "dark"];
const THEME_KEY = "dr-theme";
const SVG_NS = "http://www.w3.org/2000/svg";

let rules = [];
let editingId = null;
let selectedType = "domain";
let importMode = "merge";
let themePref = document.documentElement.dataset.themePref || "auto";
let dragSrcIndex = null;

const $ = (id) => document.getElementById(id);

const container = $("rules-container");
const emptyState = $("empty-state");
const ruleCount = $("rule-count");
const backdrop = $("modal-backdrop");
const modalTitle = $("modal-title");
const openBtn = $("open-modal-btn");
const cancelBtn = $("cancel-btn");
const saveBtn = $("save-btn");
const ruleValueInput = $("rule-value");
const ruleFolderInput = $("rule-folder");
const rulePriorityInput = $("rule-priority");
const valueLabel = $("value-label");
const ruleHint = $("rule-hint");
const folderHint = $("folder-hint");
const themeBtn = $("theme-btn");
const exportBtn = $("export-btn");
const importBtn = $("import-btn");
const importBackdrop = $("import-backdrop");
const importText = $("import-text");
const importHint = $("import-hint");
const importModeHint = $("import-mode-hint");
const importCancelBtn = $("import-cancel-btn");
const importConfirmBtn = $("import-confirm-btn");
const toast = $("toast");
const segBtns = document.querySelectorAll("#modal-backdrop .seg-btn");
const importSegBtns = document.querySelectorAll("#import-backdrop .seg-btn");

// ── THEME ─────────────────────────────────────────────────────────────────────
const lightQuery = matchMedia("(prefers-color-scheme: light)");

function resolveTheme(pref) {
  if (pref === "auto") return lightQuery.matches ? "light" : "dark";
  return pref;
}

function applyTheme(pref, { persist = true } = {}) {
  themePref = THEME_ORDER.includes(pref) ? pref : "auto";
  document.documentElement.dataset.theme = resolveTheme(themePref);
  document.documentElement.dataset.themePref = themePref;

  try {
    localStorage.setItem(THEME_KEY, themePref);
  } catch {
    /* private mode; chrome.storage still holds the preference */
  }
  if (persist) chrome.storage.sync.set({ theme: themePref });

  renderThemeButton();
}

lightQuery.addEventListener("change", () => {
  if (themePref === "auto") applyTheme("auto", { persist: false });
});

const THEME_ICONS = {
  auto: [
    {
      d: "M20 3H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2z",
    },
    { d: "M12 17v4" },
    { d: "M8 21h8" },
  ],
  light: [
    { circle: [12, 12, 4] },
    { d: "M12 2v2" },
    { d: "M12 20v2" },
    { d: "m4.93 4.93 1.41 1.41" },
    { d: "m17.66 17.66 1.41 1.41" },
    { d: "M2 12h2" },
    { d: "M20 12h2" },
    { d: "m6.34 17.66-1.41 1.41" },
    { d: "m19.07 4.93-1.41 1.41" },
  ],
  dark: [{ d: "M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" }],
};

const THEME_LABELS = { auto: "system", light: "light", dark: "dark" };

function renderThemeButton() {
  themeBtn.replaceChildren(createLucideSvg(THEME_ICONS[themePref]));
  themeBtn.title = `Theme: ${THEME_LABELS[themePref]}`;
  themeBtn.setAttribute("aria-label", `Theme: ${THEME_LABELS[themePref]}`);
}

themeBtn.addEventListener("click", () => {
  const next = THEME_ORDER[(THEME_ORDER.indexOf(themePref) + 1) % 3];
  applyTheme(next);
  showToast(`Theme: ${THEME_LABELS[next]}`);
});

// ── INIT ──────────────────────────────────────────────────────────────────────
chrome.storage.sync.get({ rules: [], theme: "auto" }, (saved) => {
  rules = Array.isArray(saved.rules) ? saved.rules : [];
  if (THEME_ORDER.includes(saved.theme)) {
    themePref = saved.theme;
    applyTheme(themePref, { persist: false });
  } else {
    applyTheme(themePref, { persist: false });
  }
  renderRules();
});

window.addEventListener("load", () => scheduleRulesContainerSizing());

// ── RENDER ────────────────────────────────────────────────────────────────────
function renderRules() {
  container.querySelectorAll(".rule-card").forEach((el) => el.remove());

  const sorted = [...rules].sort((a, b) => a.priority - b.priority);
  ruleCount.textContent = `${sorted.length} ${sorted.length === 1 ? "rule" : "rules"}`;

  if (!sorted.length) {
    emptyState.style.display = "flex";
    container.style.maxHeight = "";
    return;
  }
  emptyState.style.display = "none";

  const typeLabels = { domain: "Domain", extension: "Ext", pattern: "Regex" };

  sorted.forEach((rule, idx) => {
    const card = document.createElement("div");
    card.className = "rule-card" + (rule.enabled === false ? " disabled" : "");
    card.dataset.id = rule.id;
    card.dataset.index = String(idx);
    card.draggable = true;

    buildRuleCard(card, rule, typeLabels);

    card.addEventListener("dragstart", (e) => {
      dragSrcIndex = idx;
      card.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
    });
    card.addEventListener("dragend", () => card.classList.remove("dragging"));
    card.addEventListener("dragover", (e) => {
      e.preventDefault();
      card.classList.add("drag-over");
    });
    card.addEventListener("dragleave", () =>
      card.classList.remove("drag-over"),
    );
    card.addEventListener("drop", (e) => {
      e.preventDefault();
      card.classList.remove("drag-over");
      if (dragSrcIndex === null || dragSrcIndex === idx) return;
      reorderRules(dragSrcIndex, idx);
      dragSrcIndex = null;
    });

    container.appendChild(card);
  });

  scheduleRulesContainerSizing();
}

// One delegated listener per event type. Binding both click and change to the
// same checkbox fired the handler twice and saved on every toggle twice over.
container.addEventListener("click", (e) => {
  const el = e.target.closest("[data-action]");
  if (!el || el.dataset.action === "toggle") return;
  handleAction(el.dataset.action, el.dataset.id);
});

container.addEventListener("change", (e) => {
  const el = e.target.closest('[data-action="toggle"]');
  if (!el) return;
  handleAction("toggle", el.dataset.id, el.checked);
});

function handleAction(action, id, checked) {
  if (action === "toggle") {
    const rule = rules.find((r) => r.id === id);
    if (!rule) return;
    rule.enabled = checked;
    saveRules();
    renderRules();
    showToast(checked ? "Rule enabled" : "Rule disabled");
  } else if (action === "edit") {
    openModal(id);
  } else if (action === "delete") {
    rules = rules.filter((r) => r.id !== id);
    rules = normalizePriorities(rules);
    saveRules();
    renderRules();
    showToast("Rule deleted");
  }
}

function buildRuleCard(card, rule, typeLabels) {
  const dragHandle = document.createElement("div");
  dragHandle.className = "drag-handle";
  dragHandle.title = "Drag to reorder";
  dragHandle.textContent = "⠿";

  const priorityBadge = document.createElement("div");
  priorityBadge.className = "priority-badge";
  priorityBadge.textContent = String(rule.priority ?? "");

  const ruleInfo = document.createElement("div");
  ruleInfo.className = "rule-info";

  const ruleTypeValue = document.createElement("div");
  ruleTypeValue.className = "rule-type-value";

  const typeChip = document.createElement("span");
  typeChip.className = `type-chip ${rule.type ?? ""}`;
  typeChip.textContent = typeLabels[rule.type] || rule.type;

  const ruleValue = document.createElement("span");
  ruleValue.className = "rule-value";
  ruleValue.textContent = String(rule.value ?? "");
  ruleValue.title = String(rule.value ?? "");

  ruleTypeValue.appendChild(typeChip);
  ruleTypeValue.appendChild(ruleValue);

  const ruleFolder = document.createElement("div");
  ruleFolder.className = "rule-folder";
  ruleFolder.append("→ ");

  const folderValue = document.createElement("span");
  folderValue.textContent = String(rule.folder ?? "");
  ruleFolder.appendChild(folderValue);

  ruleInfo.appendChild(ruleTypeValue);
  ruleInfo.appendChild(ruleFolder);

  const ruleActions = document.createElement("div");
  ruleActions.className = "rule-actions";

  const toggleLabel = document.createElement("label");
  toggleLabel.className = "toggle";
  toggleLabel.title = `${rule.enabled === false ? "Enable" : "Disable"} rule`;

  const toggleInput = document.createElement("input");
  toggleInput.type = "checkbox";
  toggleInput.checked = rule.enabled !== false;
  toggleInput.dataset.action = "toggle";
  toggleInput.dataset.id = rule.id;

  const toggleTrack = document.createElement("div");
  toggleTrack.className = "toggle-track";

  const toggleThumb = document.createElement("div");
  toggleThumb.className = "toggle-thumb";

  toggleLabel.append(toggleInput, toggleTrack, toggleThumb);

  const editBtn = document.createElement("button");
  editBtn.className = "icon-btn";
  editBtn.dataset.action = "edit";
  editBtn.dataset.id = rule.id;
  editBtn.title = "Edit";
  editBtn.appendChild(
    createLucideSvg([
      {
        d: "M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z",
      },
      { d: "m15 5 4 4" },
    ]),
  );

  const deleteBtn = document.createElement("button");
  deleteBtn.className = "icon-btn danger";
  deleteBtn.dataset.action = "delete";
  deleteBtn.dataset.id = rule.id;
  deleteBtn.title = "Delete";
  deleteBtn.appendChild(
    createLucideSvg([
      { d: "M10 11v6" },
      { d: "M14 11v6" },
      { d: "M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" },
      { d: "M3 6h18" },
      { d: "M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" },
    ]),
  );

  ruleActions.append(toggleLabel, editBtn, deleteBtn);
  card.append(dragHandle, priorityBadge, ruleInfo, ruleActions);
}

function createLucideSvg(shapes) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("xmlns", SVG_NS);
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");

  for (const shape of shapes) {
    if (shape.circle) {
      const [cx, cy, r] = shape.circle;
      const circle = document.createElementNS(SVG_NS, "circle");
      circle.setAttribute("cx", cx);
      circle.setAttribute("cy", cy);
      circle.setAttribute("r", r);
      svg.appendChild(circle);
    } else {
      const path = document.createElementNS(SVG_NS, "path");
      path.setAttribute("d", shape.d);
      svg.appendChild(path);
    }
  }

  return svg;
}

function scheduleRulesContainerSizing() {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => updateRulesContainerSizing());
  });
}

function updateRulesContainerSizing() {
  const cards = Array.from(container.querySelectorAll(".rule-card"));

  if (cards.length === 0) {
    container.style.maxHeight = "";
    return;
  }

  const styles = getComputedStyle(container);
  const paddingTop = parseFloat(styles.paddingTop) || 0;
  const paddingBottom = parseFloat(styles.paddingBottom) || 0;
  const gap = parseFloat(styles.rowGap || styles.gap) || 0;

  const visibleCount = Math.min(cards.length, 5);
  let maxHeight =
    paddingTop + paddingBottom + gap * Math.max(0, visibleCount - 1);

  for (let i = 0; i < visibleCount; i++) {
    maxHeight += cards[i].getBoundingClientRect().height;
  }

  container.style.maxHeight = `${Math.ceil(maxHeight)}px`;
}

// ── PRIORITIES ────────────────────────────────────────────────────────────────
// Renumbers to a clean 1..n. A pinned rule wins ties, so typing an explicit
// priority moves that rule into the slot instead of leaving a duplicate number.
function normalizePriorities(list, pinnedId = null) {
  const sorted = [...list].sort((a, b) => {
    const diff = (a.priority ?? 999) - (b.priority ?? 999);
    if (diff !== 0) return diff;
    if (a.id === pinnedId) return -1;
    if (b.id === pinnedId) return 1;
    return 0;
  });
  sorted.forEach((rule, i) => {
    rule.priority = i + 1;
  });
  return sorted;
}

function reorderRules(fromIdx, toIdx) {
  const sorted = [...rules].sort((a, b) => a.priority - b.priority);
  const [moved] = sorted.splice(fromIdx, 1);
  sorted.splice(toIdx, 0, moved);
  sorted.forEach((rule, i) => {
    rule.priority = i + 1;
  });
  rules = sorted;
  saveRules();
  renderRules();
}

// ── RULE MODAL ────────────────────────────────────────────────────────────────
openBtn.addEventListener("click", () => openModal());
cancelBtn.addEventListener("click", closeModal);
backdrop.addEventListener("click", (e) => {
  if (e.target === backdrop) closeModal();
});

segBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    segBtns.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    selectedType = btn.dataset.type;
    updateTypeUI();
    if (selectedType === "domain") {
      ruleValueInput.value = normalizeDomainValue(ruleValueInput.value);
    }
    clearInvalid();
  });
});

ruleValueInput.addEventListener("blur", () => {
  if (selectedType === "domain") {
    ruleValueInput.value = normalizeDomainValue(ruleValueInput.value);
  }
});

ruleFolderInput.addEventListener("input", updateFolderPreview);
[ruleValueInput, ruleFolderInput, rulePriorityInput].forEach((input) =>
  input.addEventListener("input", () => input.classList.remove("invalid")),
);

const TYPE_HINTS = {
  domain: [
    "Domain",
    "e.g. gameassets.com",
    "Matches any download from this domain, subdomains included.",
  ],
  extension: [
    "File Extension",
    "e.g. .png",
    "Matches any download with this file extension.",
  ],
  pattern: [
    "Regex Pattern",
    "e.g. invoice.*\\.pdf",
    "Matches the filename or the URL against a regular expression.",
  ],
};

function updateTypeUI() {
  const [label, placeholder, hint] =
    TYPE_HINTS[selectedType] || TYPE_HINTS.domain;
  valueLabel.textContent = label;
  ruleValueInput.placeholder = placeholder;
  ruleHint.textContent = hint;
  ruleHint.classList.remove("error");
}

function updateFolderPreview() {
  const cleaned = sanitizeFolder(ruleFolderInput.value);
  folderHint.classList.remove("error");
  folderHint.textContent = cleaned
    ? `Files land in Downloads/${cleaned}`
    : "Relative to your Downloads folder. Use forward slashes to nest.";
}

function openModal(id = null) {
  editingId = id;
  segBtns.forEach((b) => b.classList.remove("active"));
  clearInvalid();

  const rule = id ? rules.find((r) => r.id === id) : null;

  if (rule) {
    modalTitle.textContent = "Edit Rule";
    selectedType = MATCH_TYPES.includes(rule.type) ? rule.type : "domain";
    ruleValueInput.value =
      selectedType === "domain"
        ? normalizeDomainValue(rule.value)
        : String(rule.value ?? "");
    ruleFolderInput.value = String(rule.folder ?? "");
    rulePriorityInput.value = rule.priority ?? 1;
  } else {
    editingId = null;
    modalTitle.textContent = "New Rule";
    selectedType = "domain";
    ruleValueInput.value = "";
    ruleFolderInput.value = "";
    rulePriorityInput.value = rules.length + 1;
  }

  document
    .querySelector(`#modal-backdrop .seg-btn[data-type="${selectedType}"]`)
    .classList.add("active");
  updateTypeUI();
  updateFolderPreview();
  openBackdrop(backdrop);
  setTimeout(() => ruleValueInput.focus(), 200);
}

function closeModal() {
  closeBackdrop(backdrop);
  editingId = null;
}

function openBackdrop(el) {
  document.body.classList.add("modal-open");
  el.classList.add("open");
}

function closeBackdrop(el) {
  el.classList.remove("open");
  if (!document.querySelector(".modal-backdrop.open")) {
    document.body.classList.remove("modal-open");
  }
}

function clearInvalid() {
  [ruleValueInput, ruleFolderInput, rulePriorityInput].forEach((input) =>
    input.classList.remove("invalid"),
  );
  ruleHint.classList.remove("error");
  folderHint.classList.remove("error");
}

function reject(input, hintEl, message) {
  input.classList.remove("invalid");
  void input.offsetWidth; // restart the shake animation
  input.classList.add("invalid");
  if (hintEl) {
    hintEl.textContent = message;
    hintEl.classList.add("error");
  }
  input.focus();
  return false;
}

saveBtn.addEventListener("click", saveRuleFromModal);

function saveRuleFromModal() {
  clearInvalid();

  const rawValue = ruleValueInput.value.trim();
  const folderRaw = ruleFolderInput.value.trim();
  const priority = parseInt(rulePriorityInput.value, 10);

  if (!rawValue) {
    return reject(ruleValueInput, ruleHint, "Enter a value to match on.");
  }

  let value = rawValue;

  if (selectedType === "domain") {
    value = normalizeDomainValue(rawValue);
    if (!value || !value.includes(".")) {
      return reject(
        ruleValueInput,
        ruleHint,
        "That does not look like a domain. Try gameassets.com.",
      );
    }
    ruleValueInput.value = value;
  } else if (selectedType === "extension") {
    value = value.toLowerCase().replace(/^\.+/, "");
    if (!value || /[\\/\s]/.test(value)) {
      return reject(
        ruleValueInput,
        ruleHint,
        "Use a plain extension such as .png or zip.",
      );
    }
    value = "." + value;
    ruleValueInput.value = value;
  } else if (selectedType === "pattern") {
    try {
      new RegExp(value, "i");
    } catch (err) {
      return reject(
        ruleValueInput,
        ruleHint,
        `Not a valid regular expression: ${err.message}`,
      );
    }
  }

  const duplicate = rules.find(
    (r) => r.id !== editingId && r.type === selectedType && r.value === value,
  );
  if (duplicate) {
    return reject(
      ruleValueInput,
      ruleHint,
      `A rule for this already routes to ${duplicate.folder}.`,
    );
  }

  if (!folderRaw) {
    return reject(ruleFolderInput, folderHint, "Enter a destination folder.");
  }

  const folder = sanitizeFolder(folderRaw);
  if (!folder) {
    return reject(
      ruleFolderInput,
      folderHint,
      "That folder name has no usable characters.",
    );
  }
  ruleFolderInput.value = folder;

  if (!priority || priority < 1 || priority > 999) {
    return reject(rulePriorityInput, null, "");
  }

  let savedId = editingId;

  if (editingId) {
    const rule = rules.find((r) => r.id === editingId);
    if (!rule) return closeModal();
    Object.assign(rule, { type: selectedType, value, folder, priority });
  } else {
    savedId = newId();
    rules.push({
      id: savedId,
      type: selectedType,
      value,
      folder,
      priority,
      enabled: true,
    });
  }

  const wasEditing = Boolean(editingId);
  rules = normalizePriorities(rules, savedId);
  saveRules();
  renderRules();
  closeModal();
  showToast(wasEditing ? "Rule updated" : "Rule added");
}

// ── EXPORT ────────────────────────────────────────────────────────────────────
exportBtn.addEventListener("click", () => {
  if (!rules.length) {
    showToast("Nothing to export yet");
    return;
  }

  const payload = {
    app: "download-router",
    version: 1,
    exportedAt: new Date().toISOString(),
    rules: [...rules]
      .sort((a, b) => a.priority - b.priority)
      .map(({ type, value, folder, priority, enabled }) => ({
        type,
        value,
        folder,
        priority,
        enabled: enabled !== false,
      })),
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const stamp = new Date().toISOString().slice(0, 10);

  const link = document.createElement("a");
  link.href = url;
  link.download = `download-router-rules-${stamp}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);

  showToast(`Exported ${payload.rules.length} rules`);
});

// ── IMPORT ────────────────────────────────────────────────────────────────────
importBtn.addEventListener("click", () => {
  importText.value = "";
  importHint.textContent = "Drop an exported file onto the box, or paste JSON.";
  importHint.classList.remove("error");
  importText.classList.remove("invalid");

  // Replace All wipes every rule, so it must never persist between opens.
  setImportMode("merge");

  openBackdrop(importBackdrop);
  setTimeout(() => importText.focus(), 200);
});

function setImportMode(mode) {
  importMode = mode === "replace" ? "replace" : "merge";
  importSegBtns.forEach((btn) =>
    btn.classList.toggle("active", btn.dataset.mode === importMode),
  );
  importModeHint.textContent =
    importMode === "merge"
      ? "Merge keeps your current rules and appends the imported ones."
      : "Replace All discards your current rules first. This cannot be undone.";
}

importCancelBtn.addEventListener("click", () => closeBackdrop(importBackdrop));
importBackdrop.addEventListener("click", (e) => {
  if (e.target === importBackdrop) closeBackdrop(importBackdrop);
});

importSegBtns.forEach((btn) => {
  btn.addEventListener("click", () => setImportMode(btn.dataset.mode));
});

// A file picker would close the popup before the change event fires, so import
// accepts a drop or a paste instead.
["dragenter", "dragover"].forEach((type) =>
  importText.addEventListener(type, (e) => {
    e.preventDefault();
    importText.classList.add("drop-active");
  }),
);
["dragleave", "drop"].forEach((type) =>
  importText.addEventListener(type, () =>
    importText.classList.remove("drop-active"),
  ),
);

importText.addEventListener("drop", async (e) => {
  e.preventDefault();
  const file = e.dataTransfer?.files?.[0];
  if (!file) return;
  try {
    importText.value = await file.text();
    importHint.textContent = `Loaded ${file.name}`;
    importHint.classList.remove("error");
  } catch {
    importHint.textContent = "That file could not be read.";
    importHint.classList.add("error");
  }
});

importConfirmBtn.addEventListener("click", () => {
  const raw = importText.value.trim();
  if (!raw) {
    importHint.textContent = "Paste the JSON, or drop a file onto the box.";
    importHint.classList.add("error");
    importText.classList.add("invalid");
    return;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    importHint.textContent = `That is not valid JSON: ${err.message}`;
    importHint.classList.add("error");
    importText.classList.add("invalid");
    return;
  }

  const incoming = Array.isArray(parsed) ? parsed : parsed?.rules;
  if (!Array.isArray(incoming)) {
    importHint.textContent = "No rules found. Expected a rules array.";
    importHint.classList.add("error");
    importText.classList.add("invalid");
    return;
  }

  const { valid, skipped } = validateImported(incoming);
  if (!valid.length) {
    importHint.textContent = "None of those entries were usable rules.";
    importHint.classList.add("error");
    importText.classList.add("invalid");
    return;
  }

  rules = importMode === "replace" ? valid : [...rules, ...valid];
  rules = normalizePriorities(rules);
  saveRules();
  renderRules();
  closeBackdrop(importBackdrop);

  showToast(
    skipped
      ? `Imported ${valid.length}, skipped ${skipped}`
      : `Imported ${valid.length} rules`,
  );
});

function validateImported(entries) {
  const valid = [];
  let skipped = 0;

  entries.forEach((entry, i) => {
    if (!entry || typeof entry !== "object") return skipped++;
    if (!MATCH_TYPES.includes(entry.type)) return skipped++;

    const value = String(entry.value ?? "").trim();
    if (!value) return skipped++;

    if (entry.type === "pattern") {
      try {
        new RegExp(value, "i");
      } catch {
        return skipped++;
      }
    }

    const folder = sanitizeFolder(entry.folder);
    if (!folder) return skipped++;

    const priority = Number(entry.priority);

    valid.push({
      id: newId(),
      type: entry.type,
      value:
        entry.type === "domain"
          ? normalizeDomainValue(value)
          : entry.type === "extension"
            ? "." + value.toLowerCase().replace(/^\.+/, "")
            : value,
      folder,
      priority: Number.isFinite(priority) && priority > 0 ? priority : i + 1,
      enabled: entry.enabled !== false,
    });
  });

  return { valid, skipped };
}

// ── KEYBOARD ──────────────────────────────────────────────────────────────────
document.addEventListener("keydown", (e) => {
  const ruleOpen = backdrop.classList.contains("open");
  const importOpen = importBackdrop.classList.contains("open");

  if (e.key === "Escape") {
    if (importOpen) closeBackdrop(importBackdrop);
    else if (ruleOpen) closeModal();
    return;
  }

  if (e.key === "Enter") {
    // Enter in a textarea should insert a newline, not submit.
    if (importOpen && e.target !== importText) {
      e.preventDefault();
      importConfirmBtn.click();
    } else if (ruleOpen && e.target.tagName === "INPUT") {
      e.preventDefault();
      saveRuleFromModal();
    }
  }
});

// ── UTILS ─────────────────────────────────────────────────────────────────────
function newId() {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : `r-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function saveRules() {
  chrome.storage.sync.set({ rules }, () => {
    const err = chrome.runtime.lastError;
    if (err) showToast("Could not save: storage is full");
  });
}

function normalizeDomainValue(value) {
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

  return v.replace(/^www\./i, "").toLowerCase();
}

// Mirrors sanitizeFolder in background.js so the preview matches what lands
// on disk.
function sanitizeFolder(folder) {
  return String(folder ?? "")
    .replace(/\\/g, "/")
    .split("/")
    .map((seg) =>
      seg
        .replace(/[\u0000-\u001f<>:"|?*\\]/g, "")
        .replace(/[.\s]+$/, "")
        .trim(),
    )
    .filter((seg) => seg && !/^\.+$/.test(seg))
    .join("/");
}

let toastTimer;
function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2000);
}
