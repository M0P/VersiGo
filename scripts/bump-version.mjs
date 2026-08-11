#!/usr/bin/env node
/**
 * VersiGo version bump tool.
 *
 * Single source of truth: the "version" field in the ROOT package.json.
 * This script propagates a new version to every location that must stay in
 * sync:
 *   - all 5 workspace package.json files (root, api, worker, web, foundation)
 *   - docker-compose.yml  (APP_VERSION + NEXT_PUBLIC_APP_VERSION defaults)
 *   - docker-compose.dockerhub.yml (same defaults)
 *   - .env.example (APP_VERSION + NEXT_PUBLIC_APP_VERSION)
 *   - scripts/dependency-licenses.mjs (NOTICES_HEADER version line)
 *   - docs/third-party-notices.md (generated notices header version line)
 *
 * pnpm-lock.yaml needs NO update: workspace packages are referenced with
 * `link:`/`workspace:*`, so the lockfile never contains the version string.
 *
 * Usage:
 *   node scripts/bump-version.mjs <new-version>     # e.g. 1.0.0-beta.2
 *
 * The counter-check `node scripts/check-version-sync.mjs` (and the CI test
 * gate) fails when any of these locations drifts from the root package.json.
 *
 * NOTE: the version is injected into the web container at STARTUP via the
 * entrypoint (apps/web/docker-entrypoint.sh writes /runtime-config.js from
 * NEXT_PUBLIC_APP_VERSION); a container restart with the new env value is
 * sufficient – no image rebuild is required.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// "semver-ish": MAJOR.MINOR.PATCH with an optional prerelease. Deliberately
// relaxed compared to strict SemVer (leading zeros are accepted, build
// metadata "+..." is not) – the project's versions are e.g. 1.0.0-beta.2.
const VERSION_PATTERN = /^\d+\.\d+\.\d+(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$/;

const PKG_JSON_FILES = [
  'package.json',
  'apps/api/package.json',
  'apps/worker/package.json',
  'apps/web/package.json',
  'packages/foundation/package.json',
];

const COMPOSE_FILES = ['docker-compose.yml', 'docker-compose.dockerhub.yml'];

const ENV_EXAMPLE = '.env.example';
const LICENSES_SCRIPT = 'scripts/dependency-licenses.mjs';
const NOTICES_DOC = 'docs/third-party-notices.md';

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function readText(rel) {
  try {
    return readFileSync(join(ROOT, rel), 'utf8');
  } catch {
    fail(`${rel} is missing or unreadable – aborting before any file is written.`);
  }
}

function readJson(rel) {
  try {
    return JSON.parse(readText(rel));
  } catch {
    fail(`${rel} contains malformed JSON – aborting before any file is written.`);
  }
}

// All changes are staged in memory and only written once every file has been
// validated, so a validation failure never leaves a partially bumped tree.
// Note: an I/O failure DURING the write loop (disk full, permissions) can
// still leave a partial state – run "node scripts/check-version-sync.mjs"
// afterwards to detect any remaining mismatch. Do NOT just re-run this script
// then: restore the already-written files (e.g. via git checkout) before
// re-running (see the write loop below).
const pending = [];

function stage(rel, transform) {
  const path = join(ROOT, rel);
  const original = readText(rel);
  const next = transform(original);
  if (next === original) {
    fail(`${rel} is unchanged by the requested replacement – aborting before any file is written.`);
  }
  pending.push({ rel, path, content: next });
}

function replaceToken(text, search, replacement) {
  // Token-anchored literal replacement: the search string is regex-escaped and
  // must NOT be followed by a version-like character. A target that already
  // carries a string-superset of the current version (drift, e.g. ...beta.10
  // when the current version is ...beta.1) is a pre-existing inconsistency:
  // the pre-check below catches it and aborts before anything is written,
  // instead of silently rewriting only the exact occurrence.
  const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (new RegExp(`${escaped}[0-9A-Za-z.-]`).test(text)) {
    fail(
      `"${search}" is followed by version-like characters in the file ` +
        '(string-superset drift, e.g. a "…beta.10" next to "…beta.1") – ' +
        'aborting before any file is written. Fix the drift manually first.',
    );
  }
  const next = text.replace(new RegExp(`${escaped}(?![0-9A-Za-z.-])`, 'g'), replacement);
  if (next === text) {
    fail(`"${search}" not found in the file content – aborting before any file is written.`);
  }
  return next;
}

// Read the current version from the single source of truth.
const rootPkg = readJson('package.json');
const current = rootPkg.version;

const newVersion = process.argv[2]?.trim();
if (!newVersion) {
  fail('usage: node scripts/bump-version.mjs <new-version>');
}
if (!VERSION_PATTERN.test(newVersion)) {
  fail(`"${newVersion}" is not a valid version (expected e.g. 1.0.0 or 1.0.0-beta.2).`);
}
if (newVersion === current) {
  fail(`"${newVersion}" is already the current version – nothing to do.`);
}

console.log(`VersiGo version: ${current} -> ${newVersion}\n`);

// 1) package.json files (parse + re-serialize to keep formatting stable).
for (const rel of PKG_JSON_FILES) {
  const pkg = readJson(rel);
  if (pkg.version !== current) {
    fail(`${rel} has version "${pkg.version}", expected "${current}".`);
  }
  pkg.version = newVersion;
  stage(rel, () => `${JSON.stringify(pkg, null, 2)}\n`);
  console.log(`  staged ${rel}`);
}

// 2) Compose files: APP_VERSION + NEXT_PUBLIC_APP_VERSION env defaults.
// The `${` prefix disambiguates APP_VERSION from NEXT_PUBLIC_APP_VERSION.
for (const rel of COMPOSE_FILES) {
  stage(
    rel,
    (text) =>
      replaceToken(replaceToken(text, `\${APP_VERSION:-${current}}`, `\${APP_VERSION:-${newVersion}}`),
        `${NEXT_PUBLIC_APP_VERSION:-${current}}`,
        `${NEXT_PUBLIC_APP_VERSION:-${newVersion}}`),
  );
  console.log(`  staged ${rel}`);
}

// 3) .env.example – replace whole lines, anchored to the line start, so the
// shorter key APP_VERSION can never match inside the NEXT_PUBLIC_APP_VERSION
// line – even when the new version is a string-superset of the current one
// (e.g. beta.1 -> beta.10). A trailing "\r" (CRLF checkout) is ignored for
// comparison and preserved in the replacement; BOTH lines must be replaced –
// if either is missing the run aborts before any file is written.
stage(ENV_EXAMPLE, (text) => {
  let appFound = false;
  let webFound = false;
  const updated = text
    .split('\n')
    .map((line) => {
      const cr = line.endsWith('\r');
      const trimmed = cr ? line.slice(0, -1) : line;
      if (trimmed === `APP_VERSION=${current}`) {
        appFound = true;
        return cr ? `APP_VERSION=${newVersion}\r` : `APP_VERSION=${newVersion}`;
      }
      if (trimmed === `NEXT_PUBLIC_APP_VERSION=${current}`) {
        webFound = true;
        return cr ? `NEXT_PUBLIC_APP_VERSION=${newVersion}\r` : `NEXT_PUBLIC_APP_VERSION=${newVersion}`;
      }
      return line;
    })
    .join('\n');
  if (!appFound || !webFound) {
    fail(`${ENV_EXAMPLE}: missing line "APP_VERSION=${current}" or "NEXT_PUBLIC_APP_VERSION=${current}" – aborting before any file is written.`);
  }
  return updated;
});
console.log(`  staged ${ENV_EXAMPLE}`);

// 4) License tool header + generated notices document.
stage(LICENSES_SCRIPT, (text) => replaceToken(text, `VersiGo v${current}`, `VersiGo v${newVersion}`));
stage(NOTICES_DOC, (text) => replaceToken(text, `VersiGo v${current}`, `VersiGo v${newVersion}`));
console.log(`  staged ${LICENSES_SCRIPT}`);
console.log(`  staged ${NOTICES_DOC}`);

// All validations passed – write every staged file. An I/O failure mid-loop
// (disk full, permissions) can still leave a partial state; report it clearly
// and point to the sync check so it can be detected and repaired. NOTE: do
// NOT just re-run this script in that case – the root package.json (and any
// already-written file) is already on the new version, so a re-run fails.
// Restore the already-written files to the old version first (e.g. via git
// checkout), or fix the drift manually per the check output.
for (const { rel, path, content } of pending) {
  try {
    writeFileSync(path, content, 'utf8');
    console.log(`  wrote ${rel}`);
  } catch (err) {
    fail(
      `could not write ${rel}: ${err.message} – a PARTIAL BUMP is possible. ` +
        'Run "node scripts/check-version-sync.mjs" to see which locations ' +
        'still drift, then restore the already-written files (e.g. via git ' +
        'checkout) and re-run this script.',
    );
  }
}

console.log(`
Done. Version is now ${newVersion} everywhere (single source: root package.json).

Reminders:
- The version reaches the web UI at container STARTUP (entrypoint writes
  /runtime-config.js from NEXT_PUBLIC_APP_VERSION) – restart the web
  container so the footer shows the new version (no image rebuild needed).
- Run "node scripts/check-version-sync.mjs" (or the CI test gate) to verify
  all locations are in sync.
- For a release: create the git tag and the release notes manually.
`);
