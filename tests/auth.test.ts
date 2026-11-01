import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authErrorMessage, conflictingEmail } from '../apps/web/src/lib/auth.ts';

test('Google cancellation and blocked windows give actionable recovery', () => {
  assert.match(authErrorMessage({code:'auth/popup-closed-by-user'}), /cancelled/);
  assert.match(authErrorMessage({code:'auth/cancelled-popup-request'}), /cancelled/);
  assert.match(authErrorMessage({code:'auth/popup-blocked'}), /Allow pop-ups/);
  assert.match(authErrorMessage({code:'auth/unauthorized-domain'}), /coco-3471c.web.app/);
  assert.match(authErrorMessage({code:'auth/network-request-failed'}), /connection/);
});

test('only an account collision can select an existing email for linking', () => {
  assert.equal(conflictingEmail({code:'auth/account-exists-with-different-credential',customData:{email:'SURYANSH@GMAIL.COM'}}), 'suryansh@gmail.com');
  assert.equal(conflictingEmail({code:'auth/popup-closed-by-user',customData:{email:'someone@example.com'}}), null);
  assert.equal(conflictingEmail({code:'auth/account-exists-with-different-credential'}), null);
  assert.equal(conflictingEmail(null), null);
});
