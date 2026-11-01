import { randomBytes, createHash } from 'node:crypto';
import { createServer, type ServerResponse } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { zstdDecompressSync, gunzipSync } from 'node:zlib';
import type { WorkerIdentity, WorkerRegistry } from './worker-auth.ts';

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
// Codex receives a short-lived inference capability. The real OpenAI key stays
// in the trusted control-plane process and is never mounted in an executor.
export function createInferenceProxy(apiKey: string, registry: () => Promise<WorkerRegistry>, upstreamRequest = httpsRequest) {
  const grants = new Map<string,{identity:WorkerIdentity;expiresAt:number;streams:Set<ServerResponse>;planning:boolean}>();
  function revoke(token: string) {
    const grant = grants.get(digest(token));
    for (const stream of grant?.streams ?? []) stream.destroy();
    grants.delete(digest(token));
  }
  const server = createServer(async (req,res) => {
    res.setHeader('Cache-Control','no-store');
    const allowed = (req.method === 'POST' && req.url === '/v1/responses') || (req.method === 'GET' && req.url === '/v1/models');
    const token = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers.authorization ?? '')?.[1];
    const grant = token ? grants.get(digest(token)) : null;
    let valid = false;
    try {
      const current = await registry();
      valid = !!grant && grant.expiresAt > Date.now() && current.workers.some(worker=>
        worker.id === grant.identity.workerId && !worker.disabled && worker.tokens.some(token=>
          token.sha256 === grant.identity.tokenSha256 && token.expiresAt > Date.now()));
    } catch { /* fail closed */ }
    if (!allowed || !grant || !valid) { res.writeHead(401).end(); return; }
    const chunks: Buffer[] = [];
    let length = 0;
    try {
      for await (const chunk of req) {
        length += chunk.length;
        if (length > 8 * 1024 * 1024) { res.writeHead(413).end(); return; }
        chunks.push(chunk);
      }
    } catch { res.destroy(); return; }
    if (grant.expiresAt <= Date.now()) { res.writeHead(401).end(); return; }
    let body = Buffer.concat(chunks);
    try {
      const encoding = req.headers['content-encoding'];
      if (encoding === 'zstd') body=zstdDecompressSync(body,{maxOutputLength:8*1024*1024});
      else if (encoding === 'gzip') body=gunzipSync(body,{maxOutputLength:8*1024*1024});
      else if (encoding && encoding !== 'identity') {res.writeHead(415).end();return;}
    } catch {res.writeHead(400).end();return;}
    if (grant.planning && req.method === 'POST') {
      try {
        const value = JSON.parse(body.toString('utf8'));
        // Planning capabilities cannot request tools, regardless of the prompt.
        value.tools=[];value.tool_choice='none';value.max_output_tokens=4096;
        body=Buffer.from(JSON.stringify(value));
      } catch { res.writeHead(400).end();return; }
    }
    grant.streams.add(res);
    const upstream = upstreamRequest({hostname:'api.openai.com',port:443,path:req.url,method:req.method,
      headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json','Content-Length':body.length},
    }, response => {
      if ((response.statusCode ?? 500) >= 400) {
        response.resume(); res.writeHead(response.statusCode ?? 502,{'Content-Type':'application/json'})
          .end(JSON.stringify({error:{message:'Inference request failed. Check model access and API billing.',type:'inference_error'}}));
        return;
      }
      res.writeHead(response.statusCode ?? 502,{'Content-Type':response.headers['content-type'] ?? 'application/json'});
      response.pipe(res);
    });
    upstream.setTimeout(180000,()=>upstream.destroy());
    upstream.on('error',()=>{ if (!res.headersSent) res.writeHead(502).end(); else res.destroy(); });
    res.on('close',()=>{ grant.streams.delete(res); upstream.destroy(); });
    upstream.end(body);
  });
  const timer = setInterval(()=>{
    for (const [hash,grant] of grants) if (grant.expiresAt <= Date.now()) {
      for (const stream of grant.streams) stream.destroy(); grants.delete(hash);
    }
  },5000);
  timer.unref();
  server.on('close',()=>clearInterval(timer));
  return {server, issue: (identity: WorkerIdentity, planning = false) => {
    const token = randomBytes(32).toString('base64url');
    grants.set(digest(token),{identity,planning,expiresAt:Date.now()+90000,streams:new Set()}); return token;
  }, renew: (token: string) => { const grant=grants.get(digest(token)); if(grant)grant.expiresAt=Date.now()+90000; }, revoke};
}
