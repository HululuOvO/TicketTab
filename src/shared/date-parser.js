'use strict';

/**
 * Zero-dependency natural-language date & AI task batch parser.
 * Understands Chinese & English date phrases AND structured AI outputs:
 *   - 今天 / 今日 / today
 *   - 明天 / 明日 / tomorrow
 *   - 后天 / 大后天
 *   - 本周X / 周X / 星期X / 下周X / 下星期X
 *   - X月X日 / X月X号 / YYYY-MM-DD / MM-DD / MM.DD
 *   - Multi-line bullet / markdown checklist / JSON array from GPT / Claude / Gemini / DeepSeek / Qwen / Kimi / WorkBuddy
 */

function pad2(n) {
  return String(n).padStart(2, '0');
}

function formatDateKey(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function shiftDate(baseDate, days) {
  const dt = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate() + days);
  return formatDateKey(dt);
}

const WEEKDAY_MAP = {
  '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 0, '天': 0,
  '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 0
};

function resolveWeekday(baseDate, targetDow, forceNextWeek) {
  const currentDow = baseDate.getDay(); // 0=Sun..6=Sat
  const curMonIdx = currentDow === 0 ? 7 : currentDow; // 1..7
  const targetMonIdx = targetDow === 0 ? 7 : targetDow; // 1..7

  let delta = targetMonIdx - curMonIdx;
  if (forceNextWeek) {
    delta += 7;
  } else if (delta < 0) {
    delta += 7;
  }
  return shiftDate(baseDate, delta);
}

