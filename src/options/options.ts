import { loadConfig, saveConfig, DEFAULT_CONFIG, type Category, type Config } from "../config.js";

let config: Config = { categories: [] };
let dragSrcIndex: number | null = null;

async function init(): Promise<void> {
  config = await loadConfig();
  (document.getElementById("github-token") as HTMLInputElement).value = config.githubToken ?? "";
  renderCategories();
  document.getElementById("btn-save")!.addEventListener("click", onSave);
  document.getElementById("btn-reset")!.addEventListener("click", onReset);
  document.getElementById("btn-add")!.addEventListener("click", onAddCategory);
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
    card.innerHTML = `
      <div class="category-header">
        <span class="drag-handle" title="Drag to reorder">&#8942;&#8942;</span>
        <input type="text" class="cat-name" draggable="false" value="${escapeAttr(cat.name)}" placeholder="Category name" />
        ${fallbackBadge}
        ${removeBtn}
      </div>
      <label>Glob patterns (one per line)</label>
      <textarea class="cat-patterns" draggable="false" rows="4">${escapeHtml(cat.patterns.join("\n"))}</textarea>
    `;

    card.querySelector("[data-action='remove']")?.addEventListener("click", () => {
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
    const patternsRaw = (card.querySelector<HTMLTextAreaElement>(".cat-patterns")!).value;
    const patterns = patternsRaw.split("\n").map((p) => p.trim()).filter(Boolean);
    const fallback = config.categories[index]?.fallback ?? false;
    updated.push({ name, patterns, ...(fallback ? { fallback: true } : {}) });
  });

  config.categories = updated;
}

async function onSave(): Promise<void> {
  readFormIntoConfig();
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
    patterns: [],
  });
  renderCategories();
}

function showToast(message: string): void {
  const toast = document.getElementById("toast")!;
  toast.textContent = message;
  toast.classList.add("visible");
  setTimeout(() => toast.classList.remove("visible"), 2500);
}

function escapeAttr(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

document.getElementById("footer-version")!.textContent =
  `v${chrome.runtime.getManifest().version}`;

init();
