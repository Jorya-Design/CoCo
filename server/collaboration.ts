import * as Y from 'yjs';
import { WebSocket, WebSocketServer } from 'ws';
import { parse } from 'cookie';
import type { Server } from 'node:http';
import type { Store } from './store.ts';
import { makePlan } from '../shared/plan.ts';
import type { Presence } from '../shared/types.ts';

export function collaboration(server: Server, store: Store) {
  const docs = new Map<string, Y.Doc>();
  const connections = new Map<string, Map<WebSocket, Presence>>();
  const send = (ws: WebSocket, data: unknown) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data)); };
  const broadcast = (id: string, data: unknown, except?: WebSocket) => connections.get(id)?.forEach((_, ws) => { if (ws !== except) send(ws, data); });
  const getDoc = (id: string) => {
    let doc = docs.get(id);
    if (doc) return doc;
    doc = new Y.Doc();
    const saved = store.doc(id);
    if (saved) Y.applyUpdate(doc, saved);
    else {
      const room = store.room(id)!;
      doc.getText('plan').insert(0, makePlan(room.title));
    }
    docs.set(id, doc);
    doc.on('update', (update: Uint8Array, origin: WebSocket | undefined) => {
      store.saveDoc(id, Y.encodeStateAsUpdate(doc!));
      broadcast(id, { type: 'update', update: Buffer.from(update).toString('base64') }, origin);
    });
    store.saveDoc(id, Y.encodeStateAsUpdate(doc));
    return doc;
  };
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url || '/', 'http://localhost');
    const id = url.pathname.match(/^\/sync\/([a-z0-9-]+)$/)?.[1];
    const token = parse(req.headers.cookie || '').coco_session;
    const user = store.user(token);
    // The Vite proxy retains the external host header.
    const origin = req.headers.origin;
    if (!id || !user || !store.isMember(id, user.id) || (origin && new URL(origin).host !== req.headers.host)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy(); return;
    }
    wss.handleUpgrade(req, socket, head, ws => {
      const doc = getDoc(id), peers = connections.get(id) || new Map();
      connections.set(id, peers);
      const color = ['#7960e8', '#329e88', '#d38a36', '#5788d9'][parseInt(user.id.slice(0, 2), 16) % 4];
      peers.set(ws, { id: user.id, name: user.name, color });
      const presence = () => broadcast(id, { type: 'presence', peers: [...peers.values()] });
      send(ws, { type: 'update', update: Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64') });
      send(ws, { type: 'state', state: { ...store.room(id), workers: store.workers() } });
      presence();
      let messages = 0;
      const rate = setInterval(() => { messages = 0; if (ws.readyState === WebSocket.OPEN) ws.ping(); }, 10000);
      rate.unref();
      ws.on('message', raw => {
        if (++messages > 500 || !store.user(token)) { ws.close(1008, 'Session expired or rate exceeded'); return; }
        try {
          const data = JSON.parse(raw.toString());
          if (data.type === 'update' && typeof data.update === 'string') {
            Y.applyUpdate(doc, Buffer.from(data.update, 'base64'), ws);
          } else if (data.type === 'cursor' && Number.isSafeInteger(data.cursor)) {
            peers.set(ws, { ...peers.get(ws)!, cursor: data.cursor }); presence();
          }
        } catch { ws.close(1003, 'Invalid collaboration message'); }
      });
      ws.on('close', () => { clearInterval(rate); peers.delete(ws); presence(); });
      ws.on('error', () => ws.close());
    });
  });
  return { getDoc, broadcast, state(id: string) { broadcast(id, { type: 'state', state: { ...store.room(id), workers: store.workers() } }); } };
}
