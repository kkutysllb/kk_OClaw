/**
 * Electron main process entry point.
 *
 * Owns the application window, system tray, native menu, global shortcut,
 * and backend lifecycle. Mirrors the feature set of the previous Tauri
 * shell (tray + CmdOrCtrl+Shift+O + hide-to-tray + auto-update).
 */

import {
  app,
  BrowserWindow,
  powerSaveBlocker,
  protocol,
  globalShortcut,
  Menu,
  shell,
  Tray,
  nativeImage,
  type BrowserWindowConstructorOptions,
} from "electron";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ESM has no __dirname; derive it from this module's URL. Compiled output
// (main.js + preload.js) lives in the same dist/ directory.
const __dirname = dirname(fileURLToPath(import.meta.url));

import { BackendManager, type BackendStatus } from "./backend.js";
import { getFrontendURLPath } from "./frontend-protocol.js";
import { registerIpc } from "./ipc.js";
import { registerUpdater } from "./updater.js";
import { getFrontendDistDir, getLogsDir, REPO_ROOT } from "./paths.js";
import { stopBackendWithTimeout } from "./shutdown.js";
import { appendRendererLog, log } from "./logger.js";
import {
  APP_ORIGIN,
  DEV_SERVER_URL,
  isAllowedAppNavigationUrl,
  isAllowedExternalUrl,
} from "./url-policy.js";

// ── Constants ────────────────────────────────────────────────────────────

const APP_SCHEME = "app";

protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);

const appWindows = new Set<BrowserWindow>();
let lastActiveWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let backend: BackendManager | null = null;

/** True when the user explicitly requested quit (tray → Quit). */
let isQuitting = false;

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

function isBackendAutolaunchEnabled(): boolean {
  return process.env.OCLAW_SKIP_BACKEND_AUTOLAUNCH !== "1";
}

// ── Icon resolution ──────────────────────────────────────────────────────

function resolveIcon(): Electron.NativeImage | undefined {
  // __dirname (compiled main.js) lives in desktop-electron/dist/.
  // "../build/icon.png" resolves to desktop-electron/build/icon.png —
  // the most reliable path that doesn't depend on REPO_ROOT.
  const candidates = [
    join(__dirname, "..", "build", "icon.png"),
    // Packaged: icon bundled by electron-builder.
    join(process.resourcesPath, "icon.png"),
    // Dev fallbacks via REPO_ROOT (now correctly = repo root).
    join(REPO_ROOT, "desktop-electron", "build", "icon.png"),
    join(REPO_ROOT, "desktop-electron", "resources", "icon.png"),
  ];
  for (const path of candidates) {
    if (existsSync(path)) return nativeImage.createFromPath(path);
  }
  return undefined;
}

function resolveTrayIcon(): Electron.NativeImage | undefined {
  const candidates = [
    join(__dirname, "..", "build", "icons", "16x16.png"),
    join(__dirname, "..", "build", "icons", "32x32.png"),
    join(process.resourcesPath, "icons", "16x16.png"),
    join(process.resourcesPath, "icons", "32x32.png"),
    join(REPO_ROOT, "desktop-electron", "build", "icons", "16x16.png"),
    join(REPO_ROOT, "desktop-electron", "build", "icons", "32x32.png"),
  ];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    // NOTE: do NOT call setTemplateImage(true) here. The tray icon is a
    // full-colour brand logo (yellow→green gradient O-ring), not a monochrome
    // silhouette. Marking it as a template image makes macOS discard all
    // colour and render only the alpha mask as a solid white/grey blob.
    // Colour tray icons are fully supported on macOS without template mode.
    return nativeImage.createFromPath(path);
  }
  return undefined;
}

// ── Window ───────────────────────────────────────────────────────────────

interface AppWindowOptions {
  path?: string;
}

