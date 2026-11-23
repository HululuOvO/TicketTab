'use strict';

const path = require('node:path');
const fs = require('node:fs');
const {
  app,
  BrowserWindow,
  ipcMain,
  screen,
  Tray,
  Menu,
  nativeImage,
  globalShortcut,
  clipboard
} = require('electron');

const { TicketStore } = require('../shared/store');
const { startAiBridge } = require('./ai-bridge');

// Fixed single transparent canvas — NEVER calls setBounds during expand/collapse!
// All expand/collapse motion runs purely on GPU compositor inside Chromium (60/120fps butter-smooth).
// Transparent unused region uses setIgnoreMouseEvents(true, { forward: true }) so desktop clicks pass right through.
const WINDOW_WIDTH = 446;
const WINDOW_HEIGHT = 650;
const SCREEN_MARGIN = 18;

let mainWindow = null;
let tray = null;
let store = null;
let bridgeHandle = null;
let activeDateKey = null;
let isExpanded = false;
let isQuitting = false;
let blurCollapseTimer = null;
let currentIgnoreMouse = false;

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

function getActiveDisplay() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    const bounds = mainWindow.getBounds();
    return screen.getDisplayMatching(bounds);
  }
  return screen.getPrimaryDisplay();
}

function computeWindowBounds(edgeOverride, yRatioOverride) {
  const settings = store.state.settings;
  const edge = edgeOverride || settings.edge || 'right';
  const yRatio = typeof yRatioOverride === 'number' ? yRatioOverride : (settings.dockYRatio ?? 0.44);

  const display = getActiveDisplay();
  const wa = display.workArea;

  const width = WINDOW_WIDTH;
  const height = Math.min(WINDOW_HEIGHT, wa.height - SCREEN_MARGIN * 2);
  const x = edge === 'left' ? wa.x : wa.x + wa.width - width;

  const anchorCenterY = wa.y + Math.round(wa.height * clamp(yRatio, 0.1, 0.9));
  const rawY = Math.round(anchorCenterY - height / 2);
  const y = clamp(rawY, wa.y + SCREEN_MARGIN, wa.y + wa.height - height - SCREEN_MARGIN);

  return { x, y, width, height, edge };
}

function setMousePassthrough(ignore) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const flag = Boolean(ignore);
  if (flag === currentIgnoreMouse) return;
  currentIgnoreMouse = flag;
  if (flag) {
    mainWindow.setIgnoreMouseEvents(true, { forward: true });
  } else {
    mainWindow.setIgnoreMouseEvents(false);
  }
}

function getMcpScriptPath() {
  const candidates = [
    path.join(process.resourcesPath || '', 'app.asar.unpacked', 'mcp', 'mcp-server.js'),
    path.join(__dirname, '..', '..', 'mcp', 'mcp-server.js')
  ];
  for (const p of candidates) {
    if (p && fs.existsSync(p)) return p;
  }
  return candidates[1];
}

function buildStatePayload(extra = {}) {
  return {
    snapshot: store.getSnapshot(activeDateKey),
    ui: {
      expanded: isExpanded,
      phase: isExpanded ? 'expanded' : 'collapsed',
      platform: process.platform,
      aiPort: bridgeHandle ? bridgeHandle.port : 27319,
      mcpPath: getMcpScriptPath(),
      ...extra
    }
  };
}

function sendStateToRenderer(extra = {}) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('ticket:state', buildStatePayload(extra));
}

function repositionWindow(edgeOverride, yRatioOverride) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const bounds = computeWindowBounds(edgeOverride, yRatioOverride);
  mainWindow.setBounds({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height
  }, false);
}

function applyExpanded(expanded) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  clearTimeout(blurCollapseTimer);
  isExpanded = Boolean(expanded);

  if (isExpanded) {
    setMousePassthrough(false);
    mainWindow.setAlwaysOnTop(true, 'floating');
    mainWindow.show();
    mainWindow.focus();
  } else {
    mainWindow.setAlwaysOnTop(true, 'floating');
    // Immediately allow clicking desktop areas outside the slim bookmark tab
    setMousePassthrough(true);
  }

  sendStateToRenderer();
}

function applyLaunchAtLogin(enabled) {
  try {
    if (process.platform === 'win32' || process.platform === 'darwin') {
      app.setLoginItemSettings({
        openAtLogin: Boolean(enabled),
        openAsHidden: true
      });
    }
  } catch {
    // Some dev environments restrict login item registration silently
  }
}

function resolveAppIcon() {
  const candidates = [
    path.join(__dirname, '..', '..', 'build', 'icon.png'),
    path.join(__dirname, '..', '..', 'assets', 'tray-icon.png')
  ];
  for (const file of candidates) {
    if (fs.existsSync(file)) {
      const img = nativeImage.createFromPath(file);
      if (!img.isEmpty()) return img;
    }
  }
  return nativeImage.createEmpty();
}

