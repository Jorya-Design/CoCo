import assert from 'node:assert/strict';
import { test } from 'node:test';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { createInferenceProxy } from '../control-plane/inference-proxy.ts';
import { parseRegistry } from '../control-plane/worker-auth.ts';
import { createServer, request as httpRequest } from 'node:http';
import type { request as httpsRequest } from 'node:https';
import { zstdCompressSync } from 'node:zlib';
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

test('planning capabilities remove tools and limit output, including compressed Codex requests',async()=>{
  let received:any;
  const upstream=createServer(async(req,res)=>{
    let raw='';for await(const chunk of req)raw+=chunk;
    received={body:JSON.parse(raw),authorization:req.headers.authorization};
    res.writeHead(200,{'Content-Type':'text/event-stream'}).end('data: [DONE]\n\n');
  });
  upstream.listen(0,'127.0.0.1');await once(upstream,'listening');
  const registry=parseRegistry({workers:[{id:'worker-1',tokens:[{sha256:'a'.repeat(64),expiresAt:Date.now()+100000}]}]});
  const transport=((options:any,callback:any)=>httpRequest({...options,hostname:'127.0.0.1',port:(upstream.address() as AddressInfo).port},callback)) as typeof httpsRequest;
  const proxy=createInferenceProxy('test-upstream-key',async()=>registry,transport);
  proxy.server.listen(0,'127.0.0.1');await once(proxy.server,'listening');
  try {
    const token=proxy.issue({workerId:'worker-1',tokenSha256:'a'.repeat(64)},true);
    const response=await fetch(`http://127.0.0.1:${(proxy.server.address() as AddressInfo).port}/v1/responses`,{
      method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Encoding':'zstd'},
      body:zstdCompressSync(Buffer.from(JSON.stringify({model:'test-model',tools:[{type:'function',name:'exec'}],tool_choice:'required',max_output_tokens:999999}))),
    });
    assert.equal(response.status,200);assert.match(await response.text(),/DONE/);
    assert.deepEqual(received.body.tools,[]);assert.equal(received.body.tool_choice,'none');
    assert.equal(received.body.max_output_tokens,4096);assert.equal(received.authorization,'Bearer test-upstream-key');
  } finally {
    await new Promise<void>(resolve=>proxy.server.close(()=>resolve()));
    await new Promise<void>(resolve=>upstream.close(()=>resolve()));
  }
});
