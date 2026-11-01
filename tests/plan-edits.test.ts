import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import {anchorPlanEdit,applyPlanEdits,capturePlanContext} from '../shared/plan-edits.ts';
test('agent edits follow relative anchors after unrelated human edits',()=>{
 const doc=new Y.Doc(),text=doc.getText('plan');text.insert(0,'Keep this. Change this.');
 const edit=anchorPlanEdit(doc,11,23,'Improved.');text.insert(0,'Intro. ');
 assert.equal(applyPlanEdits(doc,[edit]),true);assert.equal(text.toString(),'Intro. Keep this. Improved.');
 assert.equal(capturePlanContext(doc).markdown,text.toString());doc.destroy();
});
test('a human change in a proposed range rejects all edits without overwriting it',()=>{
 const doc=new Y.Doc(),text=doc.getText('plan');text.insert(0,'First. Second.');
 const edits=[anchorPlanEdit(doc,0,6,'One.'),anchorPlanEdit(doc,7,14,'Two.')];
 text.insert(10,'human');const current=text.toString();
 assert.equal(applyPlanEdits(doc,edits),false);assert.equal(text.toString(),current);doc.destroy();
});
