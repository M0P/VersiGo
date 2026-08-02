#!/usr/bin/env node
/**
 * i18n-Guard: prueft, dass in der Web-App keine hartkodierten deutschen
 * UI-Texte mehr vorkommen. Alle sichtbaren Texte muessen ueber t() aus den
 * Katalogen in src/i18n/locales kommen.
 *
 * Ausgenommen: Kataloge selbst, Tests/Fixtures, Kommentare und
 * Nicht-String-Kontexte (Identifiers, URLs, Farbwerte).
 *
 * Abdeckung und bekannte Grenzen (bewusste Design-Entscheidungen):
 * - Nur apps/web/src wird geprueft. Die API (apps/api) liefert einzelne
 *   Fehlermeldungen weiterhin auf Deutsch; sofern solche Meldungen direkt
 *   in der UI erscheinen wuerden, sind sie NICHT Sache dieses Guards –
 *   stattdessen bildet die Web-App Fehler ueber den HTTP-Status auf
 *   lokalisierte Katalog-Schluessel ab (siehe src/i18n/auth-errors.ts).
 * - Englisch ist die Quell-Sprache der Kataloge; hartkodierte ENGLISCHE
 *   UI-Texte wuerde dieser Guard nicht erkennen. Fuer englische Strings
 *   ist das Typ-System der einzige Schutz (unbekannte t()-Schluessel sind
 *   Compile-Fehler); neue sichtbare Texte muessen immer ueber t() laufen.
 * - Einzelne deutsche Woerter in String-Literalen (z. B. 'Fehler') werden
 *   bewusst NICHT gemeldet, weil Identifier/Katalog-Schluessel ebenfalls
 *   einzelne Woerter sind (Falsch-Positiv-Vermeidung).
 *
 * Abbruch mit Exit-Code 1, wenn verdaechtige Strings gefunden werden.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = new URL('../src/', import.meta.url).pathname;

const EXCLUDE_DIRS = new Set(['__tests__']);
const EXCLUDE_SUFFIXES = ['.spec.ts', '.test.ts'];
const EXCLUDE_PATH_FRAGMENTS = [join('i18n', 'locales')];

const UMLAUT_RE = /[äöüßÄÖÜ]/;
const GERMAN_WORDS_RE =
  /\b(Benutzer|Einstellungen|Speichern|Anmeldung|Registrieren|Versicherung|Versicherungen|Kosten|Kostenübersicht|Zusammenfassung|Profil|Abbrechen|Löschen|Hinzufügen|Zeitzone|Haushalt|Berechtigung|Berechtigungen|Willkommen|Sprache|Ändern|Anzeige|Dunkel|Hell|Schlüssel|Fehler|Übersicht|wurde|gespeichert|ungültig|erforderlich|bitte|nicht|und|oder|mit|von|für|über|sind|wird)\b/u;

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (!EXCLUDE_DIRS.has(entry)) out.push(...walk(full));
    } else if (
      (entry.endsWith('.ts') || entry.endsWith('.tsx')) &&
      !EXCLUDE_SUFFIXES.some((s) => entry.endsWith(s)) &&
      !EXCLUDE_PATH_FRAGMENTS.some((f) => full.includes(f))
    ) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Entfernt Kommentare aus dem Quelltext, ohne die Zeilenstruktur zu
 * veraendern (Zeilenumbrueche bleiben erhalten), damit die Meldezeilen
 * mit der Originaldatei uebereinstimmen. Strings werden respektiert,
 * ein // in einer URL oder ein /* im String bleibt erhalten.
 */
function stripCommentsKeepLines(src) {
  const lines = src.split('\n');
  const out = [];
  let inBlock = false;
  for (const line of lines) {
    let res = '';
    let quote = null;
    let inLine = false;
    let i = 0;
    while (i < line.length) {
      const c = line[i];
      const next = line[i + 1];
      if (inLine) {
        res += ' ';
        i += 1;
        continue;
      }
      if (inBlock) {
        if (c === '*' && next === '/') {
          inBlock = false;
          res += '  ';
          i += 2;
        } else {
          res += ' ';
          i += 1;
        }
        continue;
      }
      if (quote) {
        res += c;
        if (c === '\\') {
          res += next ?? '';
          i += 2;
        } else {
          if (c === quote) quote = null;
          i += 1;
        }
        continue;
      }
      if (c === '/' && next === '/') {
        inLine = true;
        res += '  ';
        i += 2;
        continue;
      }
      if (c === '/' && next === '*') {
        inBlock = true;
        res += '  ';
        i += 2;
        continue;
      }
      if (c === "'" || c === '"' || c === '`') {
        quote = c;
        res += c;
        i += 1;
        continue;
      }
      res += c;
      i += 1;
    }
    out.push(res);
  }
  return out.join('\n');
}

function extractStrings(line) {
  const strings = [];
  const re = /(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;
  let m;
  while ((m = re.exec(line)) !== null) {
    const quote = m[1];
    const value = m[2];
    // Template-Literale mit Interpolation ausschliessen.
    if (quote === '`' && value.includes('${')) continue;
    strings.push(value);
  }
  return strings;
}

function isSuspicious(value) {
  if (!value || value.trim() === '') return false;
  const trimmed = value.trim();
  if (trimmed.startsWith('http') || trimmed.startsWith('/') || trimmed.startsWith('#')) return false;
  if (trimmed.includes('.') && !trimmed.includes(' ')) return false; // Dateien/Domains
  if (/^[\w:-]+$/.test(trimmed)) return false; // Identifier/Keys/CSS
  return UMLAUT_RE.test(value) || GERMAN_WORDS_RE.test(value);
}

/** JSX-Textknoten wie <p>Kosten</p> finden (unquotierte sichtbare Texte). */
function jsxTexts(line) {
  const texts = [];
  const re = />([^<>{}]*[A-ZÄÖÜa-zäöüß][^<>{}]*)</g;
  let m;
  while ((m = re.exec(line)) !== null) {
    const text = m[1].trim();
    if (text) texts.push(text);
  }
  return texts;
}

const files = walk(SRC);
const findings = [];

for (const file of files) {
  const cleaned = stripCommentsKeepLines(readFileSync(file, 'utf8'));
  const lines = cleaned.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const str of extractStrings(line)) {
      if (isSuspicious(str)) {
        findings.push(`${file.replace(SRC, 'src/')}:${i + 1}: ${JSON.stringify(str)}`);
      }
    }
    for (const text of jsxTexts(line)) {
      if (isSuspicious(text)) {
        findings.push(`${file.replace(SRC, 'src/')}:${i + 1}: JSX-Text ${JSON.stringify(text)}`);
      }
    }
  }
}

if (findings.length > 0) {
  console.error(`i18n-Guard: ${findings.length} moegliche hartkodierte deutsche UI-Texte gefunden:`);
  for (const f of findings) console.error(`  ${f}`);
  console.error('Bitte alle sichtbaren Texte in src/i18n/locales/*.ts uebersetzen und via t() nutzen.');
  process.exit(1);
}

console.log(`i18n-Guard: OK – keine hartkodierten deutschen UI-Texte in ${files.length} Dateien.`);