function createWindow() {
  const initialBounds = computeWindowBounds();

  mainWindow = new BrowserWindow({
    x: initialBounds.x,
    y: initialBounds.y,
    width: initialBounds.width,
    height: initialBounds.height,
    icon: resolveAppIcon(),
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  mainWindow.setAlwaysOnTop(true, 'floating');

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    applyExpanded(true);
  });

  mainWindow.on('blur', () => {
    if (!isExpanded) return;
    if (store.state.settings.pinned) return;
    clearTimeout(blurCollapseTimer);
    blurCollapseTimer = setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isFocused() && isExpanded && !store.state.settings.pinned) {
        applyExpanded(false);
      }
    }, 150);
  });

  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      applyExpanded(false);
    }
  });
}

function createTray() {
  const icon = resolveAppIcon();
  const trayImg = icon.isEmpty() ? icon : icon.resize({ width: 18, height: 18 });
  tray = new Tray(trayImg);
  tray.setToolTip('TicketTab');

  const rebuildMenu = () => {
    const snap = store.getSnapshot();
    const menu = Menu.buildFromTemplate([
      {
        label: isExpanded ? '收起到屏幕边缘' : '展开小票任务板',
        click: () => applyExpanded(!isExpanded)
      },
      {
        label: `今日进度 ${snap.stats.todayDone}/${snap.stats.todayTotal}`,
        enabled: false
      },
      { type: 'separator' },
      {
        label: '从剪贴板一键吸取 AI 任务',
        click: () => {
          const clipText = clipboard.readText();
          const created = store.importFromText(clipText, { defaultDateKey: activeDateKey || store.todayKey(), source: 'ai' });
          if (created.length > 0) {
            activeDateKey = created[0].dateKey;
            applyExpanded(true);
            sendStateToRenderer({ justImportedCount: created.length });
          }
        }
      },
      {
        label: snap.settings.edge === 'right' ? '吸附到屏幕左侧' : '吸附到屏幕右侧',
        click: () => {
          const nextEdge = snap.settings.edge === 'right' ? 'left' : 'right';
          store.updateSettings({ edge: nextEdge });
          repositionWindow();
          sendStateToRenderer();
        }
      },
      {
        label: '开机自动启动',
        type: 'checkbox',
        checked: Boolean(snap.settings.launchAtLogin),
        click: (item) => {
          store.updateSettings({ launchAtLogin: item.checked });
          applyLaunchAtLogin(item.checked);
          sendStateToRenderer();
        }
      },
      { type: 'separator' },
      {
        label: '退出 TicketTab',
        click: () => {
          isQuitting = true;
          app.quit();
        }
      }
    ]);
    tray.setContextMenu(menu);
  };

  tray.on('click', () => applyExpanded(!isExpanded));
  tray.on('right-click', () => {
    rebuildMenu();
    tray.popUpContextMenu();
  });

  rebuildMenu();
}

