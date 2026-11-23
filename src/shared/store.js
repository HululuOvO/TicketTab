'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { extractDateFromText, parseSmartInput } = require('./date-parser');

const SCHEMA_VERSION = 2;

function pad2(n) {
  return String(n).padStart(2, '0');
}

function formatDateKey(date = new Date()) {
  const y = date.getFullYear();
  const m = pad2(date.getMonth() + 1);
  const d = pad2(date.getDate());
  return `${y}-${m}-${d}`;
}

function shiftDateKey(dateKey, deltaDays) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dt = new Date(y, m - 1, d + deltaDays);
  return formatDateKey(dt);
}

function isValidDateKey(key) {
  return typeof key === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(key);
}

function createId() {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function defaultSettings() {
  return {
    edge: 'right',
    dockYRatio: 0.44,
    pinned: false,
    sound: true,
    carryOver: true,
    autoFadeDone: true,   // auto heat-fade completed tasks when ALL DONE
    hoverOpen: false,     // optional: expand automatically on mouse hover
    theme: 'ivory',       // 'ivory' | 'matcha' | 'sky' | 'peach'
    tabStyle: 'slot',     // 'slot' | 'mascot' | 'island' | 'retro'
    launchAtLogin: false, // auto start on boot (Windows & macOS)
    aiBridgePort: 27319
  };
}

function defaultState() {
  return {
    version: SCHEMA_VERSION,
    settings: defaultSettings(),
    days: {},
    lastActiveDate: null
  };
}

function sanitizeTask(raw, fallbackSeq = 1, fallbackDate = null) {
  if (!raw || typeof raw !== 'object') return null;
  const text = typeof raw.text === 'string' ? raw.text.trim() : '';
  if (!text) return null;
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : createId(),
    seq: Number.isInteger(raw.seq) && raw.seq > 0 ? raw.seq : fallbackSeq,
    text: text.slice(0, 140),
    done: Boolean(raw.done),
    priority: raw.priority === 'urgent' ? 'urgent' : 'normal',
    originDate: isValidDateKey(raw.originDate) ? raw.originDate : fallbackDate,
    source: raw.source === 'ai' ? 'ai' : 'manual',
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now(),
    doneAt: raw.done && typeof raw.doneAt === 'number' ? raw.doneAt : null
  };
}

function sanitizeState(raw) {
  const base = defaultState();
  if (!raw || typeof raw !== 'object') return base;

  const VALID_THEMES = new Set(['ivory', 'matcha', 'sky', 'peach']);
  const VALID_TAB_STYLES = new Set(['slot', 'mascot', 'island', 'retro']);
  const s = raw.settings && typeof raw.settings === 'object' ? raw.settings : {};
  base.settings = {
    edge: s.edge === 'left' ? 'left' : 'right',
    dockYRatio: typeof s.dockYRatio === 'number' && Number.isFinite(s.dockYRatio)
      ? Math.min(0.92, Math.max(0.08, s.dockYRatio))
      : 0.44,
    pinned: Boolean(s.pinned),
    sound: s.sound !== false,
    carryOver: s.carryOver !== false,
    autoFadeDone: s.autoFadeDone !== false,
    hoverOpen: Boolean(s.hoverOpen),
    theme: VALID_THEMES.has(s.theme) ? s.theme : 'ivory',
    tabStyle: VALID_TAB_STYLES.has(s.tabStyle) ? s.tabStyle : 'slot',
    launchAtLogin: Boolean(s.launchAtLogin),
    aiBridgePort: Number.isInteger(s.aiBridgePort) && s.aiBridgePort >= 1024 && s.aiBridgePort <= 65535
      ? s.aiBridgePort
      : 27319
  };

  if (raw.days && typeof raw.days === 'object') {
    for (const [key, dayVal] of Object.entries(raw.days)) {
      if (!isValidDateKey(key)) continue;
      if (!dayVal || typeof dayVal !== 'object') continue;
      const list = Array.isArray(dayVal.tasks) ? dayVal.tasks : [];
      const clean = [];
      let seq = 1;
      for (const item of list) {
        const sanitized = sanitizeTask(item, seq, key);
        if (sanitized) {
          clean.push(sanitized);
          seq = Math.max(seq + 1, sanitized.seq + 1);
        }
      }
      base.days[key] = {
        tasks: clean,
        tornCount: Number.isInteger(dayVal.tornCount) && dayVal.tornCount >= 0 ? dayVal.tornCount : 0
      };
    }
  }

  base.lastActiveDate = isValidDateKey(raw.lastActiveDate) ? raw.lastActiveDate : null;
  return base;
}

