import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const mainSource = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
const ipcSource = readFileSync(new URL("../src/ipc.ts", import.meta.url), "utf8");

test("desktop app supports multiple task windows inside one app instance", () => {
  assert.match(mainSource, /const appWindows = new Set<BrowserWindow>\(\)/);
  assert.match(mainSource, /function createAppWindow\(/);
  assert.match(mainSource, /function createNewTaskWindow\(/);
  assert.match(mainSource, /新建聊天窗口/);
  assert.match(mainSource, /新建 Coding 窗口/);
  assert.doesNotMatch(mainSource, /let mainWindow: BrowserWindow \| null = null/);
});

test("second app instance opens or focuses a task window without replacing window state", () => {
  assert.match(mainSource, /app\.on\("second-instance"/);
  assert.match(mainSource, /handleSecondInstance/);
  assert.match(mainSource, /showLastActiveWindow\(\)/);
});

test("native dialogs are attached to the renderer window that invoked IPC", () => {
  assert.match(ipcSource, /BrowserWindow\.fromWebContents\(_evt\.sender\)/);
  assert.doesNotMatch(ipcSource, /getMainWindow\(\)/);
});
