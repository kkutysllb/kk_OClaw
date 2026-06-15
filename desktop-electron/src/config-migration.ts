const DESKTOP_SQLITE_DIR = "$KKOCLAW_DATA_DIR";

interface SectionRange {
  start: number;
  end: number;
  text: string;
}

function findTopLevelSections(source: string, sectionName: string): SectionRange[] {
  const sectionRe = new RegExp(`^${sectionName}:\\s*$`, "gm");
  const nextTopLevelRe = /^[A-Za-z0-9_-]+:\s*.*$/gm;
  const ranges: SectionRange[] = [];

  for (const match of source.matchAll(sectionRe)) {
    const start = match.index ?? 0;
    const headerEnd = source.indexOf("\n", start);
    const bodyStart = headerEnd === -1 ? source.length : headerEnd + 1;
    let end = source.length;

    nextTopLevelRe.lastIndex = bodyStart;
    const next = nextTopLevelRe.exec(source);
    if (next && (next.index ?? source.length) > start) {
      end = next.index ?? source.length;
    }

    ranges.push({ start, end, text: source.slice(start, end) });
  }

  return ranges;
}

function appendSection(source: string, section: string): string {
  const separator = source.endsWith("\n") ? "\n" : "\n\n";
  return `${source}${separator}${section}`;
}

function replaceOrAppendAgentsApi(source: string): string {
  const ranges = findTopLevelSections(source, "agents_api");
  const enabledSection = "agents_api:\n  enabled: true\n";

  if (ranges.length === 0) {
    return appendSection(source, enabledSection);
  }

  if (
    ranges.length === 1 &&
    /^[ \t]+enabled:\s*true\s*$/m.test(ranges[0]?.text ?? "")
  ) {
    return source;
  }

  let migrated = source;
  for (const range of [...ranges].reverse()) {
    migrated = `${migrated.slice(0, range.start)}${migrated.slice(range.end)}`;
  }
  return appendSection(migrated.trimEnd(), enabledSection);
}

function replaceOrAppendDesktopDatabase(source: string): string {
  const ranges = findTopLevelSections(source, "database");
  const desktopDatabaseSection = `database:\n  backend: sqlite\n  sqlite_dir: ${DESKTOP_SQLITE_DIR}\n`;

  if (ranges.length === 0) {
    return appendSection(source, desktopDatabaseSection);
  }

  const range = ranges[0];
  if (!range) return source;

  const backendMatch = range.text.match(/^[ \t]+backend:\s*([^\s#]+).*$/m);
  if (backendMatch && backendMatch[1] !== "sqlite") {
    return source;
  }

  const lines = range.text.split("\n");
  let hasBackend = false;
  let hasSqliteDir = false;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (/^[ \t]+backend:\s*/.test(line)) {
      lines[i] = "  backend: sqlite";
      hasBackend = true;
    }
    if (/^[ \t]+sqlite_dir:\s*/.test(line)) {
      lines[i] = `  sqlite_dir: ${DESKTOP_SQLITE_DIR}`;
      hasSqliteDir = true;
    }
  }

  let insertAt = lines.length;
  while (insertAt > 1 && (lines[insertAt - 1] ?? "").trim() === "") {
    insertAt -= 1;
  }
  if (!hasBackend) {
    lines.splice(1, 0, "  backend: sqlite");
    insertAt += 1;
  }
  if (!hasSqliteDir) {
    lines.splice(insertAt, 0, `  sqlite_dir: ${DESKTOP_SQLITE_DIR}`);
  }

  const migratedSection = lines.join("\n");
  if (migratedSection === range.text) {
    return source;
  }
  return `${source.slice(0, range.start)}${migratedSection}${source.slice(range.end)}`;
}

export function migrateDesktopConfigYaml(source: string): string {
  return replaceOrAppendAgentsApi(replaceOrAppendDesktopDatabase(source));
}
