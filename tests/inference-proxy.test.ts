import assert from 'node:assert/strict';
import { test } from 'node:test';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { createInferenceProxy } from '../control-plane/inference-proxy.ts';
import { parseRegistry } from '../control-plane/worker-auth.ts';
test('inference proxy rejects arbitrary routes, revoked capabilities and disabled machine identities',async()=>{
  let registry=parseRegistry({workers:[{id:'worker-1',tokens:[{sha256:'a'.repeat(64),expiresAt:Date.now()+100000}]}]});
  const proxy=createInferenceProxy('test-key-never-sent',async()=>registry);
  proxy.server.listen(0,'127.0.0.1');await once(proxy.server,'listening');
  const base=`http://127.0.0.1:${(proxy.server.address() as AddressInfo).port}`;
  try {
    assert.equal((await fetch(base+'/v1/models')).status,401);
    const token=proxy.issue({workerId:'worker-1',tokenSha256:'a'.repeat(64)});
    const headers={Authorization:`Bearer ${token}`};
    assert.equal((await fetch(base+'/v1/files',{headers})).status,401);
    registry={workers:registry.workers.map(worker=>({...worker,disabled:true}))};
    assert.equal((await fetch(base+'/v1/models',{headers})).status,401);
    proxy.revoke(token);registry={workers:registry.workers.map(worker=>({...worker,disabled:false}))};
    assert.equal((await fetch(base+'/v1/models',{headers})).status,401);
  } finally {await new Promise<void>(resolve=>proxy.server.close(()=>resolve()));}
});
