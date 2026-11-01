import { createServer } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { authenticateWorker, type WorkerIdentity, type WorkerRegistry } from './worker-auth.ts';
import { workerCommandSchema, type WorkerCommand } from '../shared/execution.ts';

export interface MachineCommands {
  command(identity: WorkerIdentity, command: WorkerCommand): Promise<unknown>;
  disconnected?(workerId: string): void;
}

export function createMachineServer(registry: () => Promise<WorkerRegistry>, recheckMs = 5000, commands?: MachineCommands) {
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
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 65536 });
  const sessions = new Map<WebSocket, { header: string; alive: boolean; workerId: string }>();
  server.on('upgrade', async (req, socket, head) => {
    // Browsers and URL/query credentials are not a worker authentication surface.
    if (req.url !== '/worker/v1/connect' || req.headers.origin) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return;
    }
    try {
      const header = req.headers.authorization;
      const identity = authenticateWorker(header, await registry());
      if (socket.destroyed) return;
      if ([...sessions].some(([ws,session])=>ws.readyState===ws.OPEN && session.workerId===identity.workerId)) {
        socket.end('HTTP/1.1 409 Conflict\r\nConnection: close\r\n\r\n'); return;
      }
      sockets.handleUpgrade(req, socket, head, ws => {
        sessions.set(ws, { header: header!, alive: true, workerId: identity.workerId });
        ws.on('error', () => ws.terminate());
        ws.on('pong', () => { const session = sessions.get(ws); if (session) session.alive = true; });
        ws.on('close', () => { sessions.delete(ws); commands?.disconnected?.(identity.workerId); });
        ws.send(JSON.stringify({ type: 'worker/authenticated', workerId: identity.workerId }));
        let busy = false;
        ws.on('message', async data => {
          if (!commands || busy) { ws.close(1008, 'Unsupported worker command'); return; }
          busy = true;
          try {
            const current = authenticateWorker(header, await registry());
            const command = workerCommandSchema.parse(JSON.parse(data.toString()));
            const response = await commands.command(current, command);
            if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(response));
          } catch { ws.close(1008, 'Worker command refused'); }
          finally { busy = false; }
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
        try { session.workerId = authenticateWorker(session.header, current).workerId; }
        catch { ws.close(1008, 'Worker credential revoked or expired'); continue; }
        if (!session.alive) { ws.terminate(); continue; }
        session.alive = false; ws.ping();
      }
    } catch { for (const ws of sessions.keys()) ws.close(1011, 'Authentication unavailable'); }
    finally { checking = false; }
  }, recheckMs);
  timer.unref();
  server.on('close', () => { clearInterval(timer); sockets.close(); });
  return { server, connectedWorkers: () => [...new Set([...sessions]
    .filter(([ws]) => ws.readyState === ws.OPEN).map(([, session]) => session.workerId))].sort(), close: async () => {
    clearInterval(timer);
    for (const ws of sessions.keys()) ws.terminate();
    sockets.close();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  } };
}
