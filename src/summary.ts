// The arithmetic behind a rendered breakdown, in one place. The widget and the popup show the
// same numbers in different layouts, and both used to compute them inline — already drifting
// in the small stuff (the popup pluralised "file" differently from the widget).

import type { Category } from "./config.js";
import type { CategoryStats } from "./matcher.js";

const EMPTY_STATS: CategoryStats = { added: 0, removed: 0, total: 0, files: 0 };

export type CategoryRow = {
  category: Category;
  stats: CategoryStats;
  /** Share of all changed lines, rounded to a whole percent. */
  percent: number;
  /** "1 file" / "12 files". */
  fileLabel: string;
  /** Nothing changed in this category — rendered but hidden by default. */
  isEmpty: boolean;
  /** Bar widths as percentages, both scaled to the largest single-sided total. */
  addedWidth: number;
  removedWidth: number;
};

export type Summary = {
  totalLines: number;
  totalFiles: number;
  totalAdded: number;
  totalRemoved: number;
  /** "1 file" / "2,480 files". */
  filesLabel: string;
  rows: CategoryRow[];
  emptyCount: number;
};

export function fileLabel(count: number): string {
  return count === 1 ? "1 file" : `${count.toLocaleString()} files`;
}

export function summarize(
  breakdown: Map<Category, CategoryStats>,
  categories: Category[]
): Summary {
  const statsFor = (category: Category) => breakdown.get(category) ?? EMPTY_STATS;

  let totalAdded = 0;
  let totalRemoved = 0;
  let totalFiles = 0;
  for (const category of categories) {
    const stats = statsFor(category);
    totalAdded += stats.added;
    totalRemoved += stats.removed;
    totalFiles += stats.files;
  }
  const totalLines = totalAdded + totalRemoved;

  // Both bars are scaled to the same number, so a row's added and removed halves stay
  // comparable with every other row's.
  const scale = Math.max(totalAdded, totalRemoved, 1);

  const rows = categories.map((category) => {
    const stats = statsFor(category);
    return {
      category,
      stats,
      percent: totalLines > 0 ? Math.round((stats.total / totalLines) * 100) : 0,
      fileLabel: fileLabel(stats.files),
      isEmpty: stats.total === 0,
      addedWidth: (stats.added / scale) * 100,
      removedWidth: (stats.removed / scale) * 100,
    };
  });

  return {
    totalLines,
    totalFiles,
    totalAdded,
    totalRemoved,
    filesLabel: fileLabel(totalFiles),
    rows,
    emptyCount: rows.filter((row) => row.isEmpty).length,
  };
}

/**
 * The breakdown as a markdown table, for pasting into a PR description or a review comment.
 * Empty categories are left out — nobody wants nine rows of zeroes in a comment.
 */
export function toMarkdown(summary: Summary, options: { truncated?: boolean } = {}): string {
  const rows = summary.rows.filter((row) => !row.isEmpty);
  const lines = [
    "| Category | Files | Added | Removed | Share |",
    "| --- | --: | --: | --: | --: |",
    ...rows.map((row) =>
      `| ${row.category.name} | ${row.stats.files.toLocaleString()} ` +
      `| +${row.stats.added.toLocaleString()} | −${row.stats.removed.toLocaleString()} ` +
      `| ${row.percent}% |`
    ),
    `| **Total** | **${summary.totalFiles.toLocaleString()}** ` +
      `| **+${summary.totalAdded.toLocaleString()}** ` +
      `| **−${summary.totalRemoved.toLocaleString()}** | |`,
  ];

  if (options.truncated) {
    lines.push("", "_Counts cover the first 3,000 files; the GitHub API returns no more._");
  }

  return lines.join("\n");
}
