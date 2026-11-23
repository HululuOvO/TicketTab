'use strict';

(() => {
  const api = window.reminderAPI;
  const sound = window.ticketSound;

  const REPEAT_LABEL = {
    none: '',
    daily: '每天重复',
    weekdays: '工作日重复',
    weekly: '每周重复',
    monthly: '每月重复'
  };

  const els = {
    body: document.body,
    printer: document.getElementById('alertPrinter'),
    badge: document.getElementById('alertBadge'),
    time: document.getElementById('alertTime'),
    text: document.getElementById('alertText'),
    meta: document.getElementById('alertMeta'),
    closeBtn: document.getElementById('alertCloseBtn'),
    doneBtn: document.getElementById('actDoneBtn'),
    snoozeBtn: document.getElementById('actSnoozeBtn'),
    openBtn: document.getElementById('actOpenBtn')
  };

  let currentAlert = null;
  let autoDismissTimer = null;

  function dismiss(action = 'dismiss', extra = {}) {
    clearTimeout(autoDismissTimer);
    els.printer.classList.remove('visible');
    els.printer.classList.add('leaving');
    if (action === 'done') sound.playStamp(false);
    else if (action === 'dismiss') sound.playTear();

    setTimeout(() => {
      if (api) api.respond({ action, taskId: currentAlert ? currentAlert.taskId : null, ...extra });
    }, 240);
  }

  function showAlert(payload) {
    if (!payload) return;
    currentAlert = payload;
    clearTimeout(autoDismissTimer);

    els.body.dataset.origin = payload.origin === 'top' ? 'top' : 'bottom';
    els.body.dataset.theme = payload.theme || 'ivory';
    sound.setEnabled(payload.sound !== false);

    // Badge label: advance reminder step vs on-time due
    const isUrgent = payload.priority === 'urgent';
    let badgeText = '到点提醒';
    if (!payload.isExactDue && payload.leadMin > 0) {
      badgeText = `提前 ${payload.leadMin} 分钟 (${payload.stepIndex}/${payload.totalPre})`;
    } else if (isUrgent) {
      badgeText = '紧急到点';
    }

    els.badge.textContent = badgeText;
    els.badge.classList.toggle('urgent', isUrgent || payload.isExactDue);
    els.time.textContent = payload.time || '';
    els.text.textContent = payload.text || '';

    const parts = [];
    if (payload.dateKey) parts.push(payload.dateKey.slice(5).replace('-', '.'));
    if (payload.repeat && REPEAT_LABEL[payload.repeat]) parts.push(REPEAT_LABEL[payload.repeat]);
    els.meta.textContent = parts.join(' · ');

    // Trigger realistic stepwise thermal receipt extrusion + synchronized printer feed sound!
    els.printer.classList.remove('leaving', 'visible');
    void els.printer.offsetWidth;
    els.printer.classList.add('visible');
    if (typeof sound.playReceiptFeed === 'function') {
      sound.playReceiptFeed();
    } else {
      sound.playPrint();
    }

    // Gently auto-dismiss after 18s unless hovering
    autoDismissTimer = setTimeout(() => dismiss('dismiss'), 18000);
  }

  els.printer.addEventListener('mouseenter', () => clearTimeout(autoDismissTimer));
  els.printer.addEventListener('mouseleave', () => {
    clearTimeout(autoDismissTimer);
    autoDismissTimer = setTimeout(() => dismiss('dismiss'), 9000);
  });

  els.closeBtn.addEventListener('click', () => dismiss('dismiss'));
  els.doneBtn.addEventListener('click', () => dismiss('done'));
  els.snoozeBtn.addEventListener('click', () => dismiss('snooze', { minutes: 10 }));
  els.openBtn.addEventListener('click', () => dismiss('open'));

  if (api && typeof api.onShow === 'function') {
    api.onShow((payload) => showAlert(payload));
  }
})();
