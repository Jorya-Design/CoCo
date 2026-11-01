import { loadRegistry } from './worker-auth.ts';
import { createMachineServer } from './machine-server.ts';

const registryFile = process.env.COCO_WORKER_REGISTRY_FILE;
if (!registryFile) throw new Error('COCO_WORKER_REGISTRY_FILE is required');
await loadRegistry(registryFile); // Fail startup closed on invalid configuration.
const service = createMachineServer(() => loadRegistry(registryFile));
const port = Number(process.env.PORT ?? 8787);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
// Private listener. Use HTTPS/WSS termination or a private tunnel for remote workers.
service.server.listen(port, '127.0.0.1', () => console.log(`CoCo machine gateway listening on 127.0.0.1:${port}`));
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => void service.close().then(() => process.exit(0)));
