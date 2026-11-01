import type { AuthError } from 'firebase/auth';

export function authErrorCode(error: unknown): string {
  return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' ? error.code : '';
}

export function authErrorMessage(error: unknown): string {
  switch (authErrorCode(error)) {
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request': return 'Google sign-in was cancelled. You can try again.';
    case 'auth/popup-blocked': return 'Your browser blocked the Google sign-in window. Allow pop-ups for CoCo, then try again.';
    case 'auth/operation-not-supported-in-this-environment':
    case 'auth/web-storage-unsupported': return 'Open CoCo in a regular browser with cookies and pop-ups enabled, then try again.';
    case 'auth/unauthorized-domain': return 'Google sign-in is not configured for this website address. Open coco-3471c.web.app and try again.';
    case 'auth/operation-not-allowed': return 'Google sign-in is not enabled for this Firebase project. Please contact a workspace administrator.';
    case 'auth/account-exists-with-different-credential': return 'This email already has a CoCo account. Sign in with its existing password to connect Google.';
    case 'auth/credential-already-in-use': return 'This Google account is already connected to another account. Sign in with Google again; your existing content has not been moved.';
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found': return 'The email or CoCo password is incorrect. Try again or reset your password.';
    case 'auth/network-request-failed': return 'Could not reach the sign-in service. Check your connection and try again.';
    case 'auth/too-many-requests': return 'Too many sign-in attempts. Please wait a little before trying again.';
    case 'auth/user-disabled': return 'This account has been disabled. Please contact a workspace administrator.';
    default: return error instanceof Error ? error.message : 'Sign-in failed. Please try again.';
  }
}

export function conflictingEmail(error: unknown): string | null {
  if (authErrorCode(error) !== 'auth/account-exists-with-different-credential') return null;
  const email = (error as AuthError).customData?.email;
  return typeof email === 'string' ? email.trim().toLowerCase() : null;
}
