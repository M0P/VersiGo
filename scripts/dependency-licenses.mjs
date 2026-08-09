#!/usr/bin/env node
/**
 * VersiGo dependency license tool.
 *
 * Reads the installed pnpm virtual store (node_modules/.pnpm) and either
 *   generate – writes docs/third-party-notices.md (full library + license list),
 *   check    – validates every package against the license allowlist and that
 *              the notices document is up to date (exit 1 on violation),
 *   collect  – copies LICENSE/NOTICE/COPYING files of every package into a
 *              target directory (used by the web Dockerfile so the standalone
 *              Next.js output ships the required license texts).
 *
 * Usage:
 *   node scripts/dependency-licenses.mjs generate|check
 *   node scripts/dependency-licenses.mjs collect --pnpm-dir <dir> --out <dir>
 *
 * The license allowlist and the special-case notes are the single source of
 * truth for the project's license policy (docs/10-quality-and-library-policy.md
 * references this file).
 */
import { readdirSync, readFileSync, existsSync, mkdirSync, copyFileSync, writeFileSync, lstatSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// License policy (allowlist)
// ---------------------------------------------------------------------------
// Every license a dependency may carry. Entries are SPDX identifiers; a
// package may combine several of them with "OR". Anything else fails `check`.
const ALLOWED_LICENSES = new Set([
  'MIT',
  'Apache-2.0',
  'ISC',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'BlueOak-1.0.0',
  'Unlicense',
  '0BSD',
  'Python-2.0',
  'CC-BY-4.0',
  'LGPL-3.0-or-later',
]);

// Licenses that are NOT generally allowed – they are permitted only for the
// listed package names (documented in docs/10-quality-and-library-policy.md).
// A future dependency carrying one of these fails `check` unless approved here
// explicitly. Key: SPDX license, value: array of allowed package names.
const RESTRICTED_LICENSES = {
  'CC-BY-4.0': ['caniuse-lite'],
  'LGPL-3.0-or-later': ['@img/sharp-libvips-linuxmusl-x64'],
};

// Packages whose license field needs an explanation. Key: name (all versions).
// Value: short reason shown in the notices document.
const SPECIAL_CASES = {
  '@img/sharp-libvips-linuxmusl-x64':
    'LGPL-3.0-or-later: prebuilt libvips native binary used unmodified by sharp. LGPL allows use as an unmodified, dynamically loaded library; the binary bundles further third-party libraries (LGPLv3, MPL-2.0, BSD, MIT) listed in its own README (shipped with the license collection).',
  'caniuse-lite':
    'CC-BY-4.0: data-only package (browserslist support database); attribution required, no code obligations.',
  argparse:
    'Python-2.0: PSF-style permissive license; retain the license text with distributions.',
  busboy: 'MIT (license declared via LICENSE file and the deprecated "licenses" array).',
  'passport-strategy': 'MIT (license declared via the deprecated "licenses" array).',
  pause: 'MIT (license declared on the npm registry, not in the package.json of this legacy package).',
  streamsearch: 'MIT (license declared via LICENSE file and the deprecated "licenses" array).',
};

// Overrides for packages whose package.json declares no machine-readable
// license but whose license is documented on the npm registry. Key: name.
const KNOWN_LICENSES = {
  pause: 'MIT',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeLicense(lic) {
  if (!lic) return null;
  if (typeof lic === 'string') return lic.trim();
  if (Array.isArray(lic)) {
    const parts = lic.map(normalizeLicense).filter(Boolean);
    return parts.length ? parts.join(' OR ') : null;
  }
  if (typeof lic === 'object' && typeof lic.type === 'string') return lic.type.trim();
  return null;
}

function readPackageJson(pkgJsonPath) {
  try {
    const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
    // Newer packages use `license`, older ones the `licenses` array.
    const license = normalizeLicense(pkg.license ?? pkg.licenses);
    return { name: pkg.name, version: pkg.version, license };
  } catch {
    return null;
  }
}

/** Scan the pnpm virtual store; returns Map keyed by `name@version`. */
function scanStore(storeDir) {
  const results = new Map();
  for (const entry of readdirSync(storeDir)) {
    const pkgRoot = join(storeDir, entry, 'node_modules');
    if (!existsSync(pkgRoot)) continue;
    const collect = (pkgJsonPath) => {
      const info = readPackageJson(pkgJsonPath);
      if (!info) return;
      const key = `${info.name}@${info.version}`;
      const existing = results.get(key);
      // Prefer an entry that found a license over one that did not.
      if (!existing || (existing.license === null && info.license)) {
        results.set(key, info);
      }
    };
    for (const dir of readdirSync(pkgRoot)) {
      const base = join(pkgRoot, dir);
      if (dir.startsWith('@')) {
        for (const sub of readdirSync(base)) {
          const candidate = join(base, sub, 'package.json');
          if (existsSync(candidate)) collect(candidate);
        }
      } else {
        const candidate = join(base, 'package.json');
        if (existsSync(candidate)) collect(candidate);
      }
    }
  }
  // Apply registry-known licenses for packages without a declared license.
  for (const [name, license] of Object.entries(KNOWN_LICENSES)) {
    for (const info of results.values()) {
      if (info.name === name && info.license === null) info.license = license;
    }
  }
  return results;
}

function splitLicenseAlternatives(license) {
  if (!license) return [];
  return license.split(' OR ').map((s) => s.trim());
}

function allowlistViolations(packages) {
  const violations = [];
  for (const p of packages) {
    const alternatives = splitLicenseAlternatives(p.license);
    if (alternatives.length === 0) {
      violations.push({ package: `${p.name}@${p.version}`, reason: 'no license declared' });
      continue;
    }
    for (const alt of alternatives) {
      if (!ALLOWED_LICENSES.has(alt)) {
        violations.push({
          package: `${p.name}@${p.version}`,
          reason: `license "${alt}" not on the allowlist (${p.license})`,
        });
        continue;
      }
      const allowedPackages = RESTRICTED_LICENSES[alt];
      if (allowedPackages && !allowedPackages.includes(p.name)) {
        violations.push({
          package: `${p.name}@${p.version}`,
          reason: `license "${alt}" is restricted to ${allowedPackages.join(', ')} (${p.license})`,
        });
      }
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------
// Markdown generation
// ---------------------------------------------------------------------------

const NOTICES_HEADER = `# Third-Party Notices – VersiGo

VersiGo v1.0.0-beta.1 – Third-party software notices.

This file lists every npm package (direct and transitive) installed for the
VersiGo workspace, together with its license. It is generated by
\`node scripts/dependency-licenses.mjs generate\` from the installed pnpm
virtual store (\`node_modules/.pnpm\`) and must stay in sync with
\`pnpm-lock.yaml\` (enforced by \`node scripts/dependency-licenses.mjs check\`).

## License usage rules (summary)

Every package below is used as intended under its license:

- **Permissive licenses (MIT, Apache-2.0, ISC, BSD-2/3-Clause, BlueOak-1.0.0,
  0BSD, Unlicense, Python-2.0):** used unmodified as a library, attribution is
  provided through this notice file, and the license texts ship with the
  distributed artifacts (Docker images) via the node_modules copy or the
  web-image license collection.
- **CC-BY-4.0 (\`caniuse-lite\`):** data-only; attributed here.
- **LGPL-3.0-or-later (\`@img/sharp-libvips-linuxmusl-x64\`):** the prebuilt
  libvips native binary is used unmodified and loaded dynamically by sharp;
  LGPL permits this. Its own README (shipped with the license collection)
  lists the bundled third-party libraries (LGPLv3, MPL-2.0, BSD, MIT).

## License summary

| License | Packages |
|---------|----------|
`;

// Deterministic, filesystem/locale-independent ordering for the generated
// document (readdir order and localeCompare are not stable across platforms).
function comparePackages(a, b) {
  if (a.name !== b.name) return a.name < b.name ? -1 : 1;
  if (a.version !== b.version) return a.version < b.version ? -1 : 1;
  return 0;
}

function buildNoticesMarkdown(packages, licenseCounts) {
  const lines = [NOTICES_HEADER];
  const sorted = [...licenseCounts.entries()].sort(
    (a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0),
  );
  for (const [lic, count] of sorted) lines.push(`| ${lic} | ${count} |`);
  lines.push(
    '',
    `Total: ${packages.length} packages (direct and transitive, incl. dev tooling).`,
    '',
    '## Package inventory',
    '',
  );
  const byLicense = new Map();
  for (const p of packages) {
    const key = p.license ?? '(license not declared)';
    if (!byLicense.has(key)) byLicense.set(key, []);
    byLicense.get(key).push(p);
  }
  for (const [license, pkgs] of [...byLicense.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))) {
    lines.push(`### ${license}`, '');
    for (const p of [...pkgs].sort(comparePackages)) {
      lines.push(`- \`${p.name}@${p.version}\``);
    }
    lines.push('');
  }
  lines.push('## Special cases', '');
  for (const [name, reason] of Object.entries(SPECIAL_CASES).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))) {
    lines.push(`- **${name}:** ${reason}`, '');
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Modes
// ---------------------------------------------------------------------------

function findStoreDir() {
  // Walk up from the caller's cwd to the nearest node_modules/.pnpm so the
  // tool works from any subdirectory of the workspace (e.g. apps/web).
  let dir = process.cwd();
  for (;;) {
    const candidate = join(dir, 'node_modules', '.pnpm');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('pnpm virtual store node_modules/.pnpm not found – run "pnpm install" first');
}

// The pnpm virtual store keeps each installed variant as
//   node_modules/.pnpm/<name>@<version>[_peer-hash]/node_modules/<name>
// (scoped: <entry>/node_modules/@scope/<name>). The entry's node_modules also
// contains symlinked dependencies; those must NOT be walked (they belong to
// other entries and would duplicate/overwrite files).
function packageDirsOfEntry(entryPath) {
  const dirs = [];
  for (const d of readdirSync(entryPath)) {
    const full = join(entryPath, d);
    let st;
    try {
      st = lstatSync(full);
    } catch {
      continue;
    }
    if (!st.isDirectory() || st.isSymbolicLink()) continue;
    if (d.startsWith('@')) {
      for (const sub of readdirSync(full)) {
        const subFull = join(full, sub);
        let subSt;
        try {
          subSt = lstatSync(subFull);
        } catch {
          continue;
        }
        if (subSt.isDirectory() && !subSt.isSymbolicLink()) dirs.push(subFull);
      }
    } else if (existsSync(join(full, 'package.json'))) {
      dirs.push(full);
    }
  }
  return dirs;
}

// Walk one package directory and copy every license-ish file (LICENSE*,
// COPYING*, NOTICE*, COPYRIGHT*) into the destination. Returns the number of
// files copied. Does not follow symlinks (avoids cycles and .bin/deps) and
// never overwrites an already-copied file (a package may ship the same
// license text at several paths).
function copyLicenseFiles(pkgDir, destDir) {
  let copied = 0;
  const walk = (dir) => {
    for (const f of readdirSync(dir)) {
      const full = join(dir, f);
      let st;
      try {
        st = lstatSync(full);
      } catch {
        continue;
      }
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) {
        walk(full);
      } else if (/^(LICENSE|LICENCE|COPYING|NOTICE|COPYRIGHT|UNLICENSE)(\..*)?$/i.test(f)) {
        const destFile = join(destDir, f);
        if (!existsSync(destFile)) {
          copyFileSync(full, destFile);
          copied += 1;
        }
      }
    }
  };
  walk(pkgDir);
  return copied;
}

// Write a short NOTICE.txt documenting a package whose tarball ships no
// license text at all (e.g. platform binary stubs like @esbuild/linux-x64).
function writeMissingLicenseNotice(pkgDir, destDir) {
  let name = '';
  let version = '';
  let license = null;
  let repo = '';
  try {
    const json = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
    if (json.name) name = json.name;
    if (json.version) version = json.version;
    license = normalizeLicense(json.license ?? json.licenses);
    if (json.repository) {
      repo = typeof json.repository === 'string' ? json.repository : json.repository.url ?? '';
    }
  } catch { /* ignore unparseable metadata */ }
  const notice = [
    'VersiGo third-party notice',
    '',
    `Package: ${name}@${version}`,
    `License: ${license ?? 'not declared in package.json'}`,
    ...(repo ? [`Repository: ${repo}`] : []),
    '',
    'This package ships no license text file. Its license, if declared, is',
    'listed in package.json. The full license text is available from the',
    'SPDX license list or the package repository above.',
    '',
  ].join('\n');
  writeFileSync(join(destDir, 'NOTICE.txt'), notice);
  return 1;
}

function collectLicenses(pnpmDir, outDir) {
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  let copied = 0;
  for (const entry of readdirSync(pnpmDir)) {
    const entryPath = join(pnpmDir, entry);
    const nodeModules = join(entryPath, 'node_modules');
    if (!existsSync(nodeModules)) continue;
    const destDir = join(outDir, entry);
    mkdirSync(destDir, { recursive: true });
    // Copy each package's license texts into its own subdirectory so
    // same-named files (e.g. every MIT package ships LICENSE) cannot
    // overwrite each other.
    for (const pkgDir of packageDirsOfEntry(nodeModules)) {
      const pkgRelPath = relative(nodeModules, pkgDir);
      const pkgDestDir = join(destDir, pkgRelPath);
      mkdirSync(pkgDestDir, { recursive: true });
      const n = copyLicenseFiles(pkgDir, pkgDestDir);
      copied += n;
      if (n === 0) {
        // Fallback: some packages document their license only in the README
        // (e.g. @img/sharp-libvips-linuxmusl-x64 lists its bundled LGPLv3/
        // MPL-2.0/BSD/MIT libraries there). Match case-insensitively
        // (some legacy packages ship "Readme.md").
        const readmeName = readdirSync(pkgDir).find((f) => f.toLowerCase() === 'readme.md');
        const readme = readmeName ? join(pkgDir, readmeName) : null;
        if (readme && existsSync(readme)) {
          copyFileSync(readme, join(pkgDestDir, 'README.md'));
          copied += 1;
        } else {
          copied += writeMissingLicenseNotice(pkgDir, pkgDestDir);
        }
      }
    }
  }
  return copied;
}

const mode = process.argv[2];
if (!mode) {
  console.error('usage: node scripts/dependency-licenses.mjs generate|check|collect');
  process.exit(2);
}

// Resolve docs/ relative to this script (not the caller's cwd) so the tool
// works from any directory.
const NOTICES_DOC_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'third-party-notices.md');

if (mode === 'collect') {
  const pnpmArg = process.argv.indexOf('--pnpm-dir');
  const outArg = process.argv.indexOf('--out');
  const pnpmDir = pnpmArg >= 0 ? process.argv[pnpmArg + 1] : null;
  const outDir = outArg >= 0 ? process.argv[outArg + 1] : null;
  if (!pnpmDir || !outDir) {
    console.error('collect requires --pnpm-dir <dir> and --out <dir>');
    process.exit(2);
  }
  const copied = collectLicenses(pnpmDir, outDir);
  console.error(`Collected ${copied} license files into ${outDir}.`);
  process.exit(0);
}

const storeDir = findStoreDir();
const packages = [...scanStore(storeDir).values()];

if (mode === 'generate') {
  const licenseCounts = new Map();
  for (const p of packages) {
    const key = p.license ?? '(license not declared)';
    licenseCounts.set(key, (licenseCounts.get(key) ?? 0) + 1);
  }
  const notices = buildNoticesMarkdown(packages, licenseCounts);
  writeFileSync(NOTICES_DOC_PATH, notices);
  console.error(`Generated ${NOTICES_DOC_PATH} (${packages.length} packages).`);
} else if (mode === 'check') {
  const violations = allowlistViolations(packages);
  let ok = true;
  if (violations.length > 0) {
    ok = false;
    console.error('LICENSE POLICY VIOLATIONS:');
    for (const v of violations) console.error(`  - ${v.package}: ${v.reason}`);
  }
  if (existsSync(NOTICES_DOC_PATH)) {
    const licenseCounts = new Map();
    for (const p of packages) {
      const key = p.license ?? '(license not declared)';
      licenseCounts.set(key, (licenseCounts.get(key) ?? 0) + 1);
    }
    const current = readFileSync(NOTICES_DOC_PATH, 'utf8');
    const expected = buildNoticesMarkdown(packages, licenseCounts);
    if (current !== expected) {
      ok = false;
      console.error('docs/third-party-notices.md is out of date – run "node scripts/dependency-licenses.mjs generate".');
    }
  } else {
    ok = false;
    console.error('docs/third-party-notices.md missing – run "node scripts/dependency-licenses.mjs generate".');
  }
  console.error(`Checked ${packages.length} packages.`);
  if (!ok) process.exit(1);
  console.error('License check: OK.');
} else {
  console.error(`unknown mode: ${mode}`);
  process.exit(2);
}
