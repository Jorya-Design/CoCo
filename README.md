# CoCo

A multiplayer planning workspace for a Codex worker harness.

**App:** https://coco-3471c.web.app · **Firebase project:** coco-3471c · **Data region:** London (europe-west2)

React + TypeScript + shadcn/ui, Firebase Hosting and Authentication, and Yjs
documents persisted and synchronized through Cloud Firestore.

The first slice includes verified email sign-in, private rooms shared by email, live
chat, collaborative plan editing, a DAG preview, and immutable plan approvals.
The Linux Codex scheduler and coding workers are the next milestone. The UI
does not simulate successful execution.

## Local development

Use Node 24.12+ (see .nvmrc) and Java 21+ for the Firestore emulator.

~~~sh
npm ci
cp .env.example apps/web/.env.local
npm run emulators
~~~

In another terminal:

~~~sh
npm run seed:emulators
npm run dev
~~~

Open http://127.0.0.1:5173. The local-only sign-in uses
teammate@example.com / local-dev-password. Production uses verified email/password sign-in.
Emulator data is disposable and separate from the real Firebase project.

## Validation

~~~sh
npm run typecheck
npm test
npm run test:rules
npm run build
~~~

Rules tests use the demo-coco project ID and verify membership isolation,
atomic CRDT seeding, append-only updates, author identity, size limits,
owner-only sharing, immutable approvals, and server-only execution writes.

## Continuous deployment

The Firebase GitHub Actions workflow checks pull requests. A push or merge to
main runs the same checks, builds the app, then deploys that exact build plus
Firestore rules/indexes to production. Production deployments run serially.

Google Workload Identity Federation is restricted to this repository's numeric
ID, organization ID, and main branch. The deployment service account can deploy
Hosting, Firestore rules, and indexes. No service-account key or Firebase login
token is stored in GitHub.

An administrator can reproduce the one-time identity setup with:

~~~sh
bash scripts/setup-deploy.sh
~~~

The production app loads its public Firebase SDK configuration from Hosting's
/__/firebase/init.json endpoint. There are no build-time Firebase secrets.
Never add inference keys or administrative credentials to the browser app.

## Data model

- rooms: title, owner UID, and member email list.
- rooms/{id}/updates: immutable binary Yjs updates, batched over 300 ms.
- rooms/{id}/messages: immutable room messages.
- rooms/{id}/presence: session heartbeats; clients ignore stale entries.
- rooms/{id}/approvals: immutable plan text and task DAG snapshots.
- rooms/{id}/runs: reserved for the server-owned worker control plane.

Yjs resolves concurrent edits; Firestore is the real-time transport and durable
store. The browser keeps pending writes in Firebase's persistent local cache.
Updates may arrive out of order or repeat. New rooms seed the document in an
atomic batch, so collaborators never initialize competing plan copies.

This foundation replays the room's update log. Add snapshot compaction before
long-lived or larger rooms; current payload limits bound individual writes.
Sharing adds an email to room membership and does not send an invitation email.
Google sign-in is pending: the requested public support contact is
joryatm@gmail.com, which Firebase does not currently offer as a verified support
address for the signed-in project administrator.

See [the product and architecture plan](tasks/prd-multiplayer-codex-harness.md).
The [editable architecture](docs/architecture.excalidraw) opens in Excalidraw;
an [SVG overview](docs/architecture.svg) is also included.
The earlier Express prototype in server/ is retained for reference and is not
part of the deployed Firebase application.
