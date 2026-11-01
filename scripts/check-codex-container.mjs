import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
const child=spawn('docker',['run','--rm','--interactive','--network','none','--read-only','--cap-drop','ALL',
  '--security-opt','no-new-privileges','--tmpfs','/tmp:rw,nosuid,size=64m','--env','HOME=/tmp',
  '--env','CODEX_HOME=/tmp','--env','COCO_INFERENCE_TOKEN=protocol-test-only','--entrypoint','codex',process.argv[2]??'coco-executor:test','-c','model_provider="coco"','-c','model_providers.coco={name="CoCo",base_url="http://172.30.0.1:8790/v1",wire_api="responses",env_key="COCO_INFERENCE_TOKEN",requires_openai_auth=false}','app-server','--listen','stdio://'],{stdio:['pipe','pipe','pipe']});
const lines=createInterface({input:child.stdout});
const timer=setTimeout(()=>{child.kill();process.exitCode=1;},30000);
let initialized=false,thread=false,executed=false;
const send=value=>child.stdin.write(JSON.stringify(value)+'\n');
child.stdin.on('error',()=>{});
child.stderr.pipe(process.stderr); // CI check has no credentials or repository mount.
lines.on('line',line=>{
  const message=JSON.parse(line);
  if(message.error){console.error('Codex protocol smoke check failed');child.kill();process.exitCode=1;return;}
  if(message.id===1){
    initialized=true;send({method:'initialized',params:{}});
    send({id:2,method:'thread/start',params:{cwd:'/tmp',sandbox:'read-only',approvalPolicy:'never',modelProvider:'coco'}});
  }
  if(message.id===2 && message.result?.thread?.id){
    thread=true;send({id:3,method:'command/exec',params:{cwd:'/tmp',command:['node','-e','process.stdout.write("isolation ok")'],sandboxPolicy:{type:'externalSandbox',networkAccess:'enabled'},timeoutMs:5000}});
  }
  if(message.id===3 && message.result?.exitCode===0 && message.result?.stdout==='isolation ok'){
    executed=true;console.log('Codex stdio, configured provider and external sandbox verified');child.stdin.end();
  }
});
child.on('error',()=>{process.exitCode=1;clearTimeout(timer);});
child.on('close',code=>{clearTimeout(timer);lines.close();if(!initialized||!thread||!executed){console.error('Codex container exited before protocol handshake:',code);process.exitCode=1;}});
send({id:1,method:'initialize',params:{clientInfo:{name:'coco-protocol-test',version:'0.1.0'}}});
