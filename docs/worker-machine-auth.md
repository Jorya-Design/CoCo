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
- The supervisor polls for approved work, renews its lease, and reports a bounded
  result and commit. All commands reauthenticate before processing.
- `authorizeWorkerRun` checks a trusted scheduler lease against worker identity,
  room, run, attempt, expiry, active status and fence. Result and heartbeat writes
  enforce this boundary in the same Firestore transaction as their state change.

## Google Cloud VM deployment

The first deployment colocates the gateway and supervisor on one VM, using
loopback WebSockets and separate Linux service users. Nothing listens publicly
on port 8787. Remote workers require HTTPS/WSS termination with certificate
validation. Never expose the plaintext loopback service through a public port.

The first VM is `coco-execution-1`, `europe-west2-b`, Ubuntu 24.04 on e2-medium
with a 30 GB balanced disk. `deploy/bootstrap.sh` installs Node 24.12, Docker and
the executor network firewall. OS Login is enabled. SSH is restricted to IAP's
`35.235.240.0/20`; neither the gateway nor inference proxy has public ingress.
The administrator-reviewed `scripts/provision-worker-vm.ps1` creates the two
service identities and attaches `coco-control-plane@coco-3471c.iam.gserviceaccount.com`
to the VM. That identity has Firestore access through short-lived Google tokens.
The executor cannot reach the metadata service, private networks or host ports
other than the inference proxy. The trusted supervisor never runs repository code.

Create `github-runtime-deploy@coco-3471c.iam.gserviceaccount.com` separately from
the existing Hosting deployer. Allow the existing main-branch-restricted
`coco-github` federation principal to impersonate it using
`roles/iam.workloadIdentityUser`. Grant only the needed VM deployment access:
OS Admin Login, IAP tunnel access scoped to the VM, and Compute Viewer for
instance lookup. Bootstrap these IAM grants administratively; the workflow
does not grant itself permissions or create billing resources.
The deployer also needs Service Account User on the VM's attached runtime identity
for OS Login. It has no Firestore role and the Hosting deployer has no VM access.

In GitHub's **production environment**, configure:

| Name | Kind | Value |
| --- | --- | --- |
| COCO_WORKER_TOKEN | Secret | Generate once using `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"` in a trusted administrator shell; save directly as a secret. |
| OPENAI_API_KEY | Secret | Inference key, installed only for the trusted control plane. Never expose it to the web app or executor. |
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
It installs the control plane, supervisor and executor firewall services. A
container image pins Codex 0.166.0 and communicates over local stdio JSON-RPC.
The real OpenAI key lives in `/etc/coco/control-plane/openai-key`. A private
inference proxy exchanges each active attempt's short-lived capability for that
key; it accepts only Responses and model-list requests to the official API.
The proxy revokes capabilities on completion, cancellation, disconnect or expiry.

## Rotation and revocation

For an atomic same-VM rollout, replace the GitHub token and expiry and dispatch
the workflow; both services restart against credentials derived from one value.
For remote workers, add the new hash with an expiry alongside the old one,
deploy the new worker token, verify reconnect, then remove the old hash. Registry
updates must use an atomic rename. Disable a worker or remove all its hashes to
revoke it, including existing connections. Keep revoked entries out of future
GitHub deployments so a redeploy cannot accidentally restore access.
Deployments restart the supervisor and stop active containers. An interrupted
attempt fails when its lease expires; start a new run explicitly after deployment.

## Running approved work

The execution view subscribes to trusted worker health in Firestore. Heartbeats
expire after 90 seconds if the VM disappears. A verified organization member
explicitly starts an immutable approved snapshot; approval alone never executes
code. Clients can enqueue/cancel requests but cannot write leases, results or
worker health. The scheduler validates the DAG and current organization membership.

The first release executes one task at a time on this VM, keeping each run on one
worker. Each task starts from the deployed CoCo commit and receives every ancestor
commit in dependency order. Disposable containers have no machine credential,
Google identity, Docker socket or real inference key. Their only host mount is
the run workspace. Memory, CPU, process count and a 20-minute task timeout bound
execution. Codex uses external-sandbox mode because Docker provides isolation.

Results and commit SHAs are durable in `rooms/{roomId}/runs/{runId}`. Git objects
and worktrees stay in `/var/lib/coco-worker/runs/{runId}`. When **all** DAG tasks
finish, the scheduler starts a separate final publication attempt; this is not a
DAG node and does not change the approved task graph. Codex checks the integrated
work, pushes `codex/coco-{runId}`, and uses `gh` to create one open, non-draft PR
against `Jorya-Design/CoCo:main`. It never merges the PR or deploys the result.
The executor queries GitHub to verify the PR's repository, branch, base, and head
commit. A run is only completed after that verified PR is persisted as
`pullRequest`; publication state and output are stored separately as `publication`.
The **PR to Review** view links to that PR. Publication failure fails the run
visibly while preserving implementation results. An interrupted or failed
publication can leave a branch or PR on GitHub; inspect it before starting a new run.
Cancellation kills the container and revokes inference;
an expired attempt fails visibly and requires an explicit new run. Parallel
slots, remote artifact transfer, automated retries and workspace retention/cleanup
are future work. Review disk usage before launching many runs.

### GitHub automation account credential

The automation identity is a regular GitHub user account authenticated with its
personal access token (PAT). The existing `COCO_GITHUB_BOT_TOKEN` secret name
refers to that user's PAT; no GitHub App or installation token is required.

Provision the bot token in `/etc/coco/worker/github-token` (root-owned, mode 0640,
group `coco-worker`), or use the production environment secret
`COCO_GITHUB_BOT_TOKEN` with the worker VM workflow. The supervisor reads
`COCO_GITHUB_TOKEN_FILE` and passes it through stdin only to the final publication
container, where Codex's shell receives it as `GH_TOKEN`. Planning and DAG tasks
receive no GitHub credential; no token is stored in Firestore, the browser, Docker
arguments, image layers, repository remotes, or worktrees. The CLI credential
helper configuration lives in disposable `/tmp` and reads the environment.

Use a bot credential restricted to this repository with Contents and Pull requests
read/write permissions. If an approved change edits GitHub Actions workflows,
the credential also needs permission to update workflows. Keep branch protection
on `main` and prevent the bot from bypassing review. Rotate by replacing the VM
file atomically or updating the production secret and redeploying. Without a
configured token, implementation is preserved and publication reports a clear failure.
