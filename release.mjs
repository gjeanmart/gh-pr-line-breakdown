#!/usr/bin/env node
// Usage: node release.mjs <version> [--dry-run]   e.g.  node release.mjs 0.2.0 --dry-run
//
// Everything that can be checked is checked before anything is changed, because the failures
// that hurt here are the half-finished ones: a bumped working tree with no commit, or a
// commit on the wrong branch. --dry-run runs every check and prints every command, and
// changes nothing.

import { execFileSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';

// npm and pnpm ship as .cmd shims on Windows, which execFileSync cannot spawn without a
// shell. This script is a maintainer convenience run on a developer machine, and CI invokes
// pnpm directly, so the simple form is enough — but that is why the name is a variable.
const PACKAGE_MANAGER = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const RELEASE_BRANCH = 'main';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const version = args.find((arg) => !arg.startsWith('--'));

const fail = (message, hint) => {
  console.error(`\n✗ ${message}`);
  if (hint) console.error(`  ${hint}`);
  process.exit(1);
};

if (!version) {
  fail('No version given.', 'Usage: node release.mjs <version> [--dry-run]  (e.g. 1.2.3)');
}

if (!/^\d+\.\d+\.\d+$/.test(version)) {
  fail(`Invalid version "${version}".`, 'Must be semver, e.g. 1.2.3');
}

const tag = `v${version}`;

// execFileSync, not execSync: arguments are passed to the process directly rather than to a
// shell that parses them, so a version string can never be read as anything but one argument.
// The semver check above already made that impossible, but a guarantee from the API beats a
// guarantee from a regex — and it is what lets the commit message keep its spaces without
// quoting games.
const capture = (file, args) => execFileSync(file, args).toString().trim();

const run = (file, args) => {
  if (dryRun) {
    console.log(`  would run: ${file} ${args.join(' ')}`);
    return;
  }
  execFileSync(file, args, { stdio: 'inherit' });
};

// ── Checks, all of them, before anything changes ─────────────────────────────────────
console.log(`\n▶ Checking${dryRun ? ' (dry run — nothing will be changed)' : ''}…`);

const branch = capture('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
if (branch !== RELEASE_BRANCH) {
  // The push below is hard-coded to main, so releasing from elsewhere would commit the bump
  // to this branch and then push a main that does not contain it.
  fail(`On branch "${branch}", not ${RELEASE_BRANCH}.`, `git switch ${RELEASE_BRANCH}`);
}

if (capture('git', ['status', '--porcelain'])) {
  fail('Working tree is not clean.', 'Commit or stash your changes first.');
}

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));

if (pkg.version === version && manifest.version === version) {
  // Left alone, the bump below writes nothing, git commit finds nothing staged, and the
  // script dies on an error that says nothing about the actual situation.
  fail(
    `package.json and manifest.json are already at ${version}.`,
    'Nothing to bump — pick a new version, or push the existing tag by hand if a release stalled.'
  );
}

const existingTags = capture('git', ['tag', '--list', tag]);
if (existingTags) {
  fail(`Tag ${tag} already exists.`, `git tag -d ${tag}  (and delete it on the remote too)`);
}

console.log(`  branch        ${branch}`);
console.log(`  working tree  clean`);
console.log(`  version       ${pkg.version} → ${version}`);
console.log(`  tag           ${tag} is free`);

// ── Tests ────────────────────────────────────────────────────────────────────────────
// Run even in a dry run: knowing the suite passes is most of what a rehearsal is for.
console.log('\n▶ Running tests…');
execFileSync(PACKAGE_MANAGER, ['test'], { stdio: 'inherit' });

// ── Bump ─────────────────────────────────────────────────────────────────────────────
console.log(`\n▶ Bumping version to ${version}…`);
if (dryRun) {
  console.log('  would write: package.json, manifest.json');
} else {
  pkg.version = version;
  writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
  manifest.version = version;
  writeFileSync('manifest.json', JSON.stringify(manifest, null, 2) + '\n');
}

// ── Commit and tag ───────────────────────────────────────────────────────────────────
console.log('\n▶ Committing version bump…');
run('git', ['add', 'package.json', 'manifest.json']);
run('git', ['commit', '-m', `chore: bump version to ${tag}`]);

console.log(`\n▶ Tagging ${tag}…`);
// Pass a message so this works with tag.gpgSign / tag.forceSignAnnotated set: a signed
// tag is annotated, and an annotated tag without -m needs an editor to write one.
run('git', ['tag', '-m', tag, tag]);

// ── Push ─────────────────────────────────────────────────────────────────────────────
console.log('\n▶ Pushing to origin…');
run('git', ['push', 'origin', RELEASE_BRANCH]);
run('git', ['push', 'origin', tag]);

console.log(
  dryRun
    ? `\n✓ Dry run complete — ${tag} is ready to release. Re-run without --dry-run to do it.`
    : `\n✓ Released ${tag} — the CI/CD workflow will build and publish the extension.`
);
