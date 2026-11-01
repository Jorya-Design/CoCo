import { execFileSync } from 'node:child_process';
import * as Y from 'yjs';
import { makeTasks } from '../shared/plan.ts';
import { ORGANIZATION_ID, ORGANIZATION_NAME, ORGANIZATION_MEMBERS } from '../shared/organization.ts';

// Idempotent bootstrap. Never overwrites an existing room or its CRDT history.
const emulated = process.argv.includes('--emulator');
const project = emulated ? 'demo-coco' : 'coco-3471c';
const root = 'projects/' + project + '/databases/(default)/documents';
const endpoint = emulated ? 'http://127.0.0.1:8080/v1/' : 'https://firestore.googleapis.com/v1/';
const token = emulated ? 'owner' : execFileSync('gcloud', ['auth', 'print-access-token'], { encoding: 'utf8' }).trim();
const headers = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
const now = { timestampValue: new Date().toISOString() };
async function existing(path: string) {
  const response = await fetch(endpoint + root + '/' + path, { headers });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error('Cannot inspect organization data: ' + response.status);
  return response.json();
}
const orgPath = 'organizations/' + ORGANIZATION_ID;
const roomPath = 'rooms/coco-co-harness';
const org = await existing(orgPath);
const room = await existing(roomPath);
const writes: Record<string, unknown>[] = [];
function create(path: string, fields: Record<string, unknown>) {
  writes.push({ update: { name: root + '/' + path, fields }, currentDocument: { exists: false } });
}
if (!org) create(orgPath, {
  name: { stringValue: ORGANIZATION_NAME },
  memberEmails: { arrayValue: { values: ORGANIZATION_MEMBERS.map(email => ({ stringValue: email })) } },
  createdAt: now,
});
else {
  const members = org.fields.memberEmails.arrayValue.values.map((value: {stringValue: string}) => value.stringValue).sort();
  if (JSON.stringify(members) !== JSON.stringify([...ORGANIZATION_MEMBERS].sort())) throw new Error('Existing org membership differs; review it before changing access.');
}
if (!room) {
  const document = new Y.Doc();
  document.getText('plan').insert(0, '# Multiplayer Codex harness\n\n## Outcome\nHelp a team turn an idea into a shared plan, then execute coding tasks in parallel.\n\n## CoCo Co\nA public hackathon workspace. Everyone can view the plan and conversation; its two verified members can edit.\n\n## Stack\n- React + TypeScript with shadcn/ui\n- Firebase Hosting and Authentication\n- Yjs CRDT updates stored and streamed through Firestore in London\n- Codex sessions on a Linux host for the execution milestone\n\n## Planning workflow\nDiscuss the idea, use the guided interview, refine this plan together, and approve a fixed snapshot.\n\n## Execution DAG\nEstablish shared contracts, fan out UI/service/test work, then reduce the commits into an integrated result with check evidence.\n\n## Next milestones\n- Configure the Google support email, then add Google sign-in\n- Connect the Linux Codex runtime and durable scheduler\n- Add adaptive interviews and animated agent suggestions\n');
  document.getArray('tasks').push(makeTasks('Multiplayer Codex harness'));
  create(roomPath, { title: { stringValue: 'Multiplayer Codex harness' }, ownerUid: { stringValue: 'organization-bootstrap' }, orgId: { stringValue: ORGANIZATION_ID }, createdAt: now });
  create(roomPath + '/updates/initial', {
    bytes: { bytesValue: Buffer.from(Y.encodeStateAsUpdate(document)).toString('base64') },
    authorUid: { stringValue: 'organization-bootstrap' }, authorName: { stringValue: 'CoCo' }, createdAt: now,
  });
  create(roomPath + '/messages/welcome', {
    authorUid: { stringValue: 'organization-bootstrap' }, authorName: { stringValue: 'CoCo' },
    text: { stringValue: 'Welcome to CoCo Co. This hackathon workspace is publicly viewable. Our two members can sign in to edit the plan and join the conversation.' },
    createdAt: now,
  });
  document.destroy();
}
if (writes.length) {
  const response = await fetch(endpoint + root + ':commit', { method: 'POST', headers, body: JSON.stringify({ writes }) });
  if (!response.ok) throw new Error('Organization bootstrap failed: ' + response.status + ' ' + (await response.text()));
}
console.log(ORGANIZATION_NAME + ' is ready in ' + project + ' with two members and a public demo room.');
