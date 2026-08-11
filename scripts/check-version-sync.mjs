#!/usr/bin/env node
/**
 * VersiGo version-sync check.
 *
 * The "version" field in the ROOT package.json is the single source of truth.
 * This script verifies that every location that carries the version still
 * matches it:
 *   - all 5 workspace package.json files (root, api, worker, web, foundation)
 *   - docker-compose.yml  (APP_VERSION + NEXT_PUBLIC_APP_VERSION defaults)
 *   - docker-compose.dockerhub.yml (same defaults)
 *   - .env.example (APP_VERSION + NEXT_PUBLIC_APP_VERSION)
 *   - scripts/dependency-licenses.mjs (NOTICES_HEADER version line)
 *   - docs/third-party-notices.md (generated notices header version line)
 *
 * Exit code 0 when everything is in sync, 1 with a list of mismatches
 * otherwise. Intended for the CI test gate (docker-compose.test.yml) and for
 * manual verification after `node scripts/bump-version.mjs <new-version>`.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

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

function read(rel) {
  return readFileSync(join(ROOT, rel), 'utf8');
}

const problems = [];

// Reads a file and reports a clear problem instead of crashing with a raw
// stack trace when the file is missing or unreadable (fail-closed: exit 1).
function readChecked(rel) {
  try {
    return read(rel);
  } catch {
    problems.push(`${rel}: missing or unreadable file`);
    return null;
  }
}

// Single source of truth. The read + parse are guarded so a missing or
// malformed root package.json yields a clean diagnostic instead of a stack
// trace / TypeError on a missing, non-string, or malformed "version" field.
let version = null;
{
  const root = readChecked('package.json');
  if (root !== null) {
    let parsed = null;
    try {
      parsed = JSON.parse(root);
    } catch {
      // fall through: parsed stays null and is reported once below
    }
    if (typeof parsed !== 'object' || parsed === null) {
      // Covers a throwing parse (parsed stays null), JSON.parse('null'), and
      // JSON primitives ("1.2.3", 42) – all malformed for our purposes. Guard
      // BEFORE the 'version' in parsed check, which would throw a raw
      // TypeError on a primitive.
      problems.push('package.json: malformed JSON');
    } else {
      if (!('version' in parsed)) {
        problems.push('package.json: missing "version" field');
      } else {
        const raw = parsed.version;
        if (typeof raw === 'string' && raw.length > 0) {
          version = raw;
        } else {
          problems.push('package.json: "version" must be a non-empty string');
        }
      }
    }
  }
}
if (version === null) {
  console.error('Version sync check FAILED:');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

// 1) package.json files
for (const rel of PKG_JSON_FILES) {
  const content = readChecked(rel);
  if (content === null) continue;
  let pkg;
  try {
    pkg = JSON.parse(content);
  } catch {
    problems.push(`${rel}: malformed JSON`);
    continue;
  }
  if (typeof pkg !== 'object' || pkg === null) {
    // JSON.parse('null') returns null, and JSON primitives ("1.2.3", 42)
    // pass the parse – both are malformed for our purposes. A raw TypeError
    // on pkg.version is avoided; report a clean problem instead.
    problems.push(`${rel}: malformed JSON`);
    continue;
  }
  if (pkg.version !== version) {
    problems.push(`${rel}: version "${pkg.version}" != "${version}"`);
  }
}

// 2) Compose files: both env defaults must carry the version. The `${`
// prefix disambiguates APP_VERSION from NEXT_PUBLIC_APP_VERSION. Comment
// lines are skipped (a default mentioned only in a YAML comment does not
// count), and the occurrence counts must match between the two compose
// files, so a default silently dropped in one service of one file is caught.
const composeCounts = {};
for (const rel of COMPOSE_FILES) {
  const content = readChecked(rel);
  if (content === null) continue;
  const codeLines = content.split('\n').filter((line) => !line.trim().startsWith('#'));
  const appVersion = `\${APP_VERSION:-${version}}`;
  const webVersion = `\${NEXT_PUBLIC_APP_VERSION:-${version}}`;
  const joined = codeLines.join('\n');
  const appCount = joined.split(appVersion).length - 1;
  const webCount = joined.split(webVersion).length - 1;
  composeCounts[rel] = { appCount, webCount };
  if (appCount < 1) {
    problems.push(`${rel}: missing env default "${appVersion}"`);
  }
  if (webCount < 1) {
    problems.push(`${rel}: missing env default "${webVersion}"`);
  }
}
if (composeCounts['docker-compose.yml'] && composeCounts['docker-compose.dockerhub.yml']) {
  for (const key of ['appCount', 'webCount']) {
    if (composeCounts['docker-compose.yml'][key] !== composeCounts['docker-compose.dockerhub.yml'][key]) {
      problems.push(
        `compose files disagree on ${key} (docker-compose.yml=${composeCounts['docker-compose.yml'][key]}, ` +
          `docker-compose.dockerhub.yml=${composeCounts['docker-compose.dockerhub.yml'][key]})`,
      );
    }
  }
}

// 3) .env.example – anchored to a full line so the shorter key (APP_VERSION)
// cannot match inside the longer NEXT_PUBLIC_APP_VERSION line. The version is
// escaped so future versions with regex-special characters (e.g. "+meta")
// cannot corrupt the pattern; `\r?$` tolerates CRLF checkouts.
{
  const content = readChecked(ENV_EXAMPLE);
  if (content !== null) {
    const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const appLine = new RegExp(`^APP_VERSION=${escaped}\\r?$`, 'm');
    const webLine = new RegExp(`^NEXT_PUBLIC_APP_VERSION=${escaped}\\r?$`, 'm');
    if (!appLine.test(content)) {
      problems.push(`${ENV_EXAMPLE}: missing line "APP_VERSION=${version}"`);
    }
    if (!webLine.test(content)) {
      problems.push(`${ENV_EXAMPLE}: missing line "NEXT_PUBLIC_APP_VERSION=${version}"`);
    }
  }
}

// 4) License tool header + generated notices document. Anchored to the start
// of a line so a stray "VersiGo v<version>" elsewhere in the file does not
// satisfy the check, and guarded against string-superset versions: the
// lookahead rejects any trailing version-like character, including semver
// build metadata ("+" suffix, e.g. "VersiGo v1.0.0-beta.2+meta" must NOT pass
// when the root version is 1.0.0-beta.2).
for (const rel of [LICENSES_SCRIPT, NOTICES_DOC]) {
  const content = readChecked(rel);
  if (content === null) continue;
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const header = new RegExp(`^VersiGo v${escaped}(?![0-9A-Za-z.+-])`, 'm');
  if (!header.test(content)) {
    problems.push(`${rel}: missing "VersiGo v${version}" header`);
  }
}

if (problems.length > 0) {
  console.error(`Version sync check FAILED (root package.json = "${version}"):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

console.log(`Version sync check: OK – all locations match "${version}".`);
