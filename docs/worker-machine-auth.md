# Worker-to-control-plane authentication

The machine gateway and worker connection are separate from Firebase human
sign-in. Every worker has a 32-byte random base64url bearer token. GitHub Actions
deploys that value only to the worker and its SHA-256 verifier to the gateway.
Neither value belongs in public Firestore run records, images, logs or git.

## Implemented boundary

- `GET /worker/v1/identity` authenticates the Authorization header.
- `/worker/v1/connect` authenticates before upgrading to WebSocket. Browser
  Origin headers and credentials in query strings are rejected.
- Credentials expire, and each worker can have two verifiers for rotation overlap.
  The registry is reloaded on every HTTP request and every five seconds for open
  sockets. Missing/invalid registries fail closed. Removal, disabling or expiry
  closes authenticated sockets within that interval.
- The connection responds to transport ping/pong, but accepts no scheduling or
  execution commands yet. This is an authentication service, not the scheduler.
- `authorizeWorkerRun` checks a trusted scheduler lease against worker identity,
  room, run, attempt, expiry, active status and fence. Future result/event handlers
  must call it and enforce the same fence in their storage transaction.

## Google Cloud VM deployment

The first deployment colocates the gateway and supervisor on one VM, using
loopback WebSockets and separate Linux service users. Nothing listens publicly
on port 8787. Remote workers require HTTPS/WSS termination with certificate
validation. Never expose the plaintext loopback service through a public port.

Provision an Ubuntu 24.04 VM in `coco-3471c` after billing is active. Choose the
machine size and budget in Compute Engine before creating it. Install Node.js
24 (at least 24.12.0), npm, curl and tar. Enable OS Login and IAP SSH. Restrict
SSH ingress to IAP's `35.235.240.0/20`, with no HTTP/worker-port ingress. The
authentication-only VM needs no attached Firebase/Admin service account.

Create `github-runtime-deploy@coco-3471c.iam.gserviceaccount.com` separately from
the existing Hosting deployer. Allow the existing main-branch-restricted
`coco-github` federation principal to impersonate it using
`roles/iam.workloadIdentityUser`. Grant only the needed VM deployment access:
OS Admin Login, IAP tunnel access scoped to the VM, and Compute Viewer for
instance lookup. Bootstrap these IAM grants administratively; the workflow
does not grant itself permissions or create billing resources.

In GitHub's **production environment**, configure:

| Name | Kind | Value |
| --- | --- | --- |
| COCO_WORKER_TOKEN | Secret | Generate once using `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"` in a trusted administrator shell; save directly as a secret. |
| COCO_WORKER_TOKEN_EXPIRES_AT | Variable | Explicit future ISO timestamp; renew before expiry. |
| COCO_WORKER_ID | Variable | `worker-1` |
| COCO_VM_NAME | Variable | Provisioned VM name |
| COCO_VM_ZONE | Variable | Provisioned VM zone |

Set repository variable `COCO_VM_ENABLED=true` only after the VM, IAM and
production environment settings are ready. `.github/workflows/worker-vm.yml`
tests main, derives the verifier from the same token, and deploys via IAP/OS Login.
No private SSH key is stored in GitHub. The deployment bundle is a temporary
credential-bearing file transferred over SSH, not a published Actions artifact.

The installer creates root-managed `/etc/coco/control-plane/workers.json` and
`/etc/coco/worker/token`, readable only by the corresponding service group.
It installs two systemd services and leaves the listener on loopback. The initial
client only proves authentication; Codex execution and Firestore scheduling
must be integrated separately with a sandbox that cannot read these files.

## Rotation and revocation

For an atomic same-VM rollout, replace the GitHub token and expiry and dispatch
the workflow; both services restart against credentials derived from one value.
For remote workers, add the new hash with an expiry alongside the old one,
deploy the new worker token, verify reconnect, then remove the old hash. Registry
updates must use an atomic rename. Disable a worker or remove all its hashes to
revoke it, including existing connections. Keep revoked entries out of future
GitHub deployments so a redeploy cannot accidentally restore access.

## Remaining execution integration

This change does not provision inference credentials, spawn Codex, grant worker
Firestore access, assign runs or implement durable event storage. Those belong
to the execution milestone. Keep the trusted supervisor and all machine
credentials outside the Codex shell sandbox; block metadata-service access from
that sandbox before attaching any Google runtime identity to the VM.
