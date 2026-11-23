'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const { TicketStore, formatDateKey, shiftDateKey } = require('../src/shared/store');
const { extractDateFromText, parseSmartInput } = require('../src/shared/date-parser');
const { startAiBridge } = require('../src/main/ai-bridge');

function makeTempStore(dateObj) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tickettab-test-'));
  const file = path.join(dir, 'data.json');
  let now = dateObj;
  const store = new TicketStore(file, () => now);
  return {
    store,
    file,
    dir,
    setNow(nextDate) {
      now = nextDate;
    },
    cleanup() {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };
}

test('formatDateKey and shiftDateKey handle date math cleanly', () => {
  const key = formatDateKey(new Date(2026, 10, 23));
  assert.equal(key, '2026-11-23');
  assert.equal(shiftDateKey('2026-11-23', -1), '2026-11-22');
  assert.equal(shiftDateKey('2026-11-30', 1), '2026-12-01');
});

test('natural language date parser handles Chinese, English, weekdays, and AI meeting notes', () => {
  // 2026-11-23 is Monday
  const base = new Date(2026, 10, 23, 10, 0, 0);

  assert.equal(extractDateFromText('明天 提交设计评审', base).dateKey, '2026-11-24');
  assert.equal(extractDateFromText('后天 客户演示', base).dateKey, '2026-11-25');
  assert.equal(extractDateFromText('下周三 季度复盘', base).dateKey, '2026-12-02');
  assert.equal(extractDateFromText('12月5日 合同归档', base).dateKey, '2026-12-05');

  const meetingNotes = `
今天：
- 确认最终视觉稿 !
- 输出知识库文档
明天：
- 对接测试环境
下周五：
- 上线发布复盘
  `;
  const parsed = parseSmartInput(meetingNotes, base);
  assert.equal(parsed.length, 4);
  assert.equal(parsed[0].dateKey, '2026-11-23');
  assert.equal(parsed[0].priority, 'urgent');
  assert.equal(parsed[2].dateKey, '2026-11-24');
  assert.equal(parsed[3].dateKey, '2026-12-04');

  // JSON code block from GPT / DeepSeek / Claude
  const aiJson = '```json\n[{"text":"准备分享PPT","date":"2026-11-26","priority":"urgent"}]\n```';
  const parsedJson = parseSmartInput(aiJson, base);
  assert.equal(parsedJson.length, 1);
  assert.equal(parsedJson[0].dateKey, '2026-11-26');
  assert.equal(parsedJson[0].priority, 'urgent');
});

test('add, multi-day scheduling, toggle, update, and thermal-fade clear persist to disk', () => {
  const ctx = makeTempStore(new Date(2026, 10, 23, 9, 0, 0));
  try {
    const t1 = ctx.store.addTask('完成桌面交互');
    const t2 = ctx.store.addTask('明天 打包客户端', 'urgent');
    assert.equal(t1.dateKey, '2026-11-23');
    assert.equal(t2.dateKey, '2026-11-24');
    assert.equal(t2.text, '打包客户端');

    ctx.store.toggleTask(t1.id);
    const snapToday = ctx.store.getSnapshot();
    assert.equal(snapToday.stats.allDone, true);
    assert.equal(snapToday.agenda[1].pending, 1); // tomorrow shows 1 pending

    const cleared = ctx.store.clearDone();
    assert.equal(cleared, 1);
    const snapAfter = ctx.store.getSnapshot();
    assert.equal(snapAfter.tasks.length, 0);
    assert.equal(snapAfter.stats.tornCount, 1);
    assert.equal(snapAfter.stats.weekCompleted, 1);
    assert.equal(snapAfter.stats.streak, 1);

    const reloaded = new TicketStore(ctx.file, () => new Date(2026, 10, 23, 18, 0, 0));
    const snapTomorrow = reloaded.getSnapshot('2026-11-24');
    assert.equal(snapTomorrow.tasks.length, 1);
    assert.equal(snapTomorrow.tasks[0].text, '打包客户端');
  } finally {
    ctx.cleanup();
  }
});

test('unfinished tasks carry over to next day with carriedFrom marker', () => {
  const ctx = makeTempStore(new Date(2026, 10, 22, 10, 0, 0));
  try {
    const doneYesterday = ctx.store.addTask('昨日已完成');
    ctx.store.addTask('昨日未完成');
    ctx.store.toggleTask(doneYesterday.id);

    ctx.setNow(new Date(2026, 10, 23, 9, 0, 0));
    const snap = ctx.store.getSnapshot();
    assert.equal(snap.today, '2026-11-23');
    assert.equal(snap.tasks.length, 1);
    assert.equal(snap.tasks[0].text, '昨日未完成');
    assert.equal(snap.tasks[0].carriedFrom, '2026-11-22');
    assert.equal(snap.stats.streak, 1);

    ctx.store.addTask('今天的新任务');
    const snapMixed = ctx.store.getSnapshot();
    assert.equal(snapMixed.tasks[0].carriedFrom, '2026-11-22');
    assert.equal(snapMixed.tasks[1].carriedFrom, null);
  } finally {
    ctx.cleanup();
  }
});

test('AI HTTP bridge accepts meeting notes and syncs live to store', async () => {
  const ctx = makeTempStore(new Date(2026, 10, 23, 11, 0, 0));
  let notified = 0;
  const { server, port } = await startAiBridge(ctx.store, () => { notified += 1; }, 0);
  try {
    const postRes = await new Promise((resolve, reject) => {
      const body = JSON.stringify({ text: '今天 回复投资人邮件 !\n后天 整理周报' });
      const req = http.request({
        hostname: '127.0.0.1',
        port,
        path: '/import',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
      }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))));
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });

    assert.equal(postRes.ok, true);
    assert.equal(postRes.addedCount, 2);
    assert.equal(notified, 1);
    assert.equal(ctx.store.getSnapshot('2026-11-23').tasks.length, 1);
    assert.equal(ctx.store.getSnapshot('2026-11-25').tasks.length, 1);
  } finally {
    server.close();
    ctx.cleanup();
  }
});

test('personalization settings validate theme, tabStyle, hoverOpen, autoFadeDone, launchAtLogin', () => {
  const ctx = makeTempStore(new Date(2026, 10, 23));
  try {
    const next = ctx.store.updateSettings({
      theme: 'matcha',
      tabStyle: 'mascot',
      hoverOpen: true,
      autoFadeDone: false,
      launchAtLogin: true,
      edge: 'left'
    });
    assert.equal(next.theme, 'matcha');
    assert.equal(next.tabStyle, 'mascot');
    assert.equal(next.hoverOpen, true);
    assert.equal(next.autoFadeDone, false);
    assert.equal(next.launchAtLogin, true);
    assert.equal(next.edge, 'left');

    const bad = ctx.store.updateSettings({ theme: 'invalid-theme', tabStyle: 'unknown' });
    assert.equal(bad.theme, 'matcha');
    assert.equal(bad.tabStyle, 'mascot');
  } finally {
    ctx.cleanup();
  }
});
