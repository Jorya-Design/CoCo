# Deployment and operations

## Environments

| Environment | App | Auth/data |
| --- | --- | --- |
| Local | Vite at http://127.0.0.1:5173 | Firebase emulators, project demo-coco |
| Production | https://coco-3471c.web.app | Firebase project coco-3471c; London Firestore database |

Node 24.12+ and Java 21+ are required for the current SDK and emulator tooling.
The repository pins dependencies in package-lock.json and CI actions by commit.

For local setup, follow the [root README](../README.md). Set
VITE_USE_EMULATORS=true only in the local web app environment file.
Production reads Firebase's public web-app configuration at runtime from Hosting.

## Main-branch deployment

The [Firebase workflow](../.github/workflows/firebase.yml) runs on pull requests,
pushes to main, and manual dispatch.

1. Install exactly the locked dependencies.
2. Typecheck shared/server reference code and the React app.
3. Run the CRDT/DAG unit tests.
4. Start an isolated Firestore emulator and run the authorization tests.
5. Build the production app and upload the resulting artifact.
6. On main, authenticate through Google Workload Identity Federation.
7. Download that same artifact and deploy Hosting, Firestore rules, and indexes.

The deploy job depends on all quality checks. A pull request never deploys
production. Deployment runs serially; a failed new build leaves the previous
Hosting release serving traffic.

Hosting and Firestore policy releases are separate operations in Firebase.
Deployments are not atomic across both services. Keep application/schema/rule
changes compatible with the previous client during rollout.

The initial deployment was performed with the operator's existing Firebase login.
Ongoing main-branch deployment uses the service account and branch-restricted
trust documented in [auth and access](auth-and-access.md).

## One-time project setup

The current deployment has:

- A registered Firebase web app named CoCo.
- Email/password Authentication enabled; verified org membership is required for editing.
- The default Firestore database in europe-west2.
- Firebase Hosting and public-read/member-write organization rules.
- CoCo Co, two editing members, and its public demo room.
- The GitHub deployment identity from scripts/setup-deploy.sh.

The one-time data bootstrap is npm run seed:organization, run with an authorized
operator's existing gcloud login. It creates missing records without replacing
room content. Routine CI deployments do not reseed application data.

Google sign-in is tracked in #3 after the support-email ticket #2. Linux execution
is a later service; no deployed page claims that a Codex run has completed.

## Release and rollback

Merge a passing pull request into main, then inspect the workflow's Deploy
production job and Firebase Hosting release.

An authorized operator can deploy locally with:

~~~sh
npm ci
npm run typecheck
npm test
npm run test:rules
npm run deploy
~~~

Hosting supports restoring a previous version from its console. Firestore rules
and indexes must be restored separately from source when necessary. Reverting
the relevant commit and merging a passing revert triggers a fresh deployment.
Immutable CRDT records and approval snapshots are application data, not Hosting
release assets, and are not rolled back by changing the website version.

## Credentials and continuing work

No service-account key or Firebase login token is configured in GitHub Secrets.
The workflow uses short-lived credentials from its OIDC identity. The public
Firebase web configuration is not an administrative credential.

Before adding Linux workers, implement the runtime spike, scheduler, isolated
worktrees, attempt fencing, commit artifacts, and reducer checks from the
[product plan](../tasks/prd-multiplayer-codex-harness.md). Add a Yjs snapshot
compaction service before replaying update histories becomes expensive.
