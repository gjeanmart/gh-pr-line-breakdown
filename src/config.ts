export type Category = {
  name: string;
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
      name: "Tests",
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
      name: "Main",
      patterns: ["**/*"],
      fallback: true,
    },
  ],
};

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
  return { ...base, githubToken: localResult["githubToken"] as string | undefined };
}

export async function saveConfig(config: Config): Promise<void> {
  const { githubToken, ...syncConfig } = config;
  await Promise.all([
    new Promise<void>((resolve) =>
      chrome.storage.sync.set({ config: syncConfig }, resolve)
    ),
    new Promise<void>((resolve) =>
      chrome.storage.local.set({ githubToken: githubToken ?? null }, resolve)
    ),
  ]);
}
