#!/usr/bin/env node
'use strict';

/**
 * TicketTab Zero-Dependency MCP (Model Context Protocol) Server over stdio.
 * Works directly with Claude Desktop, Cursor, WorkBuddy, Windsurf, Cline, Cherry Studio,
 * DeepSeek Harness, and any MCP-compatible AI client!
 *
 * Strategy:
 *   1. If TicketTab desktop app is running (http://127.0.0.1:27319), pushes live so the UI animates immediately.
 *   2. If TicketTab is closed, falls back directly to reading/writing the local tickets.json file safely.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { TicketStore } = require('../src/shared/store');

const BRIDGE_PORT = Number(process.env.TICKETTAB_PORT || 27319);

function defaultDataPath() {
  if (process.env.TICKETTAB_DATA) return process.env.TICKETTAB_DATA;
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'ticket-tab', 'tickets.json');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'ticket-tab', 'tickets.json');
  }
  return path.join(os.homedir(), '.config', 'ticket-tab', 'tickets.json');
}

function callBridge(method, urlPath, bodyObj = null) {
  return new Promise((resolve) => {
    const body = bodyObj ? JSON.stringify(bodyObj) : null;
    const req = http.request({
      hostname: '127.0.0.1',
      port: BRIDGE_PORT,
      path: urlPath,
      method,
      timeout: 1200,
      headers: body
        ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
        : {}
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    if (body) req.write(body);
    req.end();
  });
}

function openFallbackStore() {
  return new TicketStore(defaultDataPath());
}

const TOOLS = [
  {
    name: 'tickettab_add_tasks',
    description: 'Add one or multiple tasks to the user\'s TicketTab desktop receipt board. Accepts meeting notes, bullet lists, or structured items with dates (today, tomorrow, next week, YYYY-MM-DD).',
    inputSchema: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'Raw task text, meeting notes, or bullet list (supports Chinese/English dates like 明天, 后天, 下周三, 11月28日).'
        },
        tasks: {
          type: 'array',
          description: 'Optional structured task array.',
          items: {
            type: 'object',
            properties: {
              text: { type: 'string' },
              date: { type: 'string', description: 'Optional YYYY-MM-DD' },
              priority: { type: 'string', enum: ['normal', 'urgent'] }
            },
            required: ['text']
          }
        }
      }
    }
  },
  {
    name: 'tickettab_list_tasks',
    description: 'Read tasks on the user\'s TicketTab desktop board for today or a specified date, plus upcoming schedule summary.',
    inputSchema: {
      type: 'object',
      properties: {
        date: {
          type: 'string',
          description: 'Optional date in YYYY-MM-DD format; defaults to today.'
        }
      }
    }
  },
  {
    name: 'tickettab_toggle_task',
    description: 'Toggle completion state (check/uncheck) of a task by its id.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' }
      },
      required: ['id']
    }
  }
];

async function executeTool(name, args = {}) {
  if (name === 'tickettab_add_tasks') {
    const payload = Array.isArray(args.tasks) && args.tasks.length
      ? { tasks: args.tasks }
      : { text: String(args.text || '') };
    const live = await callBridge('POST', '/import', payload);
    if (live && live.ok) return live;

    const store = openFallbackStore();
    const created = store.importFromText(payload.tasks || payload.text, { source: 'ai' });
    return { ok: true, mode: 'file-fallback', addedCount: created.length, created };
  }

  if (name === 'tickettab_list_tasks') {
    const q = args.date ? `?date=${encodeURIComponent(args.date)}` : '';
    const live = await callBridge('GET', `/tasks${q}`);
    if (live && live.ok) return live.snapshot;

    const store = openFallbackStore();
    return store.getSnapshot(args.date || null);
  }

  if (name === 'tickettab_toggle_task') {
    const id = String(args.id || '');
    const live = await callBridge('POST', `/tasks/${encodeURIComponent(id)}/toggle`);
    if (live && live.ok) return live;

    const store = openFallbackStore();
    const toggled = store.toggleTask(id);
    return { ok: Boolean(toggled), toggled };
  }

  throw new Error(`Unknown tool: ${name}`);
}

function sendRpc(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

async function handleMessage(msg) {
  if (!msg || typeof msg !== 'object') return;
  const { id, method, params } = msg;

  try {
    if (method === 'initialize') {
      return sendRpc({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'tickettab-mcp', version: '1.0.0' }
        }
      });
    }

    if (method === 'notifications/initialized') {
      return;
    }

    if (method === 'tools/list') {
      return sendRpc({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
    }

    if (method === 'tools/call') {
      const toolName = params && params.name;
      const toolArgs = (params && params.arguments) || {};
      const data = await executeTool(toolName, toolArgs);
      return sendRpc({
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: JSON.stringify(data, null, 2) }]
        }
      });
    }

    if (id !== undefined) {
      sendRpc({
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Method not found: ${method}` }
      });
    }
  } catch (err) {
    if (id !== undefined) {
      sendRpc({
        jsonrpc: '2.0',
        id,
        error: { code: -32000, message: err.message }
      });
    }
  }
}

// NDJSON stdio transport (standard MCP stdio framing)
let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let newlineIdx;
  while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, newlineIdx).trim();
    buffer = buffer.slice(newlineIdx + 1);
    if (!line) continue;
    try {
      handleMessage(JSON.parse(line));
    } catch {
      // ignore malformed input line
    }
  }
});
