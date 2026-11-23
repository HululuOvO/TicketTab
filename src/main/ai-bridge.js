'use strict';

const http = require('node:http');

/**
 * Localhost-only universal AI Bridge HTTP Server (127.0.0.1:27319).
 * Any AI / Agent / CLI / Shortcut / WorkBuddy / Coze / Dify / curl / Python script
 * can read or push tasks straight onto the live TicketTab receipt board:
 *   GET  /health            -> status & active port
 *   GET  /tasks?date=YYYY-MM-DD -> current snapshot
 *   POST /tasks             -> { text, date?, priority? } OR { tasks: [...] }
 *   POST /import            -> { text: "<meeting notes / AI output / JSON>" }
 *   POST /tasks/:id/toggle  -> toggle done
 *   DELETE /tasks/:id       -> delete task
 */

function readJsonBody(req, limitBytes = 256 * 1024) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > limitBytes) {
        reject(new Error('Payload too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        // Also accept plain text body for super-simple AI/webhook pushes
        resolve({ text: raw });
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(body);
}

function startAiBridge(store, onMutate = () => {}, preferredPort = 27319) {
  const server = http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      });
      res.end();
      return;
    }

    const urlObj = new URL(req.url || '/', 'http://127.0.0.1');
    const pathname = urlObj.pathname;

    try {
      if (req.method === 'GET' && pathname === '/health') {
        const addr = server.address();
        return sendJson(res, 200, {
          ok: true,
          app: 'TicketTab',
          port: addr ? addr.port : preferredPort,
          today: store.todayKey()
        });
      }

      if (req.method === 'GET' && pathname === '/tasks') {
        const dateParam = urlObj.searchParams.get('date');
        return sendJson(res, 200, {
          ok: true,
          snapshot: store.getSnapshot(dateParam)
        });
      }

      if (req.method === 'POST' && pathname === '/import') {
        const body = await readJsonBody(req);
        const input = body.tasks || body.text || body.content || body.notes || '';
        const created = store.importFromText(input, {
          defaultDateKey: body.date || null,
          source: 'ai'
        });
        if (created.length > 0) {
          onMutate({ type: 'ai-import', count: created.length, firstDate: created[0].dateKey });
        }
        return sendJson(res, 200, {
          ok: true,
          addedCount: created.length,
          created,
          snapshot: store.getSnapshot(created[0] ? created[0].dateKey : null)
        });
      }

      if (req.method === 'POST' && pathname === '/tasks') {
        const body = await readJsonBody(req);
        if (Array.isArray(body.tasks) || Array.isArray(body)) {
          const created = store.importFromText(Array.isArray(body) ? body : body.tasks, { source: 'ai' });
          if (created.length > 0) {
            onMutate({ type: 'ai-import', count: created.length, firstDate: created[0].dateKey });
          }
          return sendJson(res, 200, { ok: true, addedCount: created.length, created });
        }

        const text = String(body.text || body.title || body.task || '').trim();
        if (!text) return sendJson(res, 400, { ok: false, error: 'Missing task text' });
        const created = store.addTask(text, body.priority === 'urgent' ? 'urgent' : 'normal', {
          dateKey: body.date || null,
          source: 'ai'
        });
        onMutate({ type: 'ai-add', count: 1, firstDate: created.dateKey });
        return sendJson(res, 200, { ok: true, created, snapshot: store.getSnapshot(created.dateKey) });
      }

      const toggleMatch = pathname.match(/^\/tasks\/([^/]+)\/toggle$/);
      if (req.method === 'POST' && toggleMatch) {
        const toggled = store.toggleTask(decodeURIComponent(toggleMatch[1]));
        if (!toggled) return sendJson(res, 404, { ok: false, error: 'Task not found' });
        onMutate({ type: 'ai-toggle' });
        return sendJson(res, 200, { ok: true, toggled });
      }

      const delMatch = pathname.match(/^\/tasks\/([^/]+)$/);
      if (req.method === 'DELETE' && delMatch) {
        const ok = store.deleteTask(decodeURIComponent(delMatch[1]));
        if (!ok) return sendJson(res, 404, { ok: false, error: 'Task not found' });
        onMutate({ type: 'ai-delete' });
        return sendJson(res, 200, { ok: true });
      }

      return sendJson(res, 404, { ok: false, error: 'Not found' });
    } catch (err) {
      return sendJson(res, 500, { ok: false, error: err.message });
    }
  });

  return new Promise((resolve) => {
    server.on('error', () => {
      // If default port is occupied, fall back to an ephemeral port gracefully
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        resolve({ server, port: addr ? addr.port : null });
      });
    });

    server.listen(preferredPort, '127.0.0.1', () => {
      const addr = server.address();
      resolve({ server, port: addr ? addr.port : preferredPort });
    });
  });
}

module.exports = { startAiBridge };