function extractDateFromText(rawText, baseDate = new Date()) {
  const text = String(rawText || '').trim();
  if (!text) return { dateKey: formatDateKey(baseDate), cleanedText: '', explicit: false };

  let dateKey = formatDateKey(baseDate);
  let explicit = false;
  let cleaned = text;

  const stripMatch = (matchStr) => {
    cleaned = cleaned.replace(matchStr, ' ').replace(/^[\s:：,\-—·]+/, '').replace(/\s{2,}/g, ' ').trim();
  };

  // 1. Explicit YYYY-MM-DD or YYYY/MM/DD or YYYY.MM.DD
  let m = cleaned.match(/(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) {
    const dt = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    dateKey = formatDateKey(dt);
    explicit = true;
    stripMatch(m[0]);
    return { dateKey, cleanedText: cleaned || text, explicit };
  }

  // 2. Chinese X月X日 / X月X号
  m = cleaned.match(/(\d{1,2})月(\d{1,2})[日号]?/);
  if (m) {
    const month = Number(m[1]);
    const day = Number(m[2]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      let year = baseDate.getFullYear();
      let candidate = new Date(year, month - 1, day);
      // If more than 60 days in the past, assume next year
      if (candidate.getTime() < baseDate.getTime() - 60 * 86400000) {
        candidate = new Date(year + 1, month - 1, day);
      }
      dateKey = formatDateKey(candidate);
      explicit = true;
      stripMatch(m[0]);
      return { dateKey, cleanedText: cleaned || text, explicit };
    }
  }

  // 3. Relative Chinese/English day keywords
  if (/大后天/.test(cleaned)) {
    dateKey = shiftDate(baseDate, 3);
    explicit = true;
    stripMatch('大后天');
    return { dateKey, cleanedText: cleaned || text, explicit };
  }
  if (/后天/.test(cleaned)) {
    dateKey = shiftDate(baseDate, 2);
    explicit = true;
    stripMatch('后天');
    return { dateKey, cleanedText: cleaned || text, explicit };
  }
  m = cleaned.match(/(明天|明日|\btomorrow\b)/i);
  if (m) {
    dateKey = shiftDate(baseDate, 1);
    explicit = true;
    stripMatch(m[0]);
    return { dateKey, cleanedText: cleaned || text, explicit };
  }
  m = cleaned.match(/(今天|今日|\btoday\b)/i);
  if (m) {
    dateKey = formatDateKey(baseDate);
    explicit = true;
    stripMatch(m[0]);
    return { dateKey, cleanedText: cleaned || text, explicit };
  }

  // 4. Next week / This week weekday (下周三 / 下星期五 / 本周四 / 周二)
  m = cleaned.match(/(下下?周|下星期|本周|这周|周|星期)([一二三四五六日天1-7])/);
  if (m) {
    const prefix = m[1];
    const dow = WEEKDAY_MAP[m[2]];
    if (dow !== undefined) {
      const isNext = prefix === '下周' || prefix === '下星期';
      const isNextNext = prefix === '下下周';
      let resolved = resolveWeekday(baseDate, dow, isNext || isNextNext);
      if (isNextNext) {
        const [y, mo, d] = resolved.split('-').map(Number);
        resolved = shiftDate(new Date(y, mo - 1, d), 7);
      }
      dateKey = resolved;
      explicit = true;
      stripMatch(m[0]);
      return { dateKey, cleanedText: cleaned || text, explicit };
    }
  }

  // 5. Generic "下周" without weekday -> next Monday
  if (/下周|下星期|\bnext\s+week\b/i.test(cleaned)) {
    const nextMon = resolveWeekday(baseDate, 1, true);
    dateKey = nextMon;
    explicit = true;
    stripMatch(cleaned.match(/下周|下星期|\bnext\s+week\b/i)[0]);
    return { dateKey, cleanedText: cleaned || text, explicit };
  }

  // 6. Prefix short date like "11.25 " or "11/25 "
  m = cleaned.match(/^(\d{1,2})[./-](\d{1,2})\b/);
  if (m) {
    const month = Number(m[1]);
    const day = Number(m[2]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const candidate = new Date(baseDate.getFullYear(), month - 1, day);
      dateKey = formatDateKey(candidate);
      explicit = true;
      stripMatch(m[0]);
      return { dateKey, cleanedText: cleaned || text, explicit };
    }
  }

  return { dateKey, cleanedText: text, explicit: false };
}

function extractTimeAndRepeat(text) {
  let cleaned = String(text || '').trim();
  let time = null;
  let repeat = 'none'; // 'none' | 'daily' | 'weekdays' | 'weekly' | 'monthly'

  // 1. Repeat keywords
  if (/每天|每日|\bevery\s*day\b|\bdaily\b/i.test(cleaned)) {
    repeat = 'daily';
    cleaned = cleaned.replace(/每天|每日|\bevery\s*day\b|\bdaily\b/ig, ' ').trim();
  } else if (/每个?工作日|\bweekdays?\b/i.test(cleaned)) {
    repeat = 'weekdays';
    cleaned = cleaned.replace(/每个?工作日|\bweekdays?\b/ig, ' ').trim();
  } else if (/每周|每星期|\bweekly\b|\bevery\s+week\b/i.test(cleaned)) {
    repeat = 'weekly';
    // Keep weekday word for date extraction by replacing only the "每" prefix if followed by 周X
    if (/每(周|星期)[一二三四五六日天1-7]/.test(cleaned)) {
      cleaned = cleaned.replace(/每(?=(周|星期)[一二三四五六日天1-7])/, '').trim();
    } else {
      cleaned = cleaned.replace(/每周|每星期|\bweekly\b|\bevery\s+week\b/ig, ' ').trim();
    }
  } else if (/每月|\bmonthly\b|\bevery\s+month\b/i.test(cleaned)) {
    repeat = 'monthly';
    cleaned = cleaned.replace(/每月|\bmonthly\b|\bevery\s+month\b/ig, ' ').trim();
  }

  // 2. Time patterns: "14:30", "下午3点半", "上午9点", "晚上8点15", "9:00"
  let m = cleaned.match(/(上午|早上|清晨|中午|下午|傍晚|晚上)?\s*(\d{1,2})\s*[:：]\s*(\d{2})/);
  if (m) {
    let h = Number(m[2]);
    const min = Number(m[3]);
    const period = m[1] || '';
    if ((period === '下午' || period === '傍晚' || period === '晚上') && h < 12) h += 12;
    if (period === '中午' && h < 11) h += 12;
    if (h >= 0 && h <= 23 && min >= 0 && min <= 59) {
      time = `${pad2(h)}:${pad2(min)}`;
      cleaned = cleaned.replace(m[0], ' ').replace(/\s{2,}/g, ' ').trim();
    }
  } else {
    m = cleaned.match(/(上午|早上|清晨|中午|下午|傍晚|晚上)?\s*(\d{1,2})\s*点(半|(\d{1,2})分?)?/);
    if (m) {
      let h = Number(m[2]);
      let min = 0;
      if (m[3] === '半') min = 30;
      else if (m[4]) min = Number(m[4]);
      const period = m[1] || '';
      if ((period === '下午' || period === '傍晚' || period === '晚上') && h < 12) h += 12;
      if (period === '中午' && h < 11) h += 12;
      if (h >= 0 && h <= 23 && min >= 0 && min <= 59) {
        time = `${pad2(h)}:${pad2(min)}`;
        cleaned = cleaned.replace(m[0], ' ').replace(/\s{2,}/g, ' ').trim();
      }
    }
  }

  return { time, repeat, cleanedText: cleaned };
}

function detectPriority(text) {
  const urgentRe = /(!{1,2}$|\[!\]|【紧急】|【重要】|紧急|加急|优先|\bP0\b|\bURGENT\b|🔴|🔥)/i;
  if (urgentRe.test(text)) {
    const clean = text.replace(urgentRe, '').trim();
    return { priority: 'urgent', text: clean || text };
  }
  return { priority: 'normal', text };
}

/**
 * Parse arbitrary AI output (JSON block, Markdown list, meeting notes, or plain lines)
 * into structured [{ text, dateKey, priority }].
 */
function parseSmartInput(raw, baseDate = new Date(), defaultDateKey = null) {
  const fallbackDate = defaultDateKey || formatDateKey(baseDate);
  if (!raw) return [];

  // If already an array of objects (from HTTP API or MCP)
  if (Array.isArray(raw)) {
    return raw
      .map((item) => {
        if (typeof item === 'string') {
          const parsed = parseSmartInput(item, baseDate, fallbackDate);
          return parsed[0] || null;
        }
        if (!item || typeof item !== 'object') return null;
        const rawText = String(item.text || item.title || item.task || '').trim();
        if (!rawText) return null;
        const explicitDate = typeof item.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item.date)
          ? item.date
          : null;
        const extracted = explicitDate
          ? { dateKey: explicitDate, cleanedText: rawText, explicit: true }
          : extractDateFromText(rawText, baseDate);
        const tr = extractTimeAndRepeat(extracted.cleanedText);
        const dateKey = explicitDate || (extracted.explicit ? extracted.dateKey : fallbackDate);
        const pri = item.priority === 'urgent'
          ? { priority: 'urgent', text: tr.cleanedText }
          : detectPriority(tr.cleanedText);
        const time = typeof item.time === 'string' && /^\d{2}:\d{2}$/.test(item.time) ? item.time : tr.time;
        const repeat = ['daily', 'weekdays', 'weekly', 'monthly'].includes(item.repeat) ? item.repeat : tr.repeat;
        return {
          text: (pri.text || rawText).slice(0, 140),
          dateKey,
          priority: pri.priority,
          reminder: time ? { enabled: true, time, repeat, preAlerts: 1, preIntervalMin: 15 } : (repeat !== 'none' ? { enabled: false, time: '09:00', repeat, preAlerts: 0, preIntervalMin: 15 } : null)
        };
      })
      .filter(Boolean);
  }

  const input = String(raw).trim();
  if (!input) return [];

  // Try extracting JSON code fence or raw JSON array/object
  const jsonFence = input.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const jsonCandidate = jsonFence ? jsonFence[1].trim() : input;
  if (jsonCandidate.startsWith('[') || jsonCandidate.startsWith('{')) {
    try {
      const parsed = JSON.parse(jsonCandidate);
      const list = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.tasks) ? parsed.tasks : [parsed]);
      const items = parseSmartInput(list, baseDate, fallbackDate);
      if (items.length > 0) return items;
    } catch {
      // Fall through to line-by-line natural language parsing
    }
  }

  // Line-by-line parser supporting section date headers (e.g., "明天：" / "## 2026-11-25")
  const lines = input.split(/\r?\n/);
  const results = [];
  let sectionDate = fallbackDate;

  for (const rawLine of lines) {
    let line = rawLine.trim();
    if (!line) continue;

    // Strip markdown heading or checkbox/bullet markers
    const isHeading = /^#{1,4}\s+/.test(line) || /[：:]$/.test(line);
    const cleanedHeading = line.replace(/^#{1,4}\s+/, '').replace(/[：:]$/, '').trim();

    if (isHeading && cleanedHeading.length <= 20) {
      const headDate = extractDateFromText(cleanedHeading, baseDate);
      if (headDate.explicit) {
        sectionDate = headDate.dateKey;
        continue;
      }
    }

    // Strip bullet/number/checkbox prefixes: "- [ ] ", "* ", "1. ", "• "
    line = line
      .replace(/^[-*•·]\s*(\[[ xX]\]\s*)?/, '')
      .replace(/^\d+[.、)\]]\s*/, '')
      .trim();

    if (!line || line.length < 2) continue;
    // Skip pure divider lines
    if (/^[-=_*]{3,}$/.test(line)) continue;

    const tr = extractTimeAndRepeat(line);
    const extracted = extractDateFromText(tr.cleanedText || line, baseDate);
    const finalDate = extracted.explicit ? extracted.dateKey : sectionDate;
    const pri = detectPriority(extracted.cleanedText);
    const finalText = pri.text.replace(/^[\s:：,\-—·]+/, '').trim();
    if (!finalText) continue;

    results.push({
      text: finalText.slice(0, 140),
      dateKey: finalDate,
      priority: pri.priority,
      reminder: tr.time
        ? { enabled: true, time: tr.time, repeat: tr.repeat, preAlerts: 1, preIntervalMin: 15 }
        : (tr.repeat !== 'none' ? { enabled: false, time: '09:00', repeat: tr.repeat, preAlerts: 0, preIntervalMin: 15 } : null)
    });
  }

  return results;
}

module.exports = {
  extractDateFromText,
  extractTimeAndRepeat,
  parseSmartInput,
  formatDateKey,
  shiftDate
};
