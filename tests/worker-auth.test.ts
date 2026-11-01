import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import WebSocket from 'ws';
import { authenticateWorker, authorizeWorkerRun, hashToken, parseRegistry, type RunLease } from '../control-plane/worker-auth.ts';
import { createMachineServer } from '../control-plane/machine-server.ts';

const token = randomBytes(32).toString('base64url');
const replacement = randomBytes(32).toString('base64url');
const expiresAt = Date.now() + 60000;
const registry = () => parseRegistry({ workers: [{ id: 'worker-1', tokens: [{ sha256: hashToken(token), expiresAt }] }] });

test('machine credentials reject missing, malformed, wrong, expired and disabled identities', () => {
  for (const header of [undefined, '', `Basic ${token}`, `Bearer ${token} extra`, `Bearer ${replacement}`])
    assert.throws(() => authenticateWorker(header, registry()));
  assert.equal(authenticateWorker(`Bearer ${token}`, registry()).workerId, 'worker-1');
  assert.throws(() => authenticateWorker(`Bearer ${token}`, registry(), expiresAt));
  const disabled = registry(); disabled.workers[0].disabled = true;
  assert.throws(() => authenticateWorker(`Bearer ${token}`, disabled));
  assert.throws(() => parseRegistry({ workers: [registry().workers[0], registry().workers[0]] }));
});

test('rotation accepts an overlap, then rejects the removed credential', () => {
  const overlap = registry();
  overlap.workers[0].tokens.push({ sha256: hashToken(replacement), expiresAt });
  for (const value of [token, replacement]) assert.equal(authenticateWorker(`Bearer ${value}`, overlap).workerId, 'worker-1');
  overlap.workers[0].tokens.shift();
  assert.throws(() => authenticateWorker(`Bearer ${token}`, overlap));
  assert.equal(authenticateWorker(`Bearer ${replacement}`, overlap).workerId, 'worker-1');
});

test('assigned-run authorization rejects cross-worker access, wrong resources and stale fences', () => {
  const identity = authenticateWorker(`Bearer ${token}`, registry());
  const request = { roomId: 'room', runId: 'run', attemptId: 'attempt', fence: 2 };
  const lease: RunLease = { ...request, workerId: 'worker-1', expiresAt, status: 'active' };
  authorizeWorkerRun(identity, request, lease);
  for (const override of [{ workerId: 'other' }, { roomId: 'other' }, { runId: 'other' },
    { attemptId: 'old' }, { fence: 1 }, { expiresAt: 1 }, { status: 'cancelled' as const }])
    assert.throws(() => authorizeWorkerRun(identity, request, { ...lease, ...override }));
  assert.throws(() => authorizeWorkerRun(identity, request, null));
});

test('HTTP gateway authenticates identities and fails closed on registry failure', { timeout: 5000 }, async () => {
  let broken = false;
  const service = createMachineServer(async () => { if (broken) throw new Error('unavailable'); return registry(); });
  service.server.listen(0, '127.0.0.1'); await once(service.server, 'listening');
  const base = `http://127.0.0.1:${(service.server.address() as AddressInfo).port}`;
  try {
    assert.equal((await fetch(`${base}/worker/v1/identity?token=${token}`)).status, 401);
    const response = await fetch(`${base}/worker/v1/identity`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(response.status, 200); assert.deepEqual(await response.json(), { workerId: 'worker-1' });
    broken = true;
    assert.equal((await fetch(`${base}/worker/v1/identity`, { headers: { Authorization: `Bearer ${token}` } })).status, 401);
  } finally { await service.close(); }
});

test('WebSocket authenticates during upgrade and revocation closes existing connections', { timeout: 5000 }, async () => {
  let current = registry();
  const service = createMachineServer(async () => current, 50);
  service.server.listen(0, '127.0.0.1'); await once(service.server, 'listening');
  const base = `ws://127.0.0.1:${(service.server.address() as AddressInfo).port}/worker/v1/connect`;
  try {
    const rejected = new WebSocket(base, { headers: { Authorization: `Bearer ${replacement}` } });
    rejected.on('error', () => {});
    const denied = await once(rejected, 'unexpected-response');
    assert.equal(denied[1].statusCode, 401); denied[1].resume(); rejected.terminate();
    const ws = new WebSocket(base, { headers: { Authorization: `Bearer ${token}` } });
    const message = await once(ws, 'message');
    assert.deepEqual(JSON.parse(message[0].toString()), { type: 'worker/authenticated', workerId: 'worker-1' });
    current = parseRegistry({ workers: [] });
    const [code] = await once(ws, 'close'); assert.equal(code, 1008);
  } finally { await service.close(); }
});

test('deployment derives its verifier from the worker secret and refuses expired configuration', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'coco-worker-credentials-'));
  t.after(async () => {
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + '\\') || resolve(directory).startsWith(resolve(tmpdir()) + '/'));
    await rm(directory, { recursive: true, force: true });
  });
  const env = { ...process.env, COCO_CREDENTIAL_OUTPUT: directory, COCO_WORKER_ID: 'worker-1',
    COCO_WORKER_TOKEN: token, COCO_WORKER_TOKEN_EXPIRES_AT: new Date(expiresAt).toISOString() };
  const provision = () => spawnSync(process.execPath, ['--import', 'tsx', 'scripts/prepare-worker-credentials.ts'], { env, encoding: 'utf8' });
  const result = provision(); assert.equal(result.status, 0, result.stderr);
  assert.ok(!result.stdout.includes(token));
  const deployedToken = (await readFile(join(directory, 'worker-token'), 'utf8')).trim();
  const deployedRegistry = parseRegistry(JSON.parse(await readFile(join(directory, 'worker-registry.json'), 'utf8')));
  assert.equal(authenticateWorker(`Bearer ${deployedToken}`, deployedRegistry).workerId, 'worker-1');
  env.COCO_WORKER_TOKEN_EXPIRES_AT = '2020-01-01T00:00:00Z';
  assert.notEqual(provision().status, 0);
});
