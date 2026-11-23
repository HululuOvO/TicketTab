'use strict';

(() => {
  const api = window.ticketAPI;
  const sound = window.ticketSound;

  const WEEK_ZH = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const FOCUS_PRESETS_MIN = [25, 15, 45];

  const els = {
    body: document.body,
    edgeTab: document.getElementById('edgeTab'),
    tabSlotVariant: document.getElementById('tabSlotVariant'),
    slotVal: document.getElementById('slotVal'),
    slotLed: document.getElementById('slotLed'),
    tabMascotVariant: document.getElementById('tabMascotVariant'),
    mascotVal: document.getElementById('mascotVal'),
    mascotLed: document.getElementById('mascotLed'),
    tabIslandVariant: document.getElementById('tabIslandVariant'),
    islandVal: document.getElementById('islandVal'),
    tabRetroVariant: document.getElementById('tabRetroVariant'),
    retroVal: document.getElementById('retroVal'),
    retroLed: document.getElementById('retroLed'),
    drawerWrap: document.getElementById('drawerWrap'),
    drawerHandle: document.getElementById('drawerHandle'),
    powerLed: document.getElementById('powerLed'),
    focusModule: document.getElementById('focusModule'),
    focusToggleBtn: document.getElementById('focusToggleBtn'),
    focusIcon: document.getElementById('focusIcon'),
    focusTime: document.getElementById('focusTime'),
    focusResetBtn: document.getElementById('focusResetBtn'),
    serialNo: document.getElementById('serialNo'),
    dateMain: document.getElementById('dateMain'),
    dateWeek: document.getElementById('dateWeek'),
    stampBox: document.getElementById('stampBox'),
    dayStrip: document.getElementById('dayStrip'),
    progressFill: document.getElementById('progressFill'),
    addForm: document.getElementById('addForm'),
    priorityToggle: document.getElementById('priorityToggle'),
    taskInput: document.getElementById('taskInput'),
    aiOpenBtn: document.getElementById('aiOpenBtn'),
    ticketList: document.getElementById('ticketList'),
    weekCleared: document.getElementById('weekCleared'),
    tearBtn: document.getElementById('tearBtn'),
    pinBtn: document.getElementById('pinBtn'),
    settingsBtn: document.getElementById('settingsBtn'),
    thermalWave: document.getElementById('thermalWave'),
    aiSheet: document.getElementById('aiSheet'),
    aiCloseBtn: document.getElementById('aiCloseBtn'),
    aiGuideBtn: document.getElementById('aiGuideBtn'),
    aiGuideCard: document.getElementById('aiGuideCard'),
    aiGuideGotItBtn: document.getElementById('aiGuideGotItBtn'),
    aiPasteNowBtn: document.getElementById('aiPasteNowBtn'),
    aiPasteArea: document.getElementById('aiPasteArea'),
    aiParseBtn: document.getElementById('aiParseBtn'),
    copyPromptBtn: document.getElementById('copyPromptBtn'),
    copyMcpBtn: document.getElementById('copyMcpBtn'),
    copyApiBtn: document.getElementById('copyApiBtn'),
    settingsSheet: document.getElementById('settingsSheet'),
    settingsCloseBtn: document.getElementById('settingsCloseBtn'),
    tabStyleControl: document.getElementById('tabStyleControl'),
    themeDots: document.getElementById('themeDots'),
    edgeLeftBtn: document.getElementById('edgeLeftBtn'),
    edgeRightBtn: document.getElementById('edgeRightBtn'),
    optHoverOpen: document.getElementById('optHoverOpen'),
    optAutoFade: document.getElementById('optAutoFade'),
    optCarryOver: document.getElementById('optCarryOver'),
    optPinned: document.getElementById('optPinned'),
    optSound: document.getElementById('optSound'),
    optLaunch: document.getElementById('optLaunch'),
    taskSheet: document.getElementById('taskSheet'),
    taskSheetTitle: document.getElementById('taskSheetTitle'),
    taskSheetCloseBtn: document.getElementById('taskSheetCloseBtn'),
    tkUrgent: document.getElementById('tkUrgent'),
    tkRemEnabled: document.getElementById('tkRemEnabled'),
    tkDate: document.getElementById('tkDate'),
    tkTime: document.getElementById('tkTime'),
    tkRepeatControl: document.getElementById('tkRepeatControl'),
    tkPreAlertsControl: document.getElementById('tkPreAlertsControl'),
    tkIntervalRow: document.getElementById('tkIntervalRow'),
    tkIntervalControl: document.getElementById('tkIntervalControl'),
    tkTestAlertBtn: document.getElementById('tkTestAlertBtn'),
    tkDeleteBtn: document.getElementById('tkDeleteBtn'),
    microToast: document.getElementById('microToast')
  };

  let currentState = null;
  let lastAddedIds = new Set();
  let editingId = null;
  let inspectingTaskId = null;
  let autoFadeTimer = null;
  let hoverOpenTimer = null;
  let isThermalFading = false;
  let toastTimer = null;

  // ==================== 25-MINUTE FOCUS TIMER (SYNCED TO FLOATING EDGE TAB!) ====================
  const focus = {
    presetIdx: 0,
    totalSec: 25 * 60,
    remainingSec: 25 * 60,
    running: false,
    endAt: 0,
    timerId: null
  };

  function formatMMSS(sec) {
    const s = Math.max(0, Math.ceil(sec));
    const mm = String(Math.floor(s / 60)).padStart(2, '0');
    const ss = String(s % 60).padStart(2, '0');
    return `${mm}:${ss}`;
  }

  function updateFocusVisuals() {
    const timeStr = formatMMSS(focus.remainingSec);
    els.focusTime.textContent = timeStr;
    els.focusModule.classList.toggle('running', focus.running);
    els.powerLed.classList.toggle('focusing', focus.running);
    els.focusResetBtn.hidden = !focus.running && focus.remainingSec === focus.totalSec;

    els.focusIcon.innerHTML = focus.running
      ? '<svg width="10" height="10" viewBox="0 0 12 12" fill="currentColor"><rect x="2" y="1.5" width="3" height="9" rx="1"/><rect x="7" y="1.5" width="3" height="9" rx="1"/></svg>'
      : '<svg width="10" height="10" viewBox="0 0 12 12" fill="currentColor"><polygon points="2.5,1.5 10.5,6 2.5,10.5"/></svg>';

    // Sync ALL 4 selectable floating tab variants cleanly — handles 2/4, 12/18, 99+, and 24:58 without ever overflowing!
    const showTimerOnTab = focus.running || focus.remainingSec < focus.totalSec;
    const stats = currentState ? currentState.snapshot.stats : { todayDone: 0, todayTotal: 0, todayAllDone: false };
    const compactCount = stats.todayTotal > 99 ? `${stats.todayDone}/99+` : `${stats.todayDone}/${stats.todayTotal}`;
    const islandCount = stats.todayTotal > 99 ? `${stats.todayDone} / 99+` : `${stats.todayDone} / ${stats.todayTotal}`;
    const displayCompact = showTimerOnTab ? timeStr : compactCount;
    const displayIsland = showTimerOnTab ? timeStr : islandCount;
    const isAllDone = !showTimerOnTab && Boolean(stats.todayAllDone);

    // 1. Real Paper Slot variant
    els.slotVal.textContent = displayCompact;
    els.tabSlotVariant.classList.toggle('focusing', showTimerOnTab);
    els.tabSlotVariant.classList.toggle('all-done', isAllDone);
    els.slotLed.classList.toggle('focusing', focus.running);

    // 2. Peeking Anime Mascot variant
    els.mascotVal.textContent = displayCompact;
    els.tabMascotVariant.classList.toggle('focusing', showTimerOnTab);
    els.tabMascotVariant.classList.toggle('all-done', isAllDone);
    els.mascotLed.classList.toggle('focusing', focus.running);

    // 3. Dynamic Island Pill variant
    els.islandVal.textContent = displayIsland;
    els.tabIslandVariant.classList.toggle('focusing', showTimerOnTab);
    els.tabIslandVariant.classList.toggle('all-done', isAllDone);

    // 4. Retro Hardware Counter variant
    els.retroVal.textContent = displayCompact;
    els.tabRetroVariant.classList.toggle('focusing', showTimerOnTab);
    els.tabRetroVariant.classList.toggle('all-done', isAllDone);
    els.retroLed.classList.toggle('focusing', focus.running);
  }

  function tickFocus() {
    if (!focus.running) return;
    const left = Math.max(0, Math.round((focus.endAt - Date.now()) / 1000));
    focus.remainingSec = left;
    updateFocusVisuals();

    if (left <= 0) {
      stopFocus(false);
      focus.remainingSec = focus.totalSec;
      updateFocusVisuals();
      sound.playFocusDone();
      showToast('专注完成');
    }
  }

  function startFocus() {
    if (focus.running) return;
    if (focus.remainingSec <= 0) focus.remainingSec = focus.totalSec;
    focus.running = true;
    focus.endAt = Date.now() + focus.remainingSec * 1000;
    sound.playFocusTick(true);
    clearInterval(focus.timerId);
    focus.timerId = setInterval(tickFocus, 500);
    updateFocusVisuals();
  }

  function stopFocus(playSound = true) {
    if (!focus.running) return;
    focus.running = false;
    clearInterval(focus.timerId);
    focus.timerId = null;
    if (playSound) sound.playFocusTick(false);
    updateFocusVisuals();
  }

  function resetFocus() {
    stopFocus(false);
    focus.remainingSec = focus.totalSec;
    updateFocusVisuals();
  }

  function cycleFocusPreset() {
    if (focus.running) return;
    focus.presetIdx = (focus.presetIdx + 1) % FOCUS_PRESETS_MIN.length;
    focus.totalSec = FOCUS_PRESETS_MIN[focus.presetIdx] * 60;
    focus.remainingSec = focus.totalSec;
    updateFocusVisuals();
    showToast(`${FOCUS_PRESETS_MIN[focus.presetIdx]} 分钟专注`);
  }

  function showToast(msg) {
    if (!els.microToast) return;
    clearTimeout(toastTimer);
    els.microToast.textContent = msg;
    els.microToast.classList.add('show');
    toastTimer = setTimeout(() => els.microToast.classList.remove('show'), 1800);
  }

  function formatHeaderDate(dateKey) {
    const [y, m, d] = dateKey.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    return {
      serial: `NO.${y}-${String(m).padStart(2, '0')}${String(d).padStart(2, '0')}`,
      main: `${String(m).padStart(2, '0')}.${String(d).padStart(2, '0')}`,
      week: WEEK_ZH[dt.getDay()]
    };
  }

  function formatShortDate(dateKey) {
    const [, m, d] = dateKey.split('-');
    return `${m}.${d}`;
  }

  function dayDiff(fromKey, toKey) {
    const [y1, m1, d1] = fromKey.split('-').map(Number);
    const [y2, m2, d2] = toKey.split('-').map(Number);
    return Math.round((new Date(y2, m2 - 1, d2) - new Date(y1, m1 - 1, d1)) / 86400000);
  }

  function dayPillLabel(dateKey, todayKey) {
    const diff = dayDiff(todayKey, dateKey);
    if (diff === 0) return '今天';
    if (diff === 1) return '明天';
    if (diff === 2) return '后天';
    return formatShortDate(dateKey);
  }

  function cancelAutoThermalFade() {
    clearTimeout(autoFadeTimer);
    autoFadeTimer = null;
    els.stampBox.classList.remove('heating');
  }

  function runThermalErase(fullWave = true) {
    if (isThermalFading) return;
    const doneNodes = Array.from(els.ticketList.querySelectorAll('.ticket-item.done'));
    if (!doneNodes.length) return;

    cancelAutoThermalFade();
    isThermalFading = true;

    if (fullWave && els.thermalWave) {
      els.thermalWave.classList.remove('active');
      void els.thermalWave.offsetWidth;
      els.thermalWave.classList.add('active');
    }

    sound.playThermalFade();

    const bottomUp = [...doneNodes].reverse();
    bottomUp.forEach((node, idx) => {
      setTimeout(() => node.classList.add('thermal-fading'), idx * 95);
    });

    const totalMs = 1080 + (bottomUp.length - 1) * 95;
    setTimeout(async () => {
      await api.clearDone();
      isThermalFading = false;
      if (els.thermalWave) els.thermalWave.classList.remove('active');
    }, totalMs);
  }

  function scheduleAutoThermalFade() {
    if (currentState && currentState.snapshot.settings.autoFadeDone === false) return;
    cancelAutoThermalFade();
    els.stampBox.classList.add('heating');
    autoFadeTimer = setTimeout(() => {
      if (currentState && currentState.snapshot.stats.allDone && !isThermalFading) {
        runThermalErase(true);
      }
    }, 2400);
  }

  function spawnSparks(originEl, allDone = false) {
    if (!originEl) return;
    const rect = originEl.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const colors = allDone
      ? ['#2e8b67', '#5cb892', '#d4a259', '#c95642']
      : ['#c95642', '#df8574', '#221f1b'];

    const count = allDone ? 12 : 6;
    for (let i = 0; i < count; i++) {
      const sp = document.createElement('span');
      sp.className = 'spark';
      const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.4;
      const dist = (allDone ? 32 : 20) + Math.random() * 14;
      sp.style.left = `${cx}px`;
      sp.style.top = `${cy}px`;
      sp.style.background = colors[i % colors.length];
      sp.style.setProperty('--dx', `${Math.cos(angle) * dist}px`);
      sp.style.setProperty('--dy', `${Math.sin(angle) * dist}px`);
      sp.style.setProperty('--rot', `${Math.round(Math.random() * 200 - 100)}deg`);
      document.body.appendChild(sp);
      setTimeout(() => sp.remove(), 480);
    }
  }

  function renderDayStrip(agenda = [], activeDate, today) {
    els.dayStrip.innerHTML = '';
    const list = [...agenda];
    if (activeDate && !list.some((d) => d.dateKey === activeDate)) {
      list.push({ dateKey: activeDate, total: 0, pending: 0, done: 0 });
    }

    for (const item of list) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'day-pill';
      if (item.dateKey === activeDate) btn.classList.add('active');

      const txt = document.createElement('span');
      txt.textContent = dayPillLabel(item.dateKey, today);
      btn.appendChild(txt);

      if (item.pending > 0) {
        const dot = document.createElement('span');
        dot.className = 'day-pill-dot';
        btn.appendChild(dot);
      }

      btn.addEventListener('click', () => {
        cancelAutoThermalFade();
        api.setActiveDate(item.dateKey === today ? null : item.dateKey);
      });

      els.dayStrip.appendChild(btn);
    }

    const wrap = document.createElement('label');
    wrap.className = 'day-picker-wrap';
    wrap.setAttribute('aria-label', 'Pick date');
    wrap.innerHTML = `
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="4" width="18" height="18" rx="2"/>
        <line x1="16" y1="2" x2="16" y2="6"/>
        <line x1="8" y1="2" x2="8" y2="6"/>
        <line x1="3" y1="10" x2="21" y2="10"/>
      </svg>
    `;
    const picker = document.createElement('input');
    picker.type = 'date';
    picker.className = 'day-picker-input';
    picker.value = activeDate || today;
    picker.addEventListener('change', () => {
      if (picker.value) {
        cancelAutoThermalFade();
        api.setActiveDate(picker.value === today ? null : picker.value);
      }
    });
    wrap.appendChild(picker);
    els.dayStrip.appendChild(wrap);
  }

  function renderTasks(tasks) {
    els.ticketList.innerHTML = '';

    if (!tasks.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-roll';
      empty.innerHTML = `
        <svg viewBox="0 0 96 96" fill="none">
          <rect x="22" y="18" width="52" height="58" rx="8" fill="#ffffff" stroke="#221f1b" stroke-opacity="0.18" stroke-width="1.8" stroke-dasharray="4 4"/>
          <line x1="33" y1="37" x2="63" y2="37" stroke="#221f1b" stroke-opacity="0.18" stroke-width="2.6" stroke-linecap="round"/>
          <line x1="33" y1="48" x2="54" y2="48" stroke="#221f1b" stroke-opacity="0.14" stroke-width="2.6" stroke-linecap="round"/>
          <line x1="33" y1="59" x2="46" y2="59" stroke="#c95642" stroke-opacity="0.45" stroke-width="2.6" stroke-linecap="round"/>
        </svg>
      `;
      els.ticketList.appendChild(empty);
      return;
    }

    const frag = document.createDocumentFragment();
    for (const task of tasks) {
      const row = document.createElement('div');
      row.className = 'ticket-item';
      row.dataset.id = task.id;
      if (task.done) row.classList.add('done');
      if (!task.done && task.carriedFrom) row.classList.add('carried');
      if (!task.done && task.priority === 'urgent') row.classList.add('urgent');
      if (lastAddedIds.has(task.id)) row.classList.add('printing');

      const chk = document.createElement('button');
      chk.type = 'button';
      chk.className = 'ticket-check';
      chk.setAttribute('aria-label', 'Toggle task');
      chk.innerHTML = task.done
        ? '<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 8.5 6.5 12 13 4.5"/></svg>'
        : '';

      chk.addEventListener('click', async () => {
        if (isThermalFading) return;
        const res = await api.toggleTask(task.id);
        if (res && res.toggled && res.toggled.done) {
          const allDone = Boolean(res.snapshot && res.snapshot.stats.allDone);
          sound.playStamp(allDone);
          spawnSparks(chk, allDone);
          els.stampBox.classList.remove('pop');
          void els.stampBox.offsetWidth;
          els.stampBox.classList.add('pop');
          if (allDone) {
            scheduleAutoThermalFade();
          }
        } else {
          cancelAutoThermalFade();
        }
      });

      let textNode;
      if (editingId === task.id) {
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'ticket-edit-input';
        input.value = task.text;
        input.maxLength = 140;

        const commit = async () => {
          const next = input.value.trim();
          editingId = null;
          if (next && next !== task.text) {
            await api.updateTask(task.id, { text: next });
          } else if (currentState) {
            render(currentState);
          }
        };

        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit(); }
          else if (e.key === 'Escape') { editingId = null; if (currentState) render(currentState); }
        });
        input.addEventListener('blur', commit);
        textNode = input;
        requestAnimationFrame(() => { input.focus(); input.select(); });
      } else {
        const span = document.createElement('span');
        span.className = 'ticket-text';
        span.textContent = task.text;
        span.addEventListener('dblclick', () => {
          editingId = task.id;
          if (currentState) render(currentState);
        });
        textNode = span;
      }

      const meta = document.createElement('div');
      meta.className = 'ticket-meta';

      if (task.carriedFrom && !task.done) {
        const chip = document.createElement('span');
        chip.className = 'carried-chip';
        chip.textContent = formatShortDate(task.carriedFrom);
        meta.appendChild(chip);
      } else if (task.source === 'ai' && !task.done) {
        const aiMark = document.createElement('span');
        aiMark.className = 'ai-tag';
        aiMark.textContent = '✦';
        meta.appendChild(aiMark);
      }

      // Compact reminder chip if task has an active alarm or repeat rule
      const rem = task.reminder || {};
      if (!task.done && (rem.enabled || (rem.repeat && rem.repeat !== 'none'))) {
        const rChip = document.createElement('button');
        rChip.type = 'button';
        rChip.className = 'rem-chip';
        const repGlyph = rem.repeat && rem.repeat !== 'none' ? '↻' : '';
        rChip.textContent = `${rem.enabled ? rem.time : ''}${repGlyph}`;
        rChip.addEventListener('click', () => openTaskInspector(task.id));
        meta.appendChild(rChip);
      }

      // Per-task quick-config button (Urgent / Reminder / Repeat / Advance 1~4 alerts)
      const moreBtn = document.createElement('button');
      moreBtn.type = 'button';
      moreBtn.className = 'ticket-more';
      if (inspectingTaskId === task.id) moreBtn.classList.add('active');
      moreBtn.setAttribute('aria-label', 'Task reminder & options');
      moreBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>';
      moreBtn.addEventListener('click', () => openTaskInspector(task.id));

      const seq = document.createElement('span');
      seq.className = 'ticket-seq';
      seq.textContent = `#${String(task.seq).padStart(2, '0')}`;

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'ticket-del';
      del.setAttribute('aria-label', 'Delete');
      del.textContent = '×';
      del.addEventListener('click', async () => {
        if (inspectingTaskId === task.id) closeAllSheets();
        row.classList.add('tearing');
        sound.playTear();
        setTimeout(() => api.deleteTask(task.id), 190);
      });

      meta.append(moreBtn, seq, del);
      row.append(chk, textNode, meta);
      frag.appendChild(row);
    }

    els.ticketList.appendChild(frag);
    lastAddedIds.clear();
  }

  function syncSettingsUI(settings) {
    els.body.dataset.theme = settings.theme || 'ivory';
    els.body.dataset.tabStyle = settings.tabStyle || 'slot';
    els.tabStyleControl.querySelectorAll('.seg-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tabStyle === (settings.tabStyle || 'slot'));
    });
    els.themeDots.querySelectorAll('.theme-dot').forEach((dot) => {
      dot.classList.toggle('active', dot.dataset.theme === (settings.theme || 'ivory'));
    });
    els.edgeLeftBtn.classList.toggle('active', settings.edge === 'left');
    els.edgeRightBtn.classList.toggle('active', settings.edge !== 'left');
    els.optHoverOpen.checked = Boolean(settings.hoverOpen);
    els.optAutoFade.checked = settings.autoFadeDone !== false;
    els.optCarryOver.checked = settings.carryOver !== false;
    els.optPinned.checked = Boolean(settings.pinned);
    els.optSound.checked = settings.sound !== false;
    els.optLaunch.checked = Boolean(settings.launchAtLogin);
  }

  function render(payload) {
    if (!payload || !payload.snapshot) return;
    currentState = payload;

    const { snapshot, ui } = payload;
    const { stats, settings, tasks, today, activeDate, agenda } = snapshot;

    sound.setEnabled(settings.sound);
    syncSettingsUI(settings);

    const phase = ui.expanded ? 'expanded' : 'collapsed';
    els.body.dataset.edge = settings.edge === 'left' ? 'left' : 'right';
    els.body.dataset.phase = phase;
    els.drawerWrap.setAttribute('aria-hidden', ui.expanded ? 'false' : 'true');

    if (!ui.expanded) {
      closeAllSheets();
    }

    updateFocusVisuals();

    const dt = formatHeaderDate(activeDate || today);
    els.serialNo.textContent = dt.serial;
    els.dateMain.textContent = dt.main;
    els.dateWeek.textContent = dt.week;

    renderDayStrip(agenda, activeDate || today, today);

    const viewRatio = stats.total > 0 ? stats.done / stats.total : 0;
    els.stampBox.textContent = stats.allDone ? 'ALL DONE' : `${stats.done} / ${stats.total}`;
    els.stampBox.classList.toggle('all-done', stats.allDone);
    els.progressFill.style.width = `${Math.round(viewRatio * 100)}%`;
    els.progressFill.classList.toggle('all-done', stats.allDone);

    const weekCount = typeof stats.weekCompleted === 'number' ? stats.weekCompleted : 0;
    els.weekCleared.textContent = `本周已清 ${weekCount} 项`;

    els.tearBtn.hidden = stats.done === 0;
    els.pinBtn.classList.toggle('active', Boolean(settings.pinned));

    if (ui.aiEvent && ui.aiEvent.count > 0) {
      sound.playPrint();
      showToast(`AI 已出票 ${ui.aiEvent.count} 条`);
    } else if (ui.justImportedCount > 0) {
      sound.playPrint();
      showToast(`已吸票 ${ui.justImportedCount} 条`);
    }

    renderTasks(tasks);
    if (inspectingTaskId) {
      syncTaskInspector();
    }
  }

  function findInspectingTask() {
    if (!inspectingTaskId || !currentState) return null;
    return (currentState.snapshot.tasks || []).find((t) => t.id === inspectingTaskId) || null;
  }

  function syncTaskInspector() {
    const task = findInspectingTask();
    if (!task) {
      if (els.taskSheet.classList.contains('open')) closeAllSheets();
      return;
    }
    const rem = task.reminder || { enabled: false, time: '09:00', repeat: 'none', preAlerts: 0, preIntervalMin: 15 };
    els.taskSheetTitle.textContent = task.text;
    els.tkUrgent.checked = task.priority === 'urgent';
    els.tkRemEnabled.checked = Boolean(rem.enabled);
    els.tkDate.value = task.dateKey || currentState.snapshot.activeDate || currentState.snapshot.today;
    els.tkTime.value = rem.time || '09:00';

    els.tkRepeatControl.querySelectorAll('.seg-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.repeat === (rem.repeat || 'none'));
    });
    const preVal = String(rem.preAlerts || 0);
    els.tkPreAlertsControl.querySelectorAll('.seg-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.pre === preVal);
    });
    const intVal = String(rem.preIntervalMin || 15);
    els.tkIntervalControl.querySelectorAll('.seg-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.int === intVal);
    });
    els.tkIntervalRow.hidden = !(rem.preAlerts > 0);
  }

  function openTaskInspector(taskId) {
    const already = inspectingTaskId === taskId && els.taskSheet.classList.contains('open');
    closeAllSheets();
    if (already) return;
    inspectingTaskId = taskId;
    syncTaskInspector();
    els.taskSheet.classList.add('open');
    els.taskSheet.setAttribute('aria-hidden', 'false');
    if (currentState) renderTasks(currentState.snapshot.tasks);
  }

  function setAiGuideVisible(visible) {
    els.aiGuideCard.hidden = !visible;
    els.aiGuideBtn.classList.toggle('active', visible);
  }

  function closeAllSheets() {
    inspectingTaskId = null;
    els.aiSheet.classList.remove('open');
    els.aiSheet.setAttribute('aria-hidden', 'true');
    els.aiOpenBtn.classList.remove('open');
    els.settingsSheet.classList.remove('open');
    els.settingsSheet.setAttribute('aria-hidden', 'true');
    els.settingsBtn.classList.remove('active');
    els.taskSheet.classList.remove('open');
    els.taskSheet.setAttribute('aria-hidden', 'true');
  }

  function toggleSheet(which) {
    const isAi = which === 'ai';
    const target = isAi ? els.aiSheet : els.settingsSheet;
    const willOpen = !target.classList.contains('open');
    closeAllSheets();
    if (willOpen) {
      target.classList.add('open');
      target.setAttribute('aria-hidden', 'false');
      if (isAi) {
        els.aiOpenBtn.classList.add('open');
        const firstTime = currentState && !currentState.snapshot.settings.aiGuideSeen;
        setAiGuideVisible(Boolean(firstTime));
        setTimeout(() => els.aiPasteArea.focus(), 80);
      } else {
        els.settingsBtn.classList.add('active');
      }
    }
  }

  // ==================== FOCUS TIMER EVENTS ====================
  els.focusToggleBtn.addEventListener('click', () => {
    if (focus.running) {
      stopFocus(true);
    } else {
      startFocus();
    }
  });

  // Right-click timer pill to quickly cycle 25 / 15 / 45 min presets
  els.focusToggleBtn.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    cycleFocusPreset();
  });

  els.focusResetBtn.addEventListener('click', () => {
    resetFocus();
  });

  // ==================== MOUSE PASSTHROUGH ====================
  els.edgeTab.addEventListener('mouseenter', () => {
    if (currentState && !currentState.ui.expanded) {
      api.setIgnoreMouse(false);
      if (currentState.snapshot.settings.hoverOpen) {
        clearTimeout(hoverOpenTimer);
        hoverOpenTimer = setTimeout(() => {
          if (currentState && !currentState.ui.expanded) {
            api.setExpanded(true);
          }
        }, 160);
      }
    }
  });

  els.edgeTab.addEventListener('mouseleave', () => {
    clearTimeout(hoverOpenTimer);
    if (currentState && !currentState.ui.expanded && !dragState) {
      api.setIgnoreMouse(true);
    }
  });

  // ==================== INTERACTIONS ====================
  let dragState = null;

  els.edgeTab.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    clearTimeout(hoverOpenTimer);
    els.edgeTab.setPointerCapture(e.pointerId);
    dragState = {
      pointerId: e.pointerId,
      startScreenX: e.screenX,
      startScreenY: e.screenY,
      moved: false
    };
  });

  els.edgeTab.addEventListener('pointermove', (e) => {
    if (!dragState || e.pointerId !== dragState.pointerId) return;
    const dx = Math.abs(e.screenX - dragState.startScreenX);
    const dy = Math.abs(e.screenY - dragState.startScreenY);
    if (!dragState.moved && (dx > 5 || dy > 5)) {
      dragState.moved = true;
    }
    if (dragState.moved) {
      api.dragMove(e.screenX, e.screenY);
    }
  });

  const finishTabPointer = async (e) => {
    if (!dragState || e.pointerId !== dragState.pointerId) return;
    const wasDrag = dragState.moved;
    dragState = null;
    if (wasDrag) {
      await api.dragEnd(e.screenX, e.screenY);
    } else {
      await api.setExpanded(true);
      setTimeout(() => els.taskInput.focus(), 140);
    }
  };

  els.edgeTab.addEventListener('pointerup', finishTabPointer);
  els.edgeTab.addEventListener('pointercancel', finishTabPointer);

  els.drawerHandle.addEventListener('click', () => {
    closeAllSheets();
    api.setExpanded(false);
  });

  els.priorityToggle.addEventListener('click', () => {
    const next = els.priorityToggle.dataset.urgent !== 'true';
    els.priorityToggle.dataset.urgent = String(next);
    els.taskInput.focus();
  });

  els.taskInput.addEventListener('paste', async (e) => {
    const pasted = (e.clipboardData && e.clipboardData.getData('text')) || '';
    if (pasted.includes('\n') && pasted.trim().length > 6) {
      e.preventDefault();
      cancelAutoThermalFade();
      const res = await api.importText(pasted);
      if (res && res.count > 0) {
        (res.created || []).forEach((t) => lastAddedIds.add(t.id));
        sound.playPrint();
        showToast(`已自动拆分 ${res.count} 条任务`);
        render(res);
      }
    }
  });

  els.addForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    cancelAutoThermalFade();
    const text = els.taskInput.value.trim();
    if (!text) return;
    const priority = els.priorityToggle.dataset.urgent === 'true' ? 'urgent' : 'normal';

    els.taskInput.value = '';
    els.priorityToggle.dataset.urgent = 'false';

    const res = await api.addTask(text, priority);
    if (res && res.created) {
      lastAddedIds.add(res.created.id);
      sound.playPrint();
      render(res);
    }
    els.taskInput.focus();
  });

  // AI Sheet + First-time visual guide
  els.aiOpenBtn.addEventListener('click', () => toggleSheet('ai'));
  els.aiCloseBtn.addEventListener('click', closeAllSheets);
  els.aiGuideBtn.addEventListener('click', () => {
    setAiGuideVisible(els.aiGuideCard.hidden);
  });
  els.aiGuideGotItBtn.addEventListener('click', () => {
    setAiGuideVisible(false);
    api.updateSettings({ aiGuideSeen: true });
  });

  // Task Inspector Sheet (Urgent / Reminder / Date+Time / Repeat / Pre-alerts 1..4 / Test Alert)
  els.taskSheetCloseBtn.addEventListener('click', () => {
    closeAllSheets();
    if (currentState) renderTasks(currentState.snapshot.tasks);
  });

  els.tkUrgent.addEventListener('change', () => {
    if (!inspectingTaskId) return;
    api.updateTask(inspectingTaskId, { priority: els.tkUrgent.checked ? 'urgent' : 'normal' });
  });

  els.tkRemEnabled.addEventListener('change', () => {
    if (!inspectingTaskId) return;
    api.updateTask(inspectingTaskId, { reminder: { enabled: els.tkRemEnabled.checked } });
  });

  els.tkDate.addEventListener('change', () => {
    if (!inspectingTaskId || !els.tkDate.value) return;
    const nextDate = els.tkDate.value;
    api.updateTask(inspectingTaskId, { dateKey: nextDate }).then(() => {
      api.setActiveDate(nextDate === currentState.snapshot.today ? null : nextDate);
    });
  });

  els.tkTime.addEventListener('change', () => {
    if (!inspectingTaskId || !els.tkTime.value) return;
    api.updateTask(inspectingTaskId, { reminder: { enabled: true, time: els.tkTime.value } });
  });

  els.tkRepeatControl.querySelectorAll('.seg-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!inspectingTaskId) return;
      api.updateTask(inspectingTaskId, { reminder: { repeat: btn.dataset.repeat } });
    });
  });

  els.tkPreAlertsControl.querySelectorAll('.seg-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!inspectingTaskId) return;
      const pre = Number(btn.dataset.pre);
      api.updateTask(inspectingTaskId, { reminder: { enabled: true, preAlerts: pre } });
    });
  });

  els.tkIntervalControl.querySelectorAll('.seg-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!inspectingTaskId) return;
      const mins = Number(btn.dataset.int);
      api.updateTask(inspectingTaskId, { reminder: { preIntervalMin: mins } });
    });
  });

  els.tkTestAlertBtn.addEventListener('click', () => {
    if (!inspectingTaskId) return;
    api.testReminder(inspectingTaskId);
  });

  els.tkDeleteBtn.addEventListener('click', () => {
    if (!inspectingTaskId) return;
    const id = inspectingTaskId;
    closeAllSheets();
    sound.playTear();
    api.deleteTask(id);
  });

  els.aiPasteNowBtn.addEventListener('click', async () => {
    cancelAutoThermalFade();
    const res = await api.importClipboard();
    if (res && res.count > 0) {
      (res.created || []).forEach((t) => lastAddedIds.add(t.id));
      sound.playPrint();
      closeAllSheets();
      showToast(`已吸票 ${res.count} 条`);
      render(res);
    } else {
      showToast('剪贴板暂无可识别任务');
    }
  });

  els.aiParseBtn.addEventListener('click', async () => {
    const raw = els.aiPasteArea.value.trim();
    if (!raw) return;
    cancelAutoThermalFade();
    const res = await api.importText(raw);
    if (res && res.count > 0) {
      els.aiPasteArea.value = '';
      (res.created || []).forEach((t) => lastAddedIds.add(t.id));
      sound.playPrint();
      closeAllSheets();
      showToast(`已出票 ${res.count} 条`);
      render(res);
    } else {
      showToast('未识别到任务条目');
    }
  });

  els.copyPromptBtn.addEventListener('click', async () => {
    const prompt = [
      '请从以上内容中提取所有待办任务，按日期分组输出（直接写「今天」「明天」「后天」「下周X」或「YYYY-MM-DD」），每条占一行，重要任务末尾加「!」，不要多余解释：',
      '示例格式：',
      '今天：',
      '- 完成方案初稿 !',
      '明天：',
      '- 确认排期并同步团队'
    ].join('\n');
    await api.copyText(prompt);
    showToast('已复制通用 AI 口令');
  });

  els.copyMcpBtn.addEventListener('click', async () => {
    const mcpPath = (currentState && currentState.ui && currentState.ui.mcpPath) || 'mcp/mcp-server.js';
    const mcpJson = JSON.stringify({
      mcpServers: {
        tickettab: {
          command: 'node',
          args: [mcpPath]
        }
      }
    }, null, 2);
    await api.copyText(mcpJson);
    showToast('已复制 MCP 直连配置');
  });

  els.copyApiBtn.addEventListener('click', async () => {
    const port = (currentState && currentState.ui && currentState.ui.aiPort) || 27319;
    await api.copyText(`http://127.0.0.1:${port}/import`);
    showToast(`已复制 127.0.0.1:${port}/import`);
  });

  // Settings Sheet
  els.settingsBtn.addEventListener('click', () => toggleSheet('settings'));
  els.settingsCloseBtn.addEventListener('click', closeAllSheets);

  els.tabStyleControl.querySelectorAll('.seg-btn').forEach((btn) => {
    btn.addEventListener('click', () => api.updateSettings({ tabStyle: btn.dataset.tabStyle }));
  });

  els.themeDots.querySelectorAll('.theme-dot').forEach((dot) => {
    dot.addEventListener('click', () => api.updateSettings({ theme: dot.dataset.theme }));
  });

  els.edgeLeftBtn.addEventListener('click', () => api.updateSettings({ edge: 'left' }));
  els.edgeRightBtn.addEventListener('click', () => api.updateSettings({ edge: 'right' }));
  els.optHoverOpen.addEventListener('change', () => api.updateSettings({ hoverOpen: els.optHoverOpen.checked }));
  els.optAutoFade.addEventListener('change', () => api.updateSettings({ autoFadeDone: els.optAutoFade.checked }));
  els.optCarryOver.addEventListener('change', () => api.updateSettings({ carryOver: els.optCarryOver.checked }));
  els.optPinned.addEventListener('change', () => api.updateSettings({ pinned: els.optPinned.checked }));
  els.optSound.addEventListener('change', () => api.updateSettings({ sound: els.optSound.checked }));
  els.optLaunch.addEventListener('change', () => api.updateSettings({ launchAtLogin: els.optLaunch.checked }));

  els.tearBtn.addEventListener('click', () => runThermalErase(true));

  els.pinBtn.addEventListener('click', () => {
    if (!currentState) return;
    api.updateSettings({ pinned: !currentState.snapshot.settings.pinned });
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (
        els.aiSheet.classList.contains('open') ||
        els.settingsSheet.classList.contains('open') ||
        els.taskSheet.classList.contains('open')
      ) {
        closeAllSheets();
        if (currentState) renderTasks(currentState.snapshot.tasks);
        return;
      }
      if (!editingId) {
        api.setExpanded(false);
      }
    }
  });

  api.onStateChange((payload) => render(payload));
  api.getState().then((payload) => render(payload));
})();
