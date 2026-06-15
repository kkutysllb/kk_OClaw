/**
 * Main-process file logger.
 *
 * Writes timestamped entries to ``main.log`` under the userData logs dir.
 * Also mirrors to ``console`` so dev tooling still sees the output.
 *
 * The renderer-process console is captured separately via
 * ``webContents.on('console-message')`` in ``main.ts`` and written to
 * ``renderer.log`` by ``appendRendererLog``.
 */

import { createWriteStream, mkdirSync, type WriteStream } from "node:fs";
import { getMainLogPath, getRendererLogPath, getLogsDir } from "./paths.js";

let mainStream: WriteStream | null = null;
let rendererStream: WriteStream | null = null;

function ensureMainStream(): WriteStream {
  if (mainStream) return mainStream;
  try {
    mkdirSync(getLogsDir(), { recursive: true });
    mainStream = createWriteStream(getMainLogPath(), { flags: "a" });
  } catch {
    // Fall back to console-only if the file cannot be opened.
  }
  return mainStream!;
}

function ensureRendererStream(): WriteStream {
  if (rendererStream) return rendererStream;
  try {
    mkdirSync(getLogsDir(), { recursive: true });
    rendererStream = createWriteStream(getRendererLogPath(), { flags: "a" });
  } catch {
    /* ignore */
  }
  return rendererStream!;
}

function stamp(): string {
  return new Date().toISOString();
}

function writeMain(level: string, msg: string): void {
  const line = `[${stamp()}] [${level}] ${msg}`;
  ensureMainStream()?.write(line + "\n");
  // eslint-disable-next-line no-console
  console.log(line);
}

/** Append a renderer (webContents) console message to renderer.log. */
export function appendRendererLog(
  level: string,
  message: string,
  source?: string,
): void {
  const src = source ? ` ${source}` : "";
  const line = `[${stamp()}] [${level}]${src} ${message}`;
  ensureRendererStream()?.write(line + "\n");
}

export const log = {
  info(msg: string): void {
    writeMain("INFO", msg);
  },
  warn(msg: string): void {
    writeMain("WARN", msg);
  },
  error(msg: string): void {
    writeMain("ERROR", msg);
  },
  debug(msg: string): void {
    writeMain("DEBUG", msg);
  },
};
