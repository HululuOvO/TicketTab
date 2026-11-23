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
// On Windows, `type: 'toolbar'` + `thickFrame: false` completely eliminates the ghost white DWM titlebar bug!
const WINDOW_WIDTH = 446;
const WINDOW_HEIGHT = 650;
const SCREEN_MARGIN = 18;

const ALERT_WIDTH = 372;
const ALERT_HEIGHT = 258;

let mainWindow = null;
let reminderWindow = null;
let reminderQueue = [];
let reminderBusy = false;
let reminderPollTimer = null;

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

function computeReminderBounds() {
  const display = screen.getPrimaryDisplay();
  const wa = display.workArea;
  const isMac = process.platform === 'darwin';
  const x = wa.x + wa.width - ALERT_WIDTH - 16;
  // Flush right against the macOS top menu bar (y = wa.y) OR Windows bottom taskbar (y = wa.y + wa.height - ALERT_HEIGHT)!
  const y = isMac
    ? wa.y
    : wa.y + wa.height - ALERT_HEIGHT;
  return { x, y, width: ALERT_WIDTH, height: ALERT_HEIGHT, origin: isMac ? 'top' : 'bottom' };
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
    // Ignore restricted environments
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
    thickFrame: false,       // Prevents Windows DWM ghost titlebar flash
    type: process.platform === 'win32' ? 'toolbar' : 'panel', // Eliminates OS non-client white bar completely
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

  mainWindow.setMenu(null);
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

// ==================== THERMAL RECEIPT REMINDER POPUP WINDOW ====================

function ensureReminderWindow() {
  if (reminderWindow && !reminderWindow.isDestroyed()) return reminderWindow;

  const rb = computeReminderBounds();
  reminderWindow = new BrowserWindow({
    x: rb.x,
    y: rb.y,
    width: rb.width,
    height: rb.height,
    frame: false,
    thickFrame: false,
    type: process.platform === 'win32' ? 'toolbar' : 'panel',
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    focusable: false, // Never steals typing focus from user's current app!
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'reminder-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  reminderWindow.setMenu(null);
  reminderWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  reminderWindow.setAlwaysOnTop(true, 'screen-saver');
  reminderWindow.loadFile(path.join(__dirname, '..', 'renderer', 'reminder.html'));

  return reminderWindow;
}

function showNextReminder() {
  if (reminderBusy || reminderQueue.length === 0) return;
  reminderBusy = true;
  const item = reminderQueue.shift();

  const win = ensureReminderWindow();
  const rb = computeReminderBounds();
  win.setBounds({ x: rb.x, y: rb.y, width: rb.width, height: rb.height }, false);

  const dispatch = () => {
    if (!win || win.isDestroyed()) {
      reminderBusy = false;
      return;
    }
    win.showInactive();
    win.webContents.send('reminder:show', {
      ...item,
      origin: rb.origin,
      theme: store.state.settings.theme || 'ivory',
      sound: store.state.settings.sound !== false
    });
  };

  if (win.webContents.isLoading()) {
    win.webContents.once('did-finish-load', dispatch);
  } else {
    dispatch();
  }
}

function enqueueReminders(items = []) {
  if (!items || !items.length) return;
  reminderQueue.push(...items);
  showNextReminder();
}

function startReminderScheduler() {
  clearInterval(reminderPollTimer);
  const poll = () => {
    if (!store) return;
    const due = store.collectDueReminders(new Date());
    if (due.length > 0) {
      enqueueReminders(due);
      sendStateToRenderer();
    }
  };
  setTimeout(poll, 2500);
  reminderPollTimer = setInterval(poll, 15000);
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

  // Preview/test the thermal receipt alert popup immediately for any task!
  ipcMain.handle('ticket:test-reminder', (_event, taskId) => {
    const found = taskId ? store.findTask(taskId, activeDateKey) : null;
    const task = found ? found.task : null;
    const rem = (task && task.reminder) || {};
    const preCount = Math.max(1, rem.preAlerts || 1);
    const interval = rem.preIntervalMin || 15;
    enqueueReminders([{
      taskId: task ? task.id : null,
      dateKey: found ? found.dateKey : store.todayKey(),
      text: task ? task.text : '这是一条热敏吐票提醒演示',
      priority: task ? task.priority : 'urgent',
      time: rem.time || '15:00',
      repeat: rem.repeat || 'none',
      leadMin: rem.preAlerts > 0 ? interval : 0,
      stepIndex: 1,
      totalPre: preCount,
      isExactDue: !(rem.preAlerts > 0)
    }]);
    return { ok: true };
  });

  // Handle user actions on the thermal receipt alert popup
  ipcMain.on('reminder:action', (_event, payload) => {
    if (reminderWindow && !reminderWindow.isDestroyed()) {
      reminderWindow.hide();
    }
    if (payload && payload.taskId) {
      if (payload.action === 'done') {
        store.toggleTask(payload.taskId);
        sendStateToRenderer();
      } else if (payload.action === 'snooze') {
        store.snoozeTaskReminder(payload.taskId, payload.minutes || 10);
        sendStateToRenderer();
      } else if (payload.action === 'open') {
        applyExpanded(true);
      }
    } else if (payload && payload.action === 'open') {
      applyExpanded(true);
    }

    reminderBusy = false;
    if (reminderQueue.length > 0) {
      setTimeout(showNextReminder, 260);
    }
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
    startReminderScheduler();

    screen.on('display-metrics-changed', () => repositionWindow());
    screen.on('display-added', () => repositionWindow());
    screen.on('display-removed', () => repositionWindow());
  });

  app.on('will-quit', () => {
    clearInterval(reminderPollTimer);
    globalShortcut.unregisterAll();
    if (bridgeHandle && bridgeHandle.server) {
      try { bridgeHandle.server.close(); } catch { /* ignore */ }
    }
  });

  app.on('window-all-closed', (event) => {
    event.preventDefault();
  });
}