function registerIpc() {
  ipcMain.handle('ticket:get-state', () => buildStatePayload());

  ipcMain.on('ticket:set-ignore-mouse', (_event, ignore) => {
    if (isExpanded) {
      setMousePassthrough(false);
    } else {
      setMousePassthrough(Boolean(ignore));
    }
  });

  ipcMain.handle('ticket:set-active-date', (_event, dateKey) => {
    activeDateKey = dateKey || null;
    sendStateToRenderer();
    return buildStatePayload();
  });

  ipcMain.handle('ticket:add', (_event, payload) => {
    const text = payload && typeof payload.text === 'string' ? payload.text : '';
    const priority = payload && payload.priority === 'urgent' ? 'urgent' : 'normal';
    const explicitDate = payload && payload.dateKey ? payload.dateKey : null;
    const created = store.addTask(text, priority, {
      dateKey: explicitDate,
      parseDate: !explicitDate
    });
    if (created && !explicitDate && created.dateKey) {
      if (activeDateKey && activeDateKey !== store.todayKey() && created.dateKey === store.todayKey()) {
        store.updateTask(created.id, { dateKey: activeDateKey }, created.dateKey);
        created.dateKey = activeDateKey;
      } else if (created.dateKey !== (activeDateKey || store.todayKey())) {
        activeDateKey = created.dateKey;
      }
    }
    sendStateToRenderer();
    return { created, ...buildStatePayload() };
  });

  ipcMain.handle('ticket:import-clipboard', () => {
    const raw = clipboard.readText();
    const created = store.importFromText(raw, {
      defaultDateKey: activeDateKey || store.todayKey(),
      source: 'ai'
    });
    if (created.length > 0) {
      activeDateKey = created[0].dateKey;
      sendStateToRenderer({ justImportedCount: created.length });
    }
    return { count: created.length, created, ...buildStatePayload() };
  });

  ipcMain.handle('ticket:import-text', (_event, text) => {
    const created = store.importFromText(text, {
      defaultDateKey: activeDateKey || store.todayKey(),
      source: 'ai'
    });
    if (created.length > 0) {
      activeDateKey = created[0].dateKey;
      sendStateToRenderer({ justImportedCount: created.length });
    }
    return { count: created.length, created, ...buildStatePayload() };
  });

  ipcMain.handle('ticket:copy-text', (_event, text) => {
    clipboard.writeText(String(text || ''));
    return { ok: true };
  });

  ipcMain.handle('ticket:toggle', (_event, id) => {
    const toggled = store.toggleTask(id, activeDateKey);
    sendStateToRenderer();
    return { toggled, snapshot: store.getSnapshot(activeDateKey) };
  });

  ipcMain.handle('ticket:update', (_event, payload) => {
    if (!payload || !payload.id) return null;
    const updated = store.updateTask(payload.id, payload.patch || {}, activeDateKey);
    sendStateToRenderer();
    return { updated, snapshot: store.getSnapshot(activeDateKey) };
  });

  ipcMain.handle('ticket:delete', (_event, id) => {
    const ok = store.deleteTask(id, activeDateKey);
    sendStateToRenderer();
    return { ok, snapshot: store.getSnapshot(activeDateKey) };
  });

  ipcMain.handle('ticket:clear-done', () => {
    const count = store.clearDone(activeDateKey);
    sendStateToRenderer();
    return { count, snapshot: store.getSnapshot(activeDateKey) };
  });

  ipcMain.handle('ticket:set-expanded', (_event, expanded) => {
    applyExpanded(Boolean(expanded));
    return { expanded: isExpanded };
  });

  ipcMain.handle('ticket:update-settings', (_event, patch) => {
    const prevEdge = store.state.settings.edge;
    const next = store.updateSettings(patch || {});
    if (patch && typeof patch.launchAtLogin === 'boolean') {
      applyLaunchAtLogin(patch.launchAtLogin);
    }
    if (patch && patch.edge && patch.edge !== prevEdge) {
      repositionWindow();
    }
    sendStateToRenderer();
    return { settings: next, snapshot: store.getSnapshot(activeDateKey) };
  });

  ipcMain.on('ticket:drag-move', (_event, payload) => {
    if (!mainWindow || mainWindow.isDestroyed() || isExpanded) return;
    if (!payload || typeof payload.screenX !== 'number' || typeof payload.screenY !== 'number') return;

    const display = screen.getDisplayNearestPoint({ x: payload.screenX, y: payload.screenY });
    const wa = display.workArea;
    const midX = wa.x + wa.width / 2;
    const edge = payload.screenX < midX ? 'left' : 'right';

    const bounds = mainWindow.getBounds();
    const newY = clamp(
      Math.round(payload.screenY - bounds.height / 2),
      wa.y + SCREEN_MARGIN,
      wa.y + wa.height - bounds.height - SCREEN_MARGIN
    );
    const newX = edge === 'left' ? wa.x : wa.x + wa.width - bounds.width;

    mainWindow.setBounds({
      x: newX,
      y: newY,
      width: bounds.width,
      height: bounds.height
    }, false);

    if (store.state.settings.edge !== edge) {
      store.state.settings.edge = edge;
      sendStateToRenderer();
    }
  });

  ipcMain.handle('ticket:drag-end', (_event, payload) => {
    if (!mainWindow || mainWindow.isDestroyed()) return null;
    const bounds = mainWindow.getBounds();
    const display = screen.getDisplayMatching(bounds);
    const wa = display.workArea;
    const midX = wa.x + wa.width / 2;
    const edge = payload && typeof payload.screenX === 'number'
      ? (payload.screenX < midX ? 'left' : 'right')
      : (bounds.x + bounds.width / 2 < midX ? 'left' : 'right');

    const centerY = bounds.y + bounds.height / 2;
    const dockYRatio = clamp((centerY - wa.y) / wa.height, 0.1, 0.9);
    store.updateSettings({ edge, dockYRatio });
    repositionWindow(edge, dockYRatio);
    sendStateToRenderer();
    return { edge, dockYRatio };
  });
}

function registerShortcuts() {
  const candidates = ['Alt+Space', 'CommandOrControl+Shift+T'];
  for (const acc of candidates) {
    try {
      const ok = globalShortcut.register(acc, () => {
        applyExpanded(!isExpanded);
      });
      if (ok) break;
    } catch {
      // Try next shortcut
    }
  }
}

const singleLock = app.requestSingleInstanceLock();
if (!singleLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      applyExpanded(true);
    }
  });

  app.whenReady().then(async () => {
    if (process.platform === 'darwin' && app.dock) {
      app.dock.setIcon(resolveAppIcon());
      app.dock.hide();
    }

    const dataPath = path.join(app.getPath('userData'), 'tickets.json');
    store = new TicketStore(dataPath);

    bridgeHandle = await startAiBridge(store, (evt) => {
      if (evt && evt.firstDate) {
        activeDateKey = evt.firstDate;
      }
      sendStateToRenderer({ aiEvent: evt });
    }, store.state.settings.aiBridgePort || 27319);

    registerIpc();
    createWindow();
    createTray();
    registerShortcuts();

    screen.on('display-metrics-changed', () => repositionWindow());
    screen.on('display-added', () => repositionWindow());
    screen.on('display-removed', () => repositionWindow());
  });

  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    if (bridgeHandle && bridgeHandle.server) {
      try { bridgeHandle.server.close(); } catch { /* ignore */ }
    }
  });

  app.on('window-all-closed', (event) => {
    event.preventDefault();
  });
}
