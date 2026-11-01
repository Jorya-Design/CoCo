import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { replaceText } from '../shared/crdt.ts';

test('concurrent edits converge when Firestore delivers updates twice and out of order', () => {
  const a = new Y.Doc(), b = new Y.Doc();
  a.getText('plan').insert(0, 'Ship the app');
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  const updatesA: Uint8Array[] = [], updatesB: Uint8Array[] = [];
  a.on('update', update => updatesA.push(update));
  b.on('update', update => updatesB.push(update));
  replaceText(a.getText('plan'), 'Ship the collaborative app');
  replaceText(b.getText('plan'), 'Ship the app today');
  const mergedA = Y.mergeUpdates(updatesA), mergedB = Y.mergeUpdates(updatesB);
  Y.applyUpdate(a, mergedB);
  Y.applyUpdate(a, mergedB);
  Y.applyUpdate(b, mergedA);
  assert.equal(a.getText('plan').toString(), b.getText('plan').toString());
  assert.equal(a.getText('plan').toString(), 'Ship the collaborative app today');
});

test('minimal text replacement preserves cursor anchors outside the edit', () => {
  const document = new Y.Doc(), text = document.getText('plan');
  text.insert(0, 'Plan: ship this');
  const cursor = Y.createRelativePositionFromTypeIndex(text, 11);
  replaceText(text, 'Plan: safely ship this');
  assert.equal(Y.createAbsolutePositionFromRelativePosition(cursor, document)?.index, 18);
  replaceText(text, '');
  assert.equal(text.toString(), '');
});
