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
  protocol,
  globalShortcut,
  Menu,
  shell,
  Tray,
  nativeImage,
  type BrowserWindowConstructorOptions,
} from "electron";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
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

let mainWindow: BrowserWindow | null = null;
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
  const candidates = [
    // Packaged: icon bundled by electron-builder.
    join(process.resourcesPath, "icon.png"),
    // Dev: project icon assets.
    join(REPO_ROOT, "desktop-electron", "build", "icon.png"),
    join(REPO_ROOT, "desktop-electron", "resources", "icon.png"),
  ];
  for (const path of candidates) {
    if (existsSync(path)) return nativeImage.createFromPath(path);
  }
  return undefined;
}

// ── Window ───────────────────────────────────────────────────────────────

function createWindow(): BrowserWindow {
  const options: BrowserWindowConstructorOptions = {
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
      // preload MUST be CommonJS (.cjs): Electron's sandbox loader does not
      // support ESM `import` statements. tsconfig.preload.json compiles
      // preload.ts to CommonJS, and the build script renames it to .cjs.
      preload: join(__dirname, "preload.cjs"),
    },
  };

  const win = new BrowserWindow(options);

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

  void loadContent(win);

  return win;
}

async function loadContent(win: BrowserWindow): Promise<void> {
  const isDev = !app.isPackaged && process.env.OCLAW_DEV_SERVER === "1";
  if (isDev) {
    await win.loadURL(DEV_SERVER_URL);
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    await win.loadURL(`${APP_ORIGIN}/`);
  }
}

function registerFrontendProtocol(): void {
  protocol.registerFileProtocol(APP_SCHEME, (request, callback) => {
    const relativePath = getFrontendURLPath(request.url);
    callback({
      path: join(getFrontendDistDir(), relativePath),
    });
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
        item({ role: "minimize", label: "最小化" }),
        item({ role: "close", label: "关闭" }),
      ],
    },
    {
      label: "帮助",
      submenu: [
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
    { label: "显示 OClaw", click: () => showMainWindow() },
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
  const icon = resolveIcon() ?? nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setToolTip("OClaw");

  // Initialize with a placeholder status, refresh on next tick.
  tray.setContextMenu(buildTrayMenu({ status: "starting", port: 0 }));
  tray.on("click", () => showMainWindow());

  return tray;
}

function showMainWindow(): void {
  if (!mainWindow) {
    mainWindow = createWindow();
  } else {
    mainWindow.show();
    mainWindow.focus();
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
      showMainWindow();
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
  mainWindow = null;
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

  registerFrontendProtocol();
  Menu.setApplicationMenu(buildAppMenu());

  mainWindow = createWindow();
  createTray();

  // Register IPC handlers (returns the shared BackendManager).
  backend = registerIpc(() => mainWindow);
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

app.on("second-instance", () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.show();
    mainWindow.focus();
  } else {
    mainWindow = createWindow();
  }
});

// Keep the app running in the tray when all windows close. The user quits
// explicitly via the tray menu (which sets isQuitting before app.quit()).
app.on("window-all-closed", () => {
  /* no-op: stay alive in the tray */
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    mainWindow = createWindow();
  } else {
    mainWindow?.show();
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
