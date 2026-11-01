import { readFile } from 'node:fs/promises';
import WebSocket from 'ws';

const endpoint = new URL(process.env.COCO_CONTROL_PLANE_URL ?? '');
const tokenFile = process.env.COCO_WORKER_TOKEN_FILE;
if (!tokenFile) throw new Error('COCO_WORKER_TOKEN_FILE is required');
if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash)
  throw new Error('Credentials and query parameters are not allowed in the worker URL');
const local = ['127.0.0.1', '[::1]'].includes(endpoint.hostname);
if (endpoint.protocol !== 'wss:' && !(local && endpoint.protocol === 'ws:'))
  throw new Error('Remote worker connections require wss://');
endpoint.pathname = '/worker/v1/connect';
let stopping = false;
let socket: WebSocket | undefined;
let failures = 0;
function stop() { stopping = true; socket?.terminate(); }
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
while (!stopping) {
  try {
    const token = (await readFile(tokenFile, 'utf8')).trim();
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error('Invalid credential file');
    await new Promise<void>(resolve => {
      socket = new WebSocket(endpoint, { headers: { Authorization: `Bearer ${token}` }, handshakeTimeout: 10000 });
      socket.on('message', data => {
        try {
          const message = JSON.parse(data.toString());
          if (message.type === 'worker/authenticated') {
            failures = 0;
            console.log('Worker authenticated');
          }
        } catch { socket?.close(1008, 'Invalid control-plane message'); }
      });
      socket.on('error', () => {}); // Never log headers, token, or server-provided error text.
      socket.on('close', () => resolve());
    });
  } catch { console.error('Worker authentication connection unavailable'); }
  if (!stopping) await new Promise(resolve => setTimeout(resolve, Math.min(30000, 1000 * 2 ** Math.min(failures++, 5)) + Math.random() * 500));
}
