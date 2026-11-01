import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { hashToken, parseRegistry } from '../control-plane/worker-auth.ts';

const token = process.env.COCO_WORKER_TOKEN ?? '';
const id = process.env.COCO_WORKER_ID ?? 'worker-1';
const output = process.env.COCO_CREDENTIAL_OUTPUT ?? '.coco/credentials';
const expiresAt = Date.parse(process.env.COCO_WORKER_TOKEN_EXPIRES_AT ?? '');
if (!/^[A-Za-z0-9_-]{43}$/.test(token) || !Number.isFinite(expiresAt) || expiresAt <= Date.now())
  throw new Error('A 32-byte base64url worker token and future expiry are required');
const registry = parseRegistry({ workers: [{ id, tokens: [{ sha256: hashToken(token), expiresAt }] }] });
await mkdir(output, { recursive: true, mode: 0o700 });
await writeFile(join(output, 'worker-token'), token + '\n', { mode: 0o600 });
await writeFile(join(output, 'worker-registry.json'), JSON.stringify(registry) + '\n', { mode: 0o600 });
console.log('Prepared matching worker credential and control-plane verifier (values redacted)');
