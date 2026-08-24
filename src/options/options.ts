import {
  loadConfig,
  saveConfig,
  DEFAULT_CONFIG,
  parseImportedCategories,
  type Category,
  type Config,
} from "../config.js";
import { safeCssColor } from "../color.js";
import { escapeAttr, escapeHtml } from "../html.js";

// The palette the "add category" button starts from, and the fallback for a colour that is
// not a plain hex value.
const NEW_CATEGORY_COLOR = "#0969da";

let config: Config = { categories: [] };
let dragSrcIndex: number | null = null;

async function init(): Promise<void> {
  config = await loadConfig();
  (document.getElementById("github-token") as HTMLInputElement).value = config.githubToken ?? "";
  renderCategories();

  // Tab switching
  document.querySelectorAll<HTMLButtonElement>(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach((p) => p.classList.add("hidden"));
      btn.classList.add("active");
      document.getElementById(`tab-${btn.dataset.tab}`)!.classList.remove("hidden");
    });
  });

  document.getElementById("btn-save")!.addEventListener("click", onSaveCategories);
  document.getElementById("btn-reset")!.addEventListener("click", onReset);
  document.getElementById("btn-add")!.addEventListener("click", onAddCategory);
  document.getElementById("btn-save-settings")!.addEventListener("click", onSaveSettings);
  document.getElementById("btn-export")!.addEventListener("click", onExport);
  document.getElementById("import-file")!.addEventListener("change", onImport);
}

function renderCategories(): void {
  const container = document.getElementById("categories")!;
  container.innerHTML = "";

  config.categories.forEach((cat, index) => {
    const card = document.createElement("div");
    card.className = "category-card";

    const fallbackBadge = cat.fallback
      ? `<span class="fallback-badge">fallback</span>`
      : "";

    const removeBtn = config.categories.length > 1
      ? `<button class="btn-remove" data-action="remove">Remove</button>`
      : "";

    card.setAttribute("draggable", "true");
    card.style.borderLeftColor = safeCssColor(cat.color, NEW_CATEGORY_COLOR);
    card.innerHTML = `
      <div class="category-header">
        <span class="drag-handle" title="Drag to reorder">&#8942;&#8942;</span>
        <input type="color" class="cat-color" value="${safeCssColor(cat.color, NEW_CATEGORY_COLOR)}" title="Badge color" />
        <input type="text" class="cat-name" draggable="false" value="${escapeAttr(cat.name)}" placeholder="Category name" />
        ${fallbackBadge}
        ${removeBtn}
      </div>
      <label>Glob patterns (one per line)</label>
      <textarea class="cat-patterns" draggable="false" rows="4">${escapeHtml(cat.patterns.join("\n"))}</textarea>
    `;

    card.querySelector<HTMLInputElement>(".cat-color")!.addEventListener("input", (e) => {
      card.style.borderLeftColor = safeCssColor((e.target as HTMLInputElement).value, NEW_CATEGORY_COLOR);
    });

    card.querySelector("[data-action='remove']")?.addEventListener("click", () => {
      // Read the form back first, as add and drag-reorder already do — otherwise removing
      // one card silently discards whatever was typed into the others.
      readFormIntoConfig();
      config.categories.splice(index, 1);
      renderCategories();
    });

    card.addEventListener("dragstart", (e) => {
      dragSrcIndex = index;
      e.dataTransfer!.effectAllowed = "move";
      requestAnimationFrame(() => card.classList.add("dragging"));
    });
    card.addEventListener("dragend", () => {
      card.classList.remove("dragging");
      document.querySelectorAll(".category-card").forEach((c) => c.classList.remove("drag-over"));
    });
    card.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer!.dropEffect = "move";
      document.querySelectorAll(".category-card").forEach((c) => c.classList.remove("drag-over"));
      if (dragSrcIndex !== index) card.classList.add("drag-over");
    });
    card.addEventListener("drop", (e) => {
      e.preventDefault();
      card.classList.remove("drag-over");
      if (dragSrcIndex === null || dragSrcIndex === index) return;
      readFormIntoConfig();
      const [moved] = config.categories.splice(dragSrcIndex, 1);
      config.categories.splice(index, 0, moved);
      dragSrcIndex = null;
      renderCategories();
    });

    container.appendChild(card);
  });
}

function readFormIntoConfig(): void {
  const cards = document.querySelectorAll<HTMLElement>(".category-card");
  const updated: Category[] = [];

  cards.forEach((card, index) => {
    const name = (card.querySelector<HTMLInputElement>(".cat-name")!).value.trim();
    const color = safeCssColor((card.querySelector<HTMLInputElement>(".cat-color")!).value, NEW_CATEGORY_COLOR);
    const patternsRaw = (card.querySelector<HTMLTextAreaElement>(".cat-patterns")!).value;
    const patterns = patternsRaw.split("\n").map((p) => p.trim()).filter(Boolean);
    const fallback = config.categories[index]?.fallback ?? false;
    updated.push({ name, color, patterns, ...(fallback ? { fallback: true } : {}) });
  });

  config.categories = updated;
}

async function onSaveCategories(): Promise<void> {
  readFormIntoConfig();
  await saveConfig(config);
  showToast("Categories saved.");
}

async function onSaveSettings(): Promise<void> {
  const token = (document.getElementById("github-token") as HTMLInputElement).value.trim();
  config.githubToken = token || undefined;
  await saveConfig(config);
  showToast("Settings saved.");
}

function onReset(): void {
  config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  renderCategories();
}

function onAddCategory(): void {
  readFormIntoConfig();
  const insertAt = config.categories.length;
  config.categories.splice(insertAt, 0, {
    name: "New Category",
    color: NEW_CATEGORY_COLOR,
    patterns: [],
  });
  renderCategories();
}

function onExport(): void {
  const exportData = { categories: config.categories };
  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "gh-pr-line-breakdown-config.json";
  a.click();
  URL.revokeObjectURL(url);
}

function onImport(e: Event): void {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    const imported = parseImportedCategories(reader.result as string);
    if (!imported) {
      showToast("That does not look like a category config file.");
      (e.target as HTMLInputElement).value = "";
      return;
    }

    readFormIntoConfig();
    config.categories = imported;
    renderCategories();

    // Switch to Categories tab so the user sees the result
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((panel) => panel.classList.add("hidden"));
    document.querySelector<HTMLButtonElement>('[data-tab="categories"]')!.classList.add("active");
    document.getElementById("tab-categories")!.classList.remove("hidden");
    showToast("Config imported. Review and save.");
    (e.target as HTMLInputElement).value = "";
  };
  reader.readAsText(file);
}

let toastTimer: ReturnType<typeof setTimeout> | null = null;

function showToast(message: string): void {
  const toast = document.getElementById("toast")!;
  toast.textContent = message;
  toast.classList.add("visible");
  if (toastTimer !== null) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove("visible");
    toastTimer = null;
  }, 2500);
}

document.getElementById("footer-version")!.textContent =
  `v${chrome.runtime.getManifest().version}`;

init();
