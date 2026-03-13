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
      name: "Main",
      patterns: ["**/*"],
      fallback: true,
    },
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
      name: "CI/CD",
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
