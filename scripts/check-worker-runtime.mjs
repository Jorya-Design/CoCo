import {readFile} from 'node:fs/promises';
const token=(await readFile('/etc/coco/worker/token','utf8')).trim();
let ready=false;
for(let count=0;count<30;count++){
  try {
    const response=await fetch('http://127.0.0.1:8787/worker/v1/status',{
      headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(2000),
    });
    if(response.ok && (await response.json()).connected){ready=true;break;}
  } catch {}
  await new Promise(resolve=>setTimeout(resolve,1000));
}
if(!ready)throw new Error('Worker did not authenticate to the running control plane');
console.log('Worker connection and machine authentication verified');
