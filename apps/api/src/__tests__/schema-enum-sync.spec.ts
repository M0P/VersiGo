import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * BugFix-24 (E824D00): Synchronisations-Guard zwischen Prisma-Schema und
 * Datenbank-Migrationen.
 *
 * Fehlerklasse: Ein Enumwert wurde zum Prisma-Schema hinzugefuegt (die UI
 * bietet ihn an), aber nie per Migration in die DB geschrieben. Die Drift
 * bleibt bei `prisma migrate dev` unsichtbar und faellt erst zur Laufzeit
 * als aufsehenerregender PostgreSQL-Fehler auf:
 *
 *   ERROR: invalid input value for enum "InsurancePolicyType":
 *          "RENTENVERSICHERUNG"
 *
 * Dieser Guard parst prisma/schema.prisma sowie alle *.sql-Migrationen
 * (CREATE-TYPE-Anlagen inkl. ADD-VALUE-Ergaenzungen) und fordert, dass
 * jeder Schema-Enumwert zumindest in einer Migration vorkommt. Er laeuft
 * ohne Datenbank und ohne Prisma-Client, damit er in jedem Testlauf greift.
 */

// Der Test wird mit cwd = apps/api (workspace `pnpm run test`) gestartet; die
// Suche geht so lange nach oben, bis das Repositorium mit prisma/schema.prisma
// gefunden ist. `import.meta` entfaellt bewusst: apps/api wird mit
// module=CommonJS typegecheckt (tsconfig.json).
function findRepoRoot(startDir: string): string {
  let dir = resolve(startDir);
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(join(dir, 'prisma', 'schema.prisma'))) return dir;
    const parent = resolve(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`Repositoriumswurzel ab ${startDir} nicht gefunden`);
}

const REPO_ROOT = findRepoRoot(process.cwd());
const SCHEMA_PATH = join(REPO_ROOT, 'prisma', 'schema.prisma');
const MIGRATIONS_DIR = join(REPO_ROOT, 'prisma', 'migrations');

/** Enum-Definitionen aus dem Prisma-Schema: Name -> Werteliste. */
function parseSchemaEnums(schema: string): Map<string, string[]> {
  const enums = new Map<string, string[]>();
  const pattern = /enum\s+(\w+)\s*\{([^}]*)\}/g;
  for (const match of schema.matchAll(pattern)) {
    const name = match[1];
    const body = match[2]
      .split('\n')
      .map((line) => line.replace(/\/\/.*$/, '').trim())
      .filter((line) => line.length > 0);
    enums.set(name, body);
  }
  return enums;
}

/** Wertemengen, die eine Migration fuer ein Enum definiert. */
type MigrationValues = { created: Set<string>; added: Set<string> };

function emptyValues(): MigrationValues {
  return { created: new Set(), added: new Set() };
}

/**
 * Liest alle Migrationen und aggregiert pro Enum die per CREATE TYPE
 * angelegten sowie die per ALTER TYPE ADD VALUE ergaenzten Werte. Reihen-
 * folge und Mehrfachvorkommen sind ohne Belang, entscheidend ist die
 * Gesamtmenge der je Enum verfuegbaren Werte.
 */
function collectMigrationValues(dir: string): Map<string, MigrationValues> {
  const byEnum = new Map<string, MigrationValues>();
  const ensure = (name: string): MigrationValues => {
    let values = byEnum.get(name);
    if (!values) {
      values = emptyValues();
      byEnum.set(name, values);
    }
    return values;
  };

  // Prisma keeps one migration per subdirectory
  // (migrations/<timestamp>_<name>/migration.sql); flat *.sql files next to
  // them are accepted as well so the guard keeps working if that changes.
  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const sqlFiles = entries
    .flatMap((entry) => {
      if (entry.isFile() && entry.name.endsWith('.sql')) return [join(dir, entry.name)];
      if (!entry.isDirectory()) return [];
      const nested = join(dir, entry.name, 'migration.sql');
      return existsSync(nested) ? [nested] : [];
    });
  expect(sqlFiles.length).toBeGreaterThan(0);

  for (const file of sqlFiles) {
    const sql = readFileSync(file, 'utf8');

    // CREATE TYPE "Name" AS ENUM ('A', 'B', ...)
    const createPattern = /CREATE\s+TYPE\s+"(\w+)"\s+AS\s+ENUM\s*\(([^)]*)\)/gi;
    for (const match of sql.matchAll(createPattern)) {
      const values = ensure(match[1]);
      for (const literal of match[2].matchAll(/'([A-Za-z0-9_]+)'/g)) {
        values.created.add(literal[1]);
      }
    }

    // ALTER TYPE "Name" ADD VALUE [IF NOT EXISTS] 'A';
    const addPattern = /ALTER\s+TYPE\s+"(\w+)"\s+ADD\s+VALUE\s+(?:IF\s+NOT\s+EXISTS\s+)?'([A-Za-z0-9_]+)'/gi;
    for (const match of sql.matchAll(addPattern)) {
      ensure(match[1]).added.add(match[2]);
    }
  }
  return byEnum;
}

describe('BugFix-24: Prisma-Schema und Migrationen sind enum-synchron', () => {
  const schema = readFileSync(SCHEMA_PATH, 'utf8');
  const schemaEnums = parseSchemaEnums(schema);
  const migrationValues = collectMigrationValues(MIGRATIONS_DIR);

  it('findet ueberhaupt Enum-Definitionen im Schema und Migrationen', () => {
    // Schutz gegen fehlschlagendes Parsen: waere die Menge leer, waeren
    // die folgenden Synchronitaets-Aussagen wertlos.
    expect(schemaEnums.size).toBeGreaterThan(0);
    expect(migrationValues.size).toBeGreaterThan(0);
  });

  it('enthält jede im Schema deklarierte Enum mindestens in einer Migration', () => {
    const missing: string[] = [];
    for (const [name] of schemaEnums) {
      if (!migrationValues.has(name)) missing.push(name);
    }
    expect(missing, `Enum ohne jegliche Migration: ${missing.join(', ')}`).toEqual([]);
  });

  it('enthält jeder Schema-Enumwert eine passende Migration (E824D00-Guard)', () => {
    const drift: string[] = [];
    for (const [name, values] of schemaEnums) {
      const known = migrationValues.get(name);
      if (!known) continue; // im vorherigen Test beanstandet
      const available = new Set([...known.created, ...known.added]);
      for (const value of values) {
        if (!available.has(value)) drift.push(`${name}.${value}`);
      }
    }
    expect(
      drift,
      `Enumwerte im Schema ohne Migration (E824D00-Klasse): ${drift.join(', ')}`,
    ).toEqual([]);
  });

  it('kennt die InsurancePolicyType-Werte aus dem Fehlerbericht E824D00', () => {
    const values = migrationValues.get('InsurancePolicyType');
    expect(values).toBeDefined();
    for (const value of ['RENTENVERSICHERUNG', 'KRANKENVERSICHERUNG', 'KRANKENVERSICHERUNG_AUSLAND']) {
      expect([...values!.created, ...values!.added]).toContain(value);
    }
  });
});
