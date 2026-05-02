// Download Router — Popup Script

let rules = [];
let editingId = null;
let selectedType = "domain";
let dragSrcIndex = null;

const container = document.getElementById("rules-container");
const emptyState = document.getElementById("empty-state");
const backdrop = document.getElementById("modal-backdrop");
const modalTitle = document.getElementById("modal-title");
const openBtn = document.getElementById("open-modal-btn");
const cancelBtn = document.getElementById("cancel-btn");
const saveBtn = document.getElementById("save-btn");
const ruleValueInput = document.getElementById("rule-value");
const ruleFolderInput = document.getElementById("rule-folder");
const rulePriorityInput = document.getElementById("rule-priority");
const valueLabel = document.getElementById("value-label");
const ruleHint = document.getElementById("rule-hint");
const toast = document.getElementById("toast");
const segBtns = document.querySelectorAll(".seg-btn");

// ── INIT ──────────────────────────────────────────────────────────────────────
chrome.storage.sync.get({ rules: [] }, ({ rules: saved }) => {
  rules = saved;
  renderRules();
});

// ── RENDER ────────────────────────────────────────────────────────────────────
function renderRules() {
  // Remove all rule cards (keep empty state)
  container.querySelectorAll(".rule-card").forEach((el) => el.remove());

  const sorted = [...rules].sort((a, b) => a.priority - b.priority);

  if (!sorted.length) {
    emptyState.style.display = "flex";
    return;
  }
  emptyState.style.display = "none";

  sorted.forEach((rule, idx) => {
    const card = document.createElement("div");
    card.className = "rule-card" + (rule.enabled === false ? " disabled" : "");
    card.dataset.id = rule.id;
    card.draggable = true;

    const typeLabels = { domain: "Domain", extension: "Ext", pattern: "Regex" };

    card.innerHTML = `
      <div class="drag-handle" title="Drag to reorder">⠿</div>
      <div class="priority-badge">${rule.priority}</div>
      <div class="rule-info">
        <div class="rule-type-value">
          <span class="type-chip ${rule.type}">${typeLabels[rule.type] || rule.type}</span>
          <span class="rule-value">${escHtml(rule.value)}</span>
        </div>
        <div class="rule-folder">→ <span>${escHtml(rule.folder)}</span></div>
      </div>
      <div class="rule-actions">
        <label class="toggle" title="${rule.enabled === false ? "Enable" : "Disable"} rule">
          <input type="checkbox" ${rule.enabled !== false ? "checked" : ""} data-action="toggle" data-id="${rule.id}">
          <div class="toggle-track"></div>
          <div class="toggle-thumb"></div>
        </label>
        <button class="icon-btn" data-action="edit" data-id="${rule.id}" title="Edit">✏️</button>
        <button class="icon-btn danger" data-action="delete" data-id="${rule.id}" title="Delete">🗑</button>
      </div>
    `;

    // Drag events
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
    });

    container.appendChild(card);
  });

  // Delegate clicks
  container.querySelectorAll("[data-action]").forEach((el) => {
    el.addEventListener("change", handleAction);
    el.addEventListener("click", handleAction);
  });
}

function handleAction(e) {
  const el = e.currentTarget;
  const action = el.dataset.action;
  const id = el.dataset.id;

  if (action === "toggle") {
    const rule = rules.find((r) => r.id === id);
    if (rule) {
      rule.enabled = el.checked;
      saveRules();
      renderRules();
    }
  } else if (action === "edit") {
    openEditModal(id);
  } else if (action === "delete") {
    rules = rules.filter((r) => r.id !== id);
    reassignPriorities();
    saveRules();
    renderRules();
    showToast("Rule deleted");
  }
}

// ── DRAG REORDER ──────────────────────────────────────────────────────────────
function reorderRules(fromIdx, toIdx) {
  const sorted = [...rules].sort((a, b) => a.priority - b.priority);
  const [moved] = sorted.splice(fromIdx, 1);
  sorted.splice(toIdx, 0, moved);
  // Re-assign priorities
  sorted.forEach((r, i) => {
    r.priority = i + 1;
  });
  rules = sorted;
  saveRules();
  renderRules();
}

function reassignPriorities() {
  rules
    .sort((a, b) => a.priority - b.priority)
    .forEach((r, i) => {
      r.priority = i + 1;
    });
}

// ── MODAL ─────────────────────────────────────────────────────────────────────
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
  });
});

function updateTypeUI() {
  const hints = {
    domain: [
      "Domain",
      "e.g. gameassets.com",
      "Match any download from this domain (subdomains included).",
    ],
    extension: [
      "File Extension",
      "e.g. .png",
      "Match any download with this file extension.",
    ],
    pattern: [
      "Regex Pattern",
      "e.g. invoice.*\\.pdf",
      "Match filename or URL against a regular expression.",
    ],
  };
  const [label, ph, hint] = hints[selectedType] || hints.domain;
  valueLabel.textContent = label;
  ruleValueInput.placeholder = ph;
  ruleHint.textContent = hint;
}

function openModal(id = null) {
  editingId = id;
  segBtns.forEach((b) => b.classList.remove("active"));

  if (id) {
    const rule = rules.find((r) => r.id === id);
    modalTitle.textContent = "Edit Rule";
    selectedType = rule.type;
    ruleValueInput.value = rule.value;
    ruleFolderInput.value = rule.folder;
    rulePriorityInput.value = rule.priority;
  } else {
    modalTitle.textContent = "New Rule";
    selectedType = "domain";
    ruleValueInput.value = "";
    ruleFolderInput.value = "";
    rulePriorityInput.value = rules.length + 1;
  }

  document
    .querySelector(`.seg-btn[data-type="${selectedType}"]`)
    .classList.add("active");
  updateTypeUI();
  backdrop.classList.add("open");
  setTimeout(() => ruleValueInput.focus(), 200);
}

function openEditModal(id) {
  openModal(id);
}

function closeModal() {
  backdrop.classList.remove("open");
  editingId = null;
}

saveBtn.addEventListener("click", () => {
  const value = ruleValueInput.value.trim();
  const folder = ruleFolderInput.value.trim();
  const priority = parseInt(rulePriorityInput.value, 10);

  if (!value) {
    shake(ruleValueInput);
    return;
  }
  if (!folder) {
    shake(ruleFolderInput);
    return;
  }
  if (!priority || priority < 1) {
    shake(rulePriorityInput);
    return;
  }

  if (editingId) {
    const rule = rules.find((r) => r.id === editingId);
    Object.assign(rule, { type: selectedType, value, folder, priority });
  } else {
    rules.push({
      id: crypto.randomUUID(),
      type: selectedType,
      value,
      folder,
      priority,
      enabled: true,
    });
  }

  saveRules();
  renderRules();
  closeModal();
  showToast(editingId ? "Rule updated" : "Rule added");
});

// ── UTILS ─────────────────────────────────────────────────────────────────────
function saveRules() {
  chrome.storage.sync.set({ rules });
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function shake(el) {
  el.style.animation = "none";
  el.style.borderColor = "var(--danger)";
  setTimeout(() => {
    el.style.borderColor = "";
  }, 800);
}

let toastTimer;
function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2000);
}