function createAppWindow(options: AppWindowOptions = {}): BrowserWindow {
  const windowOptions: BrowserWindowConstructorOptions = {
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    center: true,
    show: false,
    title: "OClaw",
    icon: resolveIcon(),
    webPreferences: {
      // Security: keep Node out of the renderer; expose only the typed bridge.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Prevent macOS App Nap / Chromium background throttling from killing
      // long-lived SSE streams (coding agent runs, chat replies). Without this,
      // switching windows or minimising the app can throttle network activity
      // enough to break fetch-based SSE connections.
      backgroundThrottling: false,
      // preload MUST be CommonJS (.cjs): Electron's sandbox loader does not
      // support ESM `import` statements. tsconfig.preload.json compiles
      // preload.ts to CommonJS, and the build script renames it to .cjs.
      preload: join(__dirname, "preload.cjs"),
    },
  };

  const win = new BrowserWindow(windowOptions);
  appWindows.add(win);
  lastActiveWindow = win;

  // Capture renderer console output into renderer.log for debugging.
  // This is critical for tracing the desktop auth/login flow which runs
  // entirely in the renderer process.
  win.webContents.on("console-message", (_e, level, message, line, sourceId) => {
    const levelStr = ["LOG", "WARN", "ERROR"][level] ?? "LOG";
    const shortSrc = sourceId ? sourceId.split("/").pop() ?? sourceId : "";
    appendRendererLog(levelStr, message, `${shortSrc}:${line}`);
  });

  // Hide to tray instead of closing (mirrors old Tauri behaviour).
  win.on("close", (e) => {
    if (!isQuitting) {
      e.preventDefault();
      win.hide();
    }
  });

  win.on("focus", () => {
    lastActiveWindow = win;
  });

  win.on("closed", () => {
    appWindows.delete(win);
    if (lastActiveWindow === win) {
      lastActiveWindow = getMostRecentWindow();
    }
  });

  win.once("ready-to-show", () => win.show());

  // Open external links in the system browser, not a new Electron window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });

  // Prevent the window from navigating when files are OS-dropped onto it.
  // The renderer handles drag/drop via the standard HTML5 DnD API instead.
  win.webContents.on("will-navigate", (e, url) => {
    // Block in-window navigation to external origins or file:// drops.
    if (!isAllowedAppNavigationUrl(url)) {
      e.preventDefault();
      if (isAllowedExternalUrl(url)) void shell.openExternal(url);
    }
  });

  void loadContent(win, options.path).catch((error: unknown) => {
    log.error(`failed to load desktop window content: ${String(error)}`);
  });

  return win;
}

async function loadContent(win: BrowserWindow, path = "/"): Promise<void> {
  const isDev = !app.isPackaged && process.env.OCLAW_DEV_SERVER === "1";
  if (isDev) {
    const base = DEV_SERVER_URL.endsWith("/") ? DEV_SERVER_URL.slice(0, -1) : DEV_SERVER_URL;
    await win.loadURL(`${base}${path}`);
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    await win.loadURL(`${APP_ORIGIN}${path}`);
  }
}

function getMostRecentWindow(): BrowserWindow | null {
  const focused = BrowserWindow.getFocusedWindow();
  if (focused && !focused.isDestroyed()) return focused;
  if (lastActiveWindow && !lastActiveWindow.isDestroyed()) return lastActiveWindow;
  const windows = BrowserWindow.getAllWindows().filter((win) => !win.isDestroyed());
  return windows.at(-1) ?? null;
}

function showWindow(win: BrowserWindow): void {
  if (win.isMinimized()) {
    win.restore();
  }
  win.show();
  win.focus();
  lastActiveWindow = win;
}

function showLastActiveWindow(): void {
  const win = getMostRecentWindow();
  if (win) {
    showWindow(win);
    return;
  }
  createAppWindow();
}

function createNewTaskWindow(path = "/workspace/chats/new"): BrowserWindow {
  return createAppWindow({ path });
}

