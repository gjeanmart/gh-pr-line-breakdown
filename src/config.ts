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
