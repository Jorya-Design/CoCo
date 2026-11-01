import { createServer } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { authenticateWorker, type WorkerRegistry } from './worker-auth.ts';

export function createMachineServer(registry: () => Promise<WorkerRegistry>, recheckMs = 5000) {
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'GET' && req.url === '/healthz') {
      res.writeHead(200).end('ok'); return;
    }
    try {
      const identity = authenticateWorker(req.headers.authorization, await registry());
      if (req.method === 'GET' && req.url === '/worker/v1/identity') {
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ workerId: identity.workerId }));
      } else res.writeHead(404).end();
    } catch {
      res.writeHead(401, { 'WWW-Authenticate': 'Bearer' }).end();
    }
  });
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 16384 });
  const sessions = new Map<WebSocket, { header: string; alive: boolean }>();
  server.on('upgrade', async (req, socket, head) => {
    // Browsers and URL/query credentials are not a worker authentication surface.
    if (req.url !== '/worker/v1/connect' || req.headers.origin) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return;
    }
    try {
      const header = req.headers.authorization;
      const identity = authenticateWorker(header, await registry());
      if (socket.destroyed) return;
      sockets.handleUpgrade(req, socket, head, ws => {
        sessions.set(ws, { header: header!, alive: true });
        ws.on('error', () => ws.terminate());
        ws.on('pong', () => { const session = sessions.get(ws); if (session) session.alive = true; });
        ws.on('close', () => sessions.delete(ws));
        ws.send(JSON.stringify({ type: 'worker/authenticated', workerId: identity.workerId }));
        ws.on('message', () => {
          // Scheduling is deliberately not implemented here. Deny unknown commands.
          ws.close(1008, 'Unsupported worker command');
        });
      });
    } catch { socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n'); }
  });
  let checking = false;
  const timer = setInterval(async () => {
    if (checking) return;
    checking = true;
    try {
      const current = await registry();
      for (const [ws, session] of sessions) {
        try { authenticateWorker(session.header, current); }
        catch { ws.close(1008, 'Worker credential revoked or expired'); continue; }
        if (!session.alive) { ws.terminate(); continue; }
        session.alive = false; ws.ping();
      }
    } catch { for (const ws of sessions.keys()) ws.close(1011, 'Authentication unavailable'); }
    finally { checking = false; }
  }, recheckMs);
  timer.unref();
  server.on('close', () => { clearInterval(timer); sockets.close(); });
  return { server, close: async () => {
    clearInterval(timer);
    for (const ws of sessions.keys()) ws.terminate();
    sockets.close();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  } };
}
