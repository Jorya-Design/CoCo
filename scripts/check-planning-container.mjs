// Real pinned Codex binary and production supervisor, fake inference, no API key.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { runContainer } from '../worker/run-container.ts';
const text='Let us clarify the acceptance criteria before implementing the plan.';
let calls=0;
const server=createServer(async(req,res)=>{
  let raw='';for await(const chunk of req)raw+=chunk;
  assert.equal(req.url,'/v1/responses');
  assert.equal(req.headers.authorization,'Bearer protocol-test-only');
  const request=JSON.parse(raw);assert.match(JSON.stringify(request.input),/Help plan the release/);calls++;
  res.writeHead(200,{'Content-Type':'text/event-stream'});
  const item={id:'msg_1',type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text,annotations:[]}]};
  const response={id:'resp_1',object:'response',created_at:Math.floor(Date.now()/1000),status:'completed',model:request.model,output:[item],usage:{input_tokens:10,output_tokens:10,total_tokens:20}};
  const events=[
    {type:'response.created',response:{...response,status:'in_progress',output:[]}},
    {type:'response.output_item.added',output_index:0,item:{...item,status:'in_progress',content:[]}},
    {type:'response.content_part.added',item_id:item.id,output_index:0,content_index:0,part:{type:'output_text',text:'',annotations:[]}},
    {type:'response.output_text.delta',item_id:item.id,output_index:0,content_index:0,delta:text},
    {type:'response.output_text.done',item_id:item.id,output_index:0,content_index:0,text},
    {type:'response.content_part.done',item_id:item.id,output_index:0,content_index:0,part:item.content[0]},
    {type:'response.output_item.done',output_index:0,item},
    {type:'response.completed',response},
  ];
  for(const [sequence_number,event] of events.entries())res.write(`event: ${event.type}\ndata: ${JSON.stringify({...event,sequence_number})}\n\n`);
  res.end();
});
execFileSync('docker',['network','create','--subnet','172.30.0.0/24','--gateway','172.30.0.1','coco-executor']);
try {
  await new Promise(resolve=>server.listen(8790,'172.30.0.1',resolve));
  process.env.COCO_EXECUTOR_IMAGE='coco-executor:test';
  let threadId;
  const result=await runContainer({kind:'planning',roomId:'test-room',runId:'test-message',attemptId:randomUUID(),fence:1,
    prompt:'Help plan the release. Reply with one sentence; do not use tools.',inferenceToken:'protocol-test-only'},
    AbortSignal.timeout(60000),id=>{threadId=id;});
  assert.ok(threadId);assert.equal(calls,1);assert.equal(result.success,true);
  assert.equal(result.output.trim(),text);assert.equal(result.commit,undefined);
  console.log('Real Codex planning turn and production container supervisor verified without an API key');
} finally {
  await new Promise(resolve=>server.close(resolve));
  execFileSync('docker',['network','rm','coco-executor']);
}
