export type Category = {
  name: string;
  color?: string;
  patterns: string[];
  fallback?: boolean;
};

export type Config = {
  categories: Category[];
  githubToken?: string;
};

export const DEFAULT_CONFIG: Config = {
  categories: [
    {
      name: "Main",
      color: "#6e7781",
      patterns: ["**/*"],
      fallback: true,
    },
    {
      name: "Tests",
      color: "#0969da",
      patterns: [
        "**/*.spec.ts",
        "**/*.test.ts",
        "**/*.spec.tsx",
        "**/*.test.tsx",
        "**/*.spec.js",
        "**/*.test.js",
        "**/*.spec.jsx",
        "**/*.test.jsx",
        "**/__tests__/**",
        "**/__mocks__/**",
        "**/test_*.py",
        "**/*_test.py",
        "**/tests/**/*.py",
        "**/conftest.py",
      ],
    },
    {
      name: "Documentation",
      color: "#1a7f37",
      patterns: [
        "**/*.md",
        "**/*.mdx",
        "**/*.rst",
        "**/*.txt",
        "**/*.png",
        "**/*.jpg",
        "**/*.jpeg",
        "**/*.gif",
        "**/*.svg",
        "**/*.webp",
        "**/*.drawio",
        "**/*.puml",
        "**/*.plantuml",
        "**/docs/**",
        "**/documentation/**",
      ],
    },
    {
      name: "Generated / Other",
      color: "#8c959f",
      patterns: [
        "**/package-lock.json",
        "**/yarn.lock",
        "**/pnpm-lock.yaml",
        "**/*.snap",
        "**/dist/**",
        "**/build/**",
        "**/.next/**",
        "**/__pycache__/**",
        "**/*.pyc",
        "**/*.pyo",
      ],
    },
    {
      name: "CI/CD",
      color: "#e16f24",
      patterns: [
        "**/.github/workflows/**",
        "**/.github/actions/**",
        "**/.circleci/**",
        "**/.gitlab-ci.yml",
        "**/Jenkinsfile",
        "**/.travis.yml",
        "**/.drone.yml",
        "**/Dockerfile*",
        "**/docker-compose*.yml",
        "**/docker-compose*.yaml",
      ],
    },
    {
      name: "Infrastructure",
      color: "#cf222e",
      patterns: [
        "**/*.tf",
        "**/*.tfvars",
        "**/terraform/**",
        "**/k8s/**",
        "**/kubernetes/**",
        "**/helm/**",
        "**/charts/**",
        "**/*.helm",
      ],
    },
    {
      name: "Config",
      color: "#6639ba",
      patterns: [
        "**/.eslintrc*",
        "**/.prettierrc*",
        "**/tsconfig*.json",
        "**/jsconfig*.json",
        "**/webpack.config.*",
        "**/vite.config.*",
        "**/babel.config.*",
        "**/.babelrc*",
        "**/.editorconfig",
        "**/.nvmrc",
        "**/.node-version",
        "**/renovate.json",
        "**/.dependabot/**",
      ],
    },
    {
      name: "Database",
      color: "#9a6700",
      patterns: [
        "**/migrations/**",
        "**/db/migrate/**",
        "**/db/schema.*",
        "**/seeds/**",
        "**/fixtures/**",
        "**/*.sql",
      ],
    },
    {
      name: "Styles",
      color: "#bf3989",
      patterns: [
        "**/*.css",
        "**/*.scss",
        "**/*.sass",
        "**/*.less",
        "**/*.styl",
        "**/styles/**",
        "**/themes/**",
      ],
    },
  ],
};

// A category list with no fallback silently sends unmatched files to whichever category
// happens to be last — the options UI cannot set the flag, and an imported file need not
// carry one, so a config could lose its fallback with no way to get it back. Every list is
// normalised on the way in and on the way out instead.
export function normalizeCategories(categories: Category[]): Category[] {
  if (categories.length === 0) return categories;

  const declared = categories.findIndex((category) => category.fallback === true);
  // A bare catch-all pattern is strong evidence of intent; failing that, the last category,
  // which is where a catch-all conventionally sits.
  const catchAll = categories.findIndex((category) =>
    category.patterns.some((pattern) => pattern === "**/*" || pattern === "*" || pattern === "**")
  );
  const fallbackIndex = declared !== -1 ? declared : catchAll !== -1 ? catchAll : categories.length - 1;

  return categories.map((category, index) => {
    const { fallback: _drop, ...rest } = category;
    return index === fallbackIndex ? { ...rest, fallback: true } : rest;
  });
}

/**
 * Validate a config file chosen in the options page. Returns the categories it holds, or
 * null when the file is not one of ours. Kept here rather than in the options page so it is
 * testable, and so it cannot disagree with what loadConfig accepts.
 */
export function parseImportedCategories(json: string): Category[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object") return null;
  const list = (parsed as { categories?: unknown }).categories;
  if (!Array.isArray(list) || list.length === 0) return null;

  const categories: Category[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== "object") return null;
    const { name, patterns, color, fallback } = entry as Record<string, unknown>;
    if (typeof name !== "string" || !name.trim()) return null;
    if (!Array.isArray(patterns) || patterns.some((pattern) => typeof pattern !== "string")) return null;

    categories.push({
      name: name.trim(),
      patterns: (patterns as string[]).map((pattern) => pattern.trim()).filter(Boolean),
      ...(typeof color === "string" ? { color } : {}),
      ...(fallback === true ? { fallback: true } : {}),
    });
  }

  return normalizeCategories(categories);
}

export async function loadConfig(): Promise<Config> {
  const [syncResult, localResult] = await Promise.all([
    new Promise<Record<string, unknown>>((resolve) =>
      chrome.storage.sync.get("config", resolve)
    ),
    new Promise<Record<string, unknown>>((resolve) =>
      chrome.storage.local.get("githubToken", resolve)
    ),
  ]);
  const base = (syncResult["config"] as Config | undefined) ?? DEFAULT_CONFIG;
  return {
    ...base,
    // Repairs a stored config that predates the guarantee, or was hand-edited in storage
    categories: normalizeCategories(base.categories ?? DEFAULT_CONFIG.categories),
    githubToken: localResult["githubToken"] as string | undefined,
  };
}

export async function saveConfig(config: Config): Promise<void> {
  const { githubToken, ...rest } = config;
  const syncConfig = { ...rest, categories: normalizeCategories(rest.categories) };
  await Promise.all([
    new Promise<void>((resolve) =>
      chrome.storage.sync.set({ config: syncConfig }, resolve)
    ),
    new Promise<void>((resolve) =>
      chrome.storage.local.set({ githubToken: githubToken ?? null }, resolve)
    ),
  ]);
}
