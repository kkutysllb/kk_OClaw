import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const ipcSource = readFileSync(new URL("../src/ipc.ts", import.meta.url), "utf8");
const preloadSource = readFileSync(new URL("../src/preload.ts", import.meta.url), "utf8");

test("desktop bridge exposes opening a real terminal at a project path", () => {
  assert.match(ipcSource, /ipcMain\.handle\("shell:open-terminal"/);
  assert.match(ipcSource, /function buildOpenTerminalCommand/);
  assert.match(ipcSource, /cwd:\s*folderPath/);
  assert.match(ipcSource, /darwin/);
  assert.match(ipcSource, /win32/);
  assert.match(ipcSource, /x-terminal-emulator/);
  assert.match(ipcSource, /gnome-terminal/);

  assert.match(preloadSource, /openTerminal:\s*\(folderPath:\s*string\):\s*Promise<void>/);
  assert.match(preloadSource, /ipcRenderer\.invoke\("shell:open-terminal",\s*folderPath\)/);
});
