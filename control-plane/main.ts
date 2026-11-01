import { loadRegistry } from './worker-auth.ts';
import { createMachineServer } from './machine-server.ts';
import { createHealthPublisher } from './runtime-health.ts';
import { readFile } from 'node:fs/promises';
import { PlanAgent } from './plan-agent.ts';
import { Scheduler } from './scheduler.ts';
import { createInferenceProxy } from './inference-proxy.ts';

const registryFile = process.env.COCO_WORKER_REGISTRY_FILE;
if (!registryFile) throw new Error('COCO_WORKER_REGISTRY_FILE is required');
await loadRegistry(registryFile); // Fail startup closed on invalid configuration.
const registry = () => loadRegistry(registryFile);
const project = process.env.COCO_FIREBASE_PROJECT;
const health = project ? createHealthPublisher(project, process.env.COCO_HOST_NAME ?? 'linux-worker') : null;
const execute = process.env.COCO_EXECUTION_ENABLED === 'true';
if (execute && !project) throw new Error('Execution requires Firebase');
const scheduler = execute ? new Scheduler(process.env.COCO_REPOSITORY_SHA ?? '') : null;
const plans = execute ? new PlanAgent(process.env.COCO_REPOSITORY_SHA ?? '') : null;
const apiKey = execute ? (await readFile(process.env.COCO_OPENAI_KEY_FILE ?? '', 'utf8')).trim() : '';
if (execute && !apiKey) throw new Error('Inference credentials required');
const proxy = execute ? createInferenceProxy(apiKey,registry) : null;
const grants = new Map<string,{attemptId:string;token:string}>();
const service = createMachineServer(registry,5000,scheduler && proxy ? {
  command: async (identity, command) => {
    if (command.type === 'worker/poll') {
      const job = await plans!.claim(identity) ?? await scheduler.claim(identity);
      if (!job) return {type:'worker/idle'};
      const token = proxy.issue(identity);
      grants.set(identity.workerId,{attemptId:job.attemptId,token});
      return {type:'worker/job',job:{...job,inferenceToken:token}};
    }
    const grant = grants.get(identity.workerId);
    const accepted = await (await plans!.owns(identity.workerId) ? plans! : scheduler).report(identity,command);
    if (grant?.attemptId === command.attemptId) {
      if (command.type!=='worker/result' && accepted) proxy.renew(grant.token);
      else { proxy.revoke(grant.token); grants.delete(identity.workerId); }
    }
    return {type:'worker/ack',attemptId:command.attemptId,active:accepted};
  },
  disconnected: workerId => { const grant=grants.get(workerId); if(grant)proxy.revoke(grant.token); grants.delete(workerId); },
} : undefined);
// Reachable only from the dedicated Docker bridge; no public firewall ingress.
proxy?.server.listen(8790,'172.30.0.1');
const port = Number(process.env.PORT ?? 8787);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
// Private listener. Use HTTPS/WSS termination or a private tunnel for remote workers.
service.server.listen(port, '127.0.0.1', () => console.log(`CoCo machine gateway listening on 127.0.0.1:${port}`));
let publishing = false;
async function publish() {
  if (!health || publishing) return;
  publishing = true;
  try { await health.publish(service.connectedWorkers(), execute); }
  catch { console.error('Cannot publish worker health to Firebase'); }
  finally { publishing = false; }
}
void publish();
const decisions = setInterval(()=>void plans?.processDecisions().catch(()=>console.error('Cannot process plan decisions')),3000);
const heartbeat = setInterval(() => void publish(), 30000);
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => {
  clearInterval(heartbeat);clearInterval(decisions);
  void service.close().then(async () => {
    proxy?.server.close();
    await health?.publish([], false).catch(() => {});
    await health?.close();
    process.exit(0);
  });
});
