import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const env={...process.env};
// Optional portable Java for Windows development; CI supplies Java 21 on PATH.
const portable=join(root,'.coco','tools','java');
if (!env.JAVA_HOME && existsSync(portable)) {
  const runtime=readdirSync(portable).find(name=>existsSync(join(portable,name,'bin',process.platform==='win32'?'java.exe':'java')));
  if(runtime)env.JAVA_HOME=join(portable,runtime);
}
const pathKey=Object.keys(env).find(key=>key.toLowerCase()==='path') ?? 'PATH';
env[pathKey]=[dirname(process.execPath),...(env.JAVA_HOME?[join(env.JAVA_HOME,'bin')]:[]),env[pathKey]??''].join(delimiter);
env.FIREBASE_EMULATORS_PATH ??= join(root,'.coco','emulators');
const child=spawn(process.execPath,[join(root,'node_modules','firebase-tools','lib','bin','firebase.js'),
  'emulators:exec','--only','auth,firestore','--project','demo-coco',
  'node --import tsx --test --test-concurrency=1 tests/firestore.rules.test.ts tests/auth.emulator.test.ts tests/scheduler.test.ts tests/plan-agent.test.ts tests/collaboration.emulator.test.ts',
],{cwd:root,env,stdio:'inherit'});
child.on('error',error=>{console.error(error.message);process.exitCode=1;});
child.on('exit',code=>{process.exitCode=code??1;});