class TicketStore {
  constructor(filePath, nowProvider = () => new Date()) {
    this.filePath = filePath;
    this.nowProvider = nowProvider;
    this.state = defaultState();
    this.load();
  }

  todayKey() {
    return formatDateKey(this.nowProvider());
  }

  load() {
    try {
      if (this.filePath && fs.existsSync(this.filePath)) {
        const text = fs.readFileSync(this.filePath, 'utf8');
        this.state = sanitizeState(JSON.parse(text));
      } else {
        this.state = defaultState();
      }
    } catch {
      this.state = defaultState();
    }
    this.ensureToday();
    return this.state;
  }

  save() {
    if (!this.filePath) return;
    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2), 'utf8');
    fs.renameSync(tmp, this.filePath);
  }

  ensureDay(dateKey) {
    const key = isValidDateKey(dateKey) ? dateKey : this.todayKey();
    if (!this.state.days[key]) {
      this.state.days[key] = { tasks: [], tornCount: 0 };
    }
    return this.state.days[key];
  }

  ensureToday() {
    const today = this.todayKey();
    const isNewDay = !this.state.lastActiveDate || this.state.lastActiveDate < today;
    const todayRecord = this.ensureDay(today);

    // Carry over unfinished tasks from previous active days (not future scheduled days)
    if (isNewDay && this.state.settings.carryOver && this.state.lastActiveDate && this.state.lastActiveDate < today) {
      const priorKeys = Object.keys(this.state.days)
        .filter((k) => k >= this.state.lastActiveDate && k < today)
        .sort();

      const existingKeys = new Set(todayRecord.tasks.map((t) => `${t.originDate || ''}::${t.text}`));
      let seq = this.nextSeq(todayRecord);

      for (const prevKey of priorKeys) {
        const prev = this.state.days[prevKey];
        if (!prev || !Array.isArray(prev.tasks)) continue;
        const pending = prev.tasks.filter((t) => !t.done);
        for (const item of pending) {
          const origin = item.originDate || prevKey;
          const dedupeKey = `${origin}::${item.text}`;
          if (existingKeys.has(dedupeKey)) continue;
          existingKeys.add(dedupeKey);
          todayRecord.tasks.push({
            id: createId(),
            seq: seq++,
            text: item.text,
            done: false,
            priority: item.priority,
            originDate: origin,
            source: item.source || 'manual',
            createdAt: Date.now(),
            doneAt: null
          });
        }
      }
    }

    this.state.lastActiveDate = today;
    return todayRecord;
  }

  nextSeq(dayRecord) {
    const maxSeq = dayRecord.tasks.reduce((max, t) => Math.max(max, t.seq || 0), 0);
    return maxSeq + 1;
  }

  /**
   * Add a task to a specific date (or auto-detect natural language date like "明天 提交方案").
   */
  addTask(text, priority = 'normal', options = {}) {
    const raw = typeof text === 'string' ? text.trim() : '';
    if (!raw) return null;

    this.ensureToday();
    const now = this.nowProvider();
    let targetDate = isValidDateKey(options.dateKey) ? options.dateKey : null;
    let finalText = raw;

    if (!targetDate && options.parseDate !== false) {
      const parsed = extractDateFromText(raw, now);
      if (parsed.explicit) {
        targetDate = parsed.dateKey;
        finalText = parsed.cleanedText || raw;
      }
    }

    targetDate = targetDate || this.todayKey();
    const day = this.ensureDay(targetDate);

    const task = {
      id: createId(),
      seq: this.nextSeq(day),
      text: finalText.slice(0, 140),
      done: false,
      priority: priority === 'urgent' ? 'urgent' : 'normal',
      originDate: targetDate,
      source: options.source === 'ai' ? 'ai' : 'manual',
      createdAt: Date.now(),
      doneAt: null
    };

    day.tasks.unshift(task);
    this.save();
    return { ...task, dateKey: targetDate };
  }

  /**
   * Batch-import tasks from ANY AI response (plain meeting notes, markdown list, or JSON).
   */
  importFromText(rawInput, options = {}) {
    this.ensureToday();
    const now = this.nowProvider();
    const defaultDate = isValidDateKey(options.defaultDateKey) ? options.defaultDateKey : this.todayKey();
    const parsedItems = parseSmartInput(rawInput, now, defaultDate);
    if (!parsedItems.length) return [];

    const created = [];
    for (const item of parsedItems) {
      const targetDate = isValidDateKey(item.dateKey) ? item.dateKey : defaultDate;
      const day = this.ensureDay(targetDate);
      const task = {
        id: createId(),
        seq: this.nextSeq(day),
        text: item.text.slice(0, 140),
        done: false,
        priority: item.priority === 'urgent' ? 'urgent' : 'normal',
        originDate: targetDate,
        source: options.source === 'manual' ? 'manual' : 'ai',
        createdAt: Date.now(),
        doneAt: null
      };
      day.tasks.unshift(task);
      created.push({ ...task, dateKey: targetDate });
    }

    this.save();
    return created;
  }

  findTask(id, dateKeyHint = null) {
    if (dateKeyHint && this.state.days[dateKeyHint]) {
      const idx = this.state.days[dateKeyHint].tasks.findIndex((t) => t.id === id);
      if (idx !== -1) return { dateKey: dateKeyHint, day: this.state.days[dateKeyHint], idx, task: this.state.days[dateKeyHint].tasks[idx] };
    }
    for (const [key, day] of Object.entries(this.state.days)) {
      const idx = day.tasks.findIndex((t) => t.id === id);
      if (idx !== -1) return { dateKey: key, day, idx, task: day.tasks[idx] };
    }
    return null;
  }

  toggleTask(id, dateKeyHint = null) {
    this.ensureToday();
    const found = this.findTask(id, dateKeyHint);
    if (!found) return null;
    found.task.done = !found.task.done;
    found.task.doneAt = found.task.done ? Date.now() : null;
    this.save();
    return { ...found.task, dateKey: found.dateKey };
  }

  updateTask(id, patch = {}, dateKeyHint = null) {
    this.ensureToday();
    const found = this.findTask(id, dateKeyHint);
    if (!found) return null;
    if (typeof patch.text === 'string') {
      const clean = patch.text.trim();
      if (clean) found.task.text = clean.slice(0, 140);
    }
    if (patch.priority === 'urgent' || patch.priority === 'normal') {
      found.task.priority = patch.priority;
    }
    // Optional reschedule to another date
    if (isValidDateKey(patch.dateKey) && patch.dateKey !== found.dateKey) {
      found.day.tasks.splice(found.idx, 1);
      const nextDay = this.ensureDay(patch.dateKey);
      found.task.seq = this.nextSeq(nextDay);
      found.task.originDate = patch.dateKey;
      nextDay.tasks.unshift(found.task);
      this.save();
      return { ...found.task, dateKey: patch.dateKey };
    }
    this.save();
    return { ...found.task, dateKey: found.dateKey };
  }

  deleteTask(id, dateKeyHint = null) {
    this.ensureToday();
    const found = this.findTask(id, dateKeyHint);
    if (!found) return false;
    found.day.tasks.splice(found.idx, 1);
    this.save();
    return true;
  }

  clearDone(dateKey = null) {
    this.ensureToday();
    const key = isValidDateKey(dateKey) ? dateKey : this.todayKey();
    const day = this.ensureDay(key);
    const doneItems = day.tasks.filter((t) => t.done);
    if (doneItems.length === 0) return 0;
    day.tasks = day.tasks.filter((t) => !t.done);
    day.tornCount = (day.tornCount || 0) + doneItems.length;
    this.save();
    return doneItems.length;
  }

  updateSettings(patch = {}) {
    const VALID_THEMES = new Set(['ivory', 'matcha', 'sky', 'peach']);
    const VALID_TAB_STYLES = new Set(['slot', 'mascot', 'island', 'retro']);
    const next = { ...this.state.settings };
    if (patch.edge === 'left' || patch.edge === 'right') next.edge = patch.edge;
    if (typeof patch.dockYRatio === 'number' && Number.isFinite(patch.dockYRatio)) {
      next.dockYRatio = Math.min(0.92, Math.max(0.08, patch.dockYRatio));
    }
    if (typeof patch.pinned === 'boolean') next.pinned = patch.pinned;
    if (typeof patch.sound === 'boolean') next.sound = patch.sound;
    if (typeof patch.carryOver === 'boolean') next.carryOver = patch.carryOver;
    if (typeof patch.autoFadeDone === 'boolean') next.autoFadeDone = patch.autoFadeDone;
    if (typeof patch.hoverOpen === 'boolean') next.hoverOpen = patch.hoverOpen;
    if (typeof patch.launchAtLogin === 'boolean') next.launchAtLogin = patch.launchAtLogin;
    if (VALID_THEMES.has(patch.theme)) next.theme = patch.theme;
    if (VALID_TAB_STYLES.has(patch.tabStyle)) next.tabStyle = patch.tabStyle;
    this.state.settings = next;
    this.save();
    return this.state.settings;
  }

  dayCompletedCount(dateKey) {
    const rec = this.state.days[dateKey];
    if (!rec) return 0;
    const doneNow = Array.isArray(rec.tasks) ? rec.tasks.filter((t) => t.done).length : 0;
    return doneNow + (rec.tornCount || 0);
  }

  computeStreak(todayKey) {
    let streak = 0;
    let cursor = todayKey;
    if (this.dayCompletedCount(todayKey) === 0) {
      cursor = shiftDateKey(todayKey, -1);
    }
    for (let i = 0; i < 365; i++) {
      if (this.dayCompletedCount(cursor) > 0) {
        streak += 1;
        cursor = shiftDateKey(cursor, -1);
      } else {
        break;
      }
    }
    return streak;
  }

  getThisWeekCompleted(todayKey) {
    const [y, m, d] = todayKey.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    const dow = dt.getDay(); // 0=Sun..6=Sat
    const daysSinceMonday = dow === 0 ? 6 : dow - 1;
    let sum = 0;
    for (let offset = -daysSinceMonday; offset <= 0; offset++) {
      sum += this.dayCompletedCount(shiftDateKey(todayKey, offset));
    }
    return sum;
  }

  getLast7Days(todayKey) {
    const days = [];
    for (let offset = -6; offset <= 0; offset++) {
      const key = shiftDateKey(todayKey, offset);
      const rec = this.state.days[key];
      const completed = this.dayCompletedCount(key);
      const total = rec ? (rec.tasks.length + (rec.tornCount || 0)) : 0;
      days.push({
        date: key,
        completed,
        total,
        ratio: total > 0 ? completed / total : 0
      });
    }
    return days;
  }

  /**
   * Build compact upcoming day tabs (Today, Tomorrow, Day+2, plus any future dates that already have tasks).
   */
  getDayAgenda(todayKey) {
    const pinnedDates = [
      todayKey,
      shiftDateKey(todayKey, 1),
      shiftDateKey(todayKey, 2)
    ];

    const extraFuture = Object.keys(this.state.days)
      .filter((k) => k > shiftDateKey(todayKey, 2) && (this.state.days[k].tasks || []).length > 0)
      .sort()
      .slice(0, 4);

    const allKeys = [...pinnedDates, ...extraFuture];
    return allKeys.map((key) => {
      const rec = this.state.days[key];
      const tasks = rec && Array.isArray(rec.tasks) ? rec.tasks : [];
      const pending = tasks.filter((t) => !t.done).length;
      return {
        dateKey: key,
        total: tasks.length,
        pending,
        done: tasks.length - pending
      };
    });
  }

  getSnapshot(activeDateKey = null) {
    const today = this.todayKey();
    this.ensureToday();
    const viewDate = isValidDateKey(activeDateKey) ? activeDateKey : today;
    const day = this.ensureDay(viewDate);

    const sorted = [...day.tasks]
      .map((t) => ({
        ...t,
        dateKey: viewDate,
        originDate: t.originDate || viewDate,
        carriedFrom: viewDate === today && t.originDate && t.originDate < today ? t.originDate : null
      }))
      .sort((a, b) => {
        if (a.done !== b.done) return a.done ? 1 : -1;
        if (!a.done && Boolean(a.carriedFrom) !== Boolean(b.carriedFrom)) {
          return a.carriedFrom ? -1 : 1;
        }
        if (!a.done && a.priority !== b.priority) return a.priority === 'urgent' ? -1 : 1;
        return b.createdAt - a.createdAt;
      });

    const total = sorted.length;
    const done = sorted.filter((t) => t.done).length;
    const pending = total - done;

    // Also provide today's summary for the always-visible collapsed edge bookmark
    const todayDay = this.ensureDay(today);
    const todayTotal = todayDay.tasks.length;
    const todayDone = todayDay.tasks.filter((t) => t.done).length;

    return {
      today,
      activeDate: viewDate,
      tasks: sorted,
      agenda: this.getDayAgenda(today),
      stats: {
        total,
        done,
        pending,
        tornCount: day.tornCount || 0,
        allDone: total > 0 && pending === 0,
        todayTotal,
        todayDone,
        todayAllDone: todayTotal > 0 && todayDone === todayTotal,
        weekCompleted: this.getThisWeekCompleted(today),
        streak: this.computeStreak(today),
        week: this.getLast7Days(today)
      },
      settings: { ...this.state.settings }
    };
  }
}

module.exports = {
  TicketStore,
  formatDateKey,
  shiftDateKey,
  sanitizeState,
  defaultSettings
};
