import { loadConfig, saveConfig, DEFAULT_CONFIG, type Category, type Config } from "../config.js";

let config: Config = { categories: [] };

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

    card.innerHTML = `
      <div class="category-header">
        <input type="text" class="cat-name" value="${escapeAttr(cat.name)}" placeholder="Category name" />
        ${fallbackBadge}
        ${removeBtn}
      </div>
      <label>Glob patterns (one per line)</label>
      <textarea class="cat-patterns" rows="4">${escapeHtml(cat.patterns.join("\n"))}</textarea>
    `;

    card.querySelector("[data-action='remove']")?.addEventListener("click", () => {
      config.categories.splice(index, 1);
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
  // Insert before the fallback category (last one)
  const insertAt = Math.max(0, config.categories.length - 1);
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

init();
