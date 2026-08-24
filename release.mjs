#!/usr/bin/env node
// Usage: node release.mjs <version>   e.g.  node release.mjs 0.2.0

import { execFileSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';

// npm and pnpm ship as .cmd shims on Windows, which execFileSync cannot spawn without a
// shell. This script is a maintainer convenience run on a developer machine, and CI invokes
// pnpm directly, so the simple form is enough — but that is why the name is a variable.
const PACKAGE_MANAGER = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

const version = process.argv[2];

if (!version) {
  console.error('Usage: node release.mjs <version>  (e.g. node release.mjs 0.2.0)');
  process.exit(1);
}

if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`Invalid version "${version}" — must be semver (e.g. 1.2.3)`);
  process.exit(1);
}

// execFileSync, not execSync: arguments are passed to the process directly rather than to a
// shell that parses them, so a version string can never be read as anything but one argument.
// The semver check above already made that impossible, but a guarantee from the API beats a
// guarantee from a regex — and it is what lets the commit message keep its spaces without
// quoting games.
const run = (file, args) => execFileSync(file, args, { stdio: 'inherit' });

// 1. Ensure clean working tree
const status = execFileSync('git', ['status', '--porcelain']).toString().trim();
if (status) {
  console.error('Working tree is not clean. Commit or stash changes first.');
  process.exit(1);
}

// 2. Run tests
console.log('\n▶ Running tests…');
run(PACKAGE_MANAGER, ['test']);

// 3. Bump versions in package.json and manifest.json
console.log(`\n▶ Bumping version to ${version}…`);

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
pkg.version = version;
writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');

const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
manifest.version = version;
writeFileSync('manifest.json', JSON.stringify(manifest, null, 2) + '\n');

// 4. Commit and tag
console.log('\n▶ Committing version bump…');
run('git', ['add', 'package.json', 'manifest.json']);
run('git', ['commit', '-m', `chore: bump version to v${version}`]);

console.log(`\n▶ Tagging v${version}…`);
// Pass a message so this works with tag.gpgSign / tag.forceSignAnnotated set: a signed
// tag is annotated, and an annotated tag without -m needs an editor to write one.
run('git', ['tag', '-m', `v${version}`, `v${version}`]);

// 5. Push commit + tag
console.log('\n▶ Pushing to origin…');
run('git', ['push', 'origin', 'main']);
run('git', ['push', 'origin', `v${version}`]);

console.log(`\n✓ Released v${version} — the CI/CD workflow will build and publish the extension.`);
