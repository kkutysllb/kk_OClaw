import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const ipcSource = readFileSync(new URL("../src/ipc.ts", import.meta.url), "utf8");
const preloadSource = readFileSync(new URL("../src/preload.ts", import.meta.url), "utf8");

test("desktop bridge exposes embedded project terminal sessions without external terminal windows", () => {
  assert.doesNotMatch(ipcSource, /ipcMain\.handle\("shell:open-terminal"/);
  assert.doesNotMatch(ipcSource, /osascript/);
  assert.doesNotMatch(ipcSource, /do script "cd /);
  assert.match(ipcSource, /import pty from "node-pty"/);
  assert.match(ipcSource, /ipcMain\.handle\(\s*"terminal:start"/);
  assert.match(ipcSource, /ipcMain\.handle\(\s*"terminal:write"/);
  assert.match(ipcSource, /ipcMain\.handle\(\s*"terminal:resize"/);
  assert.match(ipcSource, /ipcMain\.handle\(\s*"terminal:stop"/);
  assert.match(ipcSource, /pty\.spawn/);
  assert.match(ipcSource, /terminal\.process\.write\(data\)/);
  assert.match(ipcSource, /terminal\.process\.resize\(cols,\s*rows\)/);
  assert.match(ipcSource, /function buildTerminalEnv/);
  assert.match(ipcSource, /function resolveEmbeddedShell/);
  assert.match(ipcSource, /accessSync\(candidate,\s*constants\.X_OK\)/);
  assert.match(ipcSource, /function resolveTerminalCwd/);
  assert.match(ipcSource, /statSync\(folderPath\)/);
  assert.match(ipcSource, /const cwd = resolveTerminalCwd\(folderPath\)/);
  assert.match(ipcSource, /cwd,\s*env: buildTerminalEnv\(\)/);
  assert.match(ipcSource, /function startEmbeddedTerminal/);

  assert.match(preloadSource, /startTerminal:\s*\(folderPath:\s*string\):\s*Promise<EmbeddedTerminalSession>/);
  assert.match(preloadSource, /writeTerminal:\s*\(sessionId:\s*string,\s*data:\s*string\):\s*Promise<void>/);
  assert.match(preloadSource, /resizeTerminal:\s*\(/);
  assert.match(preloadSource, /ipcRenderer\.invoke\("terminal:resize",\s*sessionId,\s*cols,\s*rows\)/);
  assert.match(preloadSource, /stopTerminal:\s*\(sessionId:\s*string\):\s*Promise<void>/);
  assert.match(preloadSource, /onTerminalData/);
});