/**
 * MIME type mapping for the most common static-export assets.
 *
 * The desktop shell serves the entire Next.js static export through a single
 * `app://` custom-protocol handler.  Unlike the deprecated
 * `registerFileProtocol` (which inferred Content-Type from the file
 * extension), `protocol.handle` returns a raw `Response` whose
 * Content-Type must be set explicitly — otherwise the browser treats `.txt`
 * RSC payloads as `text/plain` and `.js` chunks as opaque binaries, breaking
 * both client-side navigation and script loading.
 */
const MIME_BY_EXTENSION: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".txt": "text/x-component; charset=utf-8", // Next.js RSC Flight payload
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".eot": "application/vnd.ms-fontobject",
};

function contentTypeForPath(relativePath: string): string {
  return (
    MIME_BY_EXTENSION[extname(relativePath).toLowerCase()] ??
    "application/octet-stream"
  );
}

function registerFrontendProtocol(): void {
  protocol.handle(APP_SCHEME, async (request) => {
    // Next.js App Router client-side navigation sends `RSC: 1` to request
    // the Flight payload instead of the rendered HTML. Detecting this is
    // critical: without it, dynamic-route navigations (e.g.
    // /workspace/chats/<id>) receive the HTML fallback and Next.js logs
    // "Failed to fetch RSC payload ... Falling back to browser navigation",
    // which forces a full page reload and kills every active SSE stream
    // (chat replies, coding-agent runs).
    const isRsc = request.headers.get("rsc") === "1";
    const relativePath = getFrontendURLPath(request.url, isRsc);
    const filePath = join(getFrontendDistDir(), relativePath);

    try {
      const body = await readFile(filePath);
      return new Response(body, {
        status: 200,
        headers: { "Content-Type": contentTypeForPath(relativePath) },
      });
    } catch {
      // File missing (e.g. an unknown dynamic route or a stale chunk URL).
      // Fall back to the SPA shell so the renderer can recover client-side
      // — mirroring the behaviour of the old registerFileProtocol path,
      // which also served index.html for unknown routes.
      try {
        const indexBody = await readFile(join(getFrontendDistDir(), "index.html"));
        return new Response(indexBody, {
          status: 200,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      } catch {
        return new Response("Not Found", { status: 404 });
      }
    }
  });
}

// ── Native menu ─────────────────────────────────────────────────────────

/**
 * Helper to construct a typed menu item. Without this, object-literal arrays
 * widen the `role` field to `string`, which `MenuItemConstructorOptions`
 * rejects (it expects a union of known roles).
 */
function item(opts: Electron.MenuItemConstructorOptions): Electron.MenuItemConstructorOptions {
  return opts;
}

function buildAppMenu(): Menu {
  const isMac = process.platform === "darwin";

  const macAppMenu: Electron.MenuItemConstructorOptions = {
    label: app.name,
    submenu: [
      item({ role: "about", label: "关于 OClaw" }),
      item({ type: "separator" }),
      item({ role: "services" }),
      item({ type: "separator" }),
      item({ role: "hide", label: "隐藏 OClaw" }),
      item({ role: "hideOthers" }),
      item({ role: "unhide" }),
      item({ type: "separator" }),
      item({ role: "quit", label: "退出 OClaw" }),
    ],
  };

  const fileMenu: Electron.MenuItemConstructorOptions = isMac
    ? macAppMenu
    : {
        label: "文件",
        submenu: [item({ role: "quit", label: "退出" })],
      };

  const template: Electron.MenuItemConstructorOptions[] = [
    fileMenu,
    {
      label: "模式",
      submenu: [
        item({
          label: "Code 模式",
          accelerator: "CommandOrControl+Shift+C",
          click: () => navigateTo("/workspace/coding"),
        }),
        item({ type: "separator" }),
        item({
          label: "聊天模式",
          accelerator: "CommandOrControl+Shift+H",
          click: () => navigateTo("/workspace/chats/new"),
        }),
        item({
          label: "Agent 模式",
          accelerator: "CommandOrControl+Shift+A",
          click: () => navigateTo("/workspace/agents"),
        }),
      ],
    },
    {
      label: "编辑",
      submenu: [
        item({ role: "undo", label: "撤销" }),
        item({ role: "redo", label: "重做" }),
        item({ type: "separator" }),
        item({ role: "cut", label: "剪切" }),
        item({ role: "copy", label: "复制" }),
        item({ role: "paste", label: "粘贴" }),
        item({ role: "selectAll", label: "全选" }),
      ],
    },
    {
      label: "视图",
      submenu: [
        item({ role: "reload", label: "重新加载" }),
        item({ role: "forceReload" }),
        item({ role: "toggleDevTools", label: "开发者工具" }),
        item({ type: "separator" }),
        item({ role: "resetZoom", label: "实际大小" }),
        item({ role: "zoomIn", label: "放大" }),
        item({ role: "zoomOut", label: "缩小" }),
        item({ type: "separator" }),
        item({ role: "togglefullscreen", label: "全屏" }),
      ],
    },
    {
      label: "窗口",
      submenu: [
        item({
          label: "新建聊天窗口",
          accelerator: "CommandOrControl+Shift+N",
          click: () => {
            createNewTaskWindow("/workspace/chats/new");
          },
        }),
        item({
          label: "新建 Coding 窗口",
          accelerator: "CommandOrControl+Shift+K",
          click: () => {
            createNewTaskWindow("/workspace/coding");
          },
        }),
        item({ type: "separator" }),
        item({
          label: "显示最近窗口",
          click: () => showLastActiveWindow(),
        }),
        item({ type: "separator" }),
        item({ role: "minimize", label: "最小化" }),
        item({ role: "close", label: "关闭" }),
      ],
    },
    {
      label: "帮助",
      submenu: [
        item({
          label: "检查更新…",
          click: () => {
            const win = BrowserWindow.getFocusedWindow() ?? lastActiveWindow;
            if (win && !win.isDestroyed()) {
              win.webContents.send("menu:check-update");
            }
          },
        }),
        item({ type: "separator" }),
        item({
          label: "OClaw 文档",
          click: () => void shell.openExternal("https://github.com/kkutysllb/kk_OClaw"),
        }),
        item({ type: "separator" }),
        item({
          label: "打开日志文件夹",
          click: () => {
            void shell.openPath(getLogsDir());
          },
        }),
      ],
    },
  ];

  return Menu.buildFromTemplate(template);
}

// ── System tray ──────────────────────────────────────────────────────────

function buildTrayMenu(status: BackendStatus): Menu {
  const backendManaged = isBackendAutolaunchEnabled();
  const statusLabel =
    !backendManaged
      ? "后端状态：开发脚本管理"
      : status.status === "running"
      ? "后端状态：运行中"
      : status.status === "starting"
        ? "后端状态：启动中…"
        : status.status === "error"
          ? "后端状态：错误"
          : "后端状态：已停止";

  return Menu.buildFromTemplate([
    { label: "显示 OClaw", click: () => showLastActiveWindow() },
    { label: "新建聊天窗口", click: () => createNewTaskWindow("/workspace/chats/new") },
    { label: "新建 Coding 窗口", click: () => createNewTaskWindow("/workspace/coding") },
    { type: "separator" },
    { label: statusLabel, enabled: false },
    {
      label: "重启后端",
      enabled: backendManaged,
      click: () => {
        if (backendManaged) void backend?.restart();
      },
    },
    { type: "separator" },
    {
      label: "退出 OClaw",
      click: () => quitApp(),
    },
  ]);
}

function createTray(): Tray {
  const icon = resolveTrayIcon() ?? nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setToolTip("OClaw");

  // Initialize with a placeholder status, refresh on next tick.
  tray.setContextMenu(buildTrayMenu({ status: "starting", port: 0 }));
  tray.on("click", () => showLastActiveWindow());

  return tray;
}

/** Navigate the active window to an in-app path (e.g. /workspace/coding). */
function navigateTo(path: string): void {
  const win = getMostRecentWindow() ?? createAppWindow();
  const isDev = !app.isPackaged && process.env.OCLAW_DEV_SERVER === "1";
  if (isDev) {
    const base = DEV_SERVER_URL.endsWith("/") ? DEV_SERVER_URL.slice(0, -1) : DEV_SERVER_URL;
    void win.loadURL(`${base}${path}`);
  } else {
    void win.loadURL(`${APP_ORIGIN}${path}`);
  }
}

// ── Global shortcut ─────────────────────────────────────────────────────

function registerShortcuts(): void {
  // Cmd/Ctrl+Shift+O toggles window visibility (mirrors old Tauri shortcut).
  const acc = "CommandOrControl+Shift+O";
  globalShortcut.register(acc, () => {
    const win = BrowserWindow.getFocusedWindow();
    if (win && win.isVisible()) {
      win.hide();
    } else {
      showLastActiveWindow();
    }
  });
}

// ── App lifecycle ────────────────────────────────────────────────────────

function destroyTray(): void {
  tray?.destroy();
  tray = null;
}

function closeWindowsForQuit(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.removeAllListeners("close");
    win.destroy();
  }
  appWindows.clear();
  lastActiveWindow = null;
}

function quitApp(): void {
  void forceQuitApp();
}

async function forceQuitApp(): Promise<void> {
  if (isShuttingDown) return;
  isQuitting = true;
  isShuttingDown = true;
  destroyTray();
  closeWindowsForQuit();
  await stopBackendWithTimeout(backend, 2000);
  app.exit(0);
}

// ── Bootstrap ────────────────────────────────────────────────────────────

void app.whenReady().then(async () => {
  if (!gotSingleInstanceLock) {
    return;
  }

  log.info(`OClaw desktop starting (isPackaged=${app.isPackaged}, version=${app.getVersion()})`);
  log.info(`userData dir: ${app.getPath("userData")}`);
  log.info(`logs dir: ${getLogsDir()}`);

  // Prevent macOS from suspending the app during background activity.
  // Long-running coding-agent tasks and active SSE streams must not be
  // throttled when the user switches to another workspace or minimises
  // the window (macOS App Nap can throttle network enough to kill SSE).
  if (process.platform === "darwin") {
    powerSaveBlocker.start("prevent-app-suspension");
    log.info("powerSaveBlocker started (prevent-app-suspension)");
  }

  registerFrontendProtocol();
  Menu.setApplicationMenu(buildAppMenu());

  createAppWindow();
  createTray();

  // Register IPC handlers (returns the shared BackendManager).
  backend = registerIpc();
  backend.onStatusChange((status) => {
    log.info(`backend status: ${status.status} (port=${status.port}${status.error ? `, error=${status.error}` : ""})`);
    tray?.setContextMenu(buildTrayMenu(status));
    tray?.setToolTip(`OClaw — ${status.status}`);
  });

  // Auto-update channels (no-op in development).
  await registerUpdater();

  // Launch the embedded gateway unless the desktop dev launcher owns it.
  if (isBackendAutolaunchEnabled()) {
    log.info("launching embedded gateway...");
    void backend.launch();
  } else {
    log.info("backend auto-launch disabled (OCLAW_SKIP_BACKEND_AUTOLAUNCH=1)");
  }

  registerShortcuts();
  log.info("OClaw desktop ready");
});

function handleSecondInstance(): void {
  showLastActiveWindow();
}

app.on("second-instance", () => handleSecondInstance());

// Keep the app running in the tray when all windows close. The user quits
// explicitly via the tray menu (which sets isQuitting before app.quit()).
app.on("window-all-closed", () => {
  /* no-op: stay alive in the tray */
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createAppWindow();
  } else {
    showLastActiveWindow();
  }
});

let isShuttingDown = false;
app.on("before-quit", async (e) => {
  if (isShuttingDown) return;
  if (backend?.getStatus().status === "stopped") return;
  e.preventDefault();
  await forceQuitApp();
});

// Unregister shortcuts on quit.
app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  destroyTray();
});
