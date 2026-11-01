# CoCo: multiplayer Codex harness

Status: initial Firebase foundation, 1 November 2026.

## Product and agreed scope

A small trusted team uses one repository and one Linux host. They discuss an
idea, edit a shared plan, approve a fixed plan revision, execute a dependency
graph of Codex coding tasks, then review the integrated result.

Firebase Hosting serves the React app. Firebase Authentication identifies users.
Firestore stores and streams the Yjs CRDT updates, chat, memberships, approvals,
and eventually execution records. Yjs provides document merge semantics.
shadcn/ui is the base design system. Build original agent components inspired by
the public interactions on [Affect UI](https://www.affectui.com/).

## Goals and first release

- Two authenticated teammates can edit a plan simultaneously and see chat live.
- Refreshing or reconnecting restores the shared document.
- A room owner can share access by a teammate's verified email address.
- Approving creates an immutable copy of the plan and task DAG.
- Merging to main runs checks and deploys Hosting plus Firestore rules/indexes.
- Codex execution becomes the next vertical slice, with real status and artifacts.

## User stories and acceptance

### US-001: Authenticate and share a room
As a teammate, I want to sign in and open only rooms shared with my email.
- [ ] Verified email sign-in works on the production domain; add Google once its support contact is configured.
- [ ] Owners create rooms and add verified teammates by email.
- [ ] Nonmembers cannot read or write room data; rules tests prove it.
- [ ] Typecheck passes.
- [ ] Verify in browser using dev-browser skill, or available browser automation.

### US-002: Discuss and edit together
As a collaborator, I want a room chat and a live shared plan.
- [ ] Separate browser sessions converge after concurrent edits.
- [ ] Chat and saved CRDT updates survive refresh.
- [ ] Saving, offline, and write errors are visible.
- [ ] Agent suggestions eventually use anchored, typed edits with attribution.
- [ ] Typecheck passes.
- [ ] Verify in browser using dev-browser skill, or available browser automation.

### US-003: Work through an interview
As a planner, I want questions that expose scope and architectural gaps.
- [ ] Initial guided questions record answers in chat and the plan.
- [ ] Next slice adds a Codex facilitator that asks adaptive follow-ups.
- [ ] One interview coordinator serializes the team's decisions.
- [ ] Unresolved decisions are visible before plan approval.
- [ ] Typecheck passes.
- [ ] Verify in browser using dev-browser skill, or available browser automation.

### US-004: Approve an execution contract
As an operator, I want to review a DAG and freeze the exact work to execute.
- [ ] The DAG rejects duplicate IDs, missing dependencies, and cycles.
- [ ] An approval contains plan text, task contracts, actor, and timestamp.
- [ ] Later plan edits create a new draft; an existing approval is unchanged.
- [ ] Workers validate a snapshot and pin the repository base SHA before running.
- [ ] Typecheck passes.
- [ ] Verify in browser using dev-browser skill, or available browser automation.

### US-005: Execute, integrate, and review
As an operator, I want independent tasks to run concurrently and produce one reviewable result.
- [ ] Each attempt has a separate Codex thread, workspace, lease, and artifact record.
- [ ] A task starts only after all required upstream artifacts are accepted.
- [ ] Reduce tasks integrate actual Git commits and run acceptance checks.
- [ ] Failures, requests for input, retries, and cancellation are visible.
- [ ] Final output includes the integrated branch, diff, commit SHA, and real test results.
- [ ] Typecheck passes.
- [ ] Verify in browser using dev-browser skill, or available browser automation.

## Functional requirements

FR-1. Authorize every Firestore path by verified identity and room membership.
FR-2. Store CRDT updates as append-only binary records with bounded size.
FR-3. Use a single atomic seed when creating a room; joining clients never reseed.
FR-4. Coalesce edits before persistence, synchronize updates idempotently, and
retain queued writes across reconnects. Add update-log compaction before larger use.
FR-5. Keep ephemeral presence separate from document content and expire stale peers.
FR-6. Separate editable plan state from immutable approval snapshots and
server-owned execution state. A CRDT update cannot mark a task successful.
FR-7. Associate every task with dependencies, input commits, file scope, output
artifacts, acceptance commands, time budget, and retry limit.
FR-8. Assign runnable tasks transactionally using attempt IDs and expiring leases.
FR-9. Fence stale attempt outputs. On lease loss, reconcile or stop the old
process before retrying; database fencing cannot undo shell side effects.
FR-10. Persist ordered execution events and allow clients to resume from a cursor.
FR-11. Pause stops new dispatch; interrupt requests cancellation of running work.
FR-12. Complete a run only after integration checks produce a reviewable result.

## Architecture

~~~mermaid
flowchart TB
  Team[Teammates] --> UI[React + shadcn UI / Firebase Hosting]
  UI <--> Auth[Firebase Authentication]
  UI <--> Data[Cloud Firestore / Yjs updates + chat + approvals + run events]
  Data <--> CP[Linux control plane / planner + validator + scheduler]
  CP --> A[Codex session A / isolated worktree]
  CP --> B[Codex session B / isolated worktree]
  A --> Reduce[Reduce / integrate commits + validate]
  B --> Reduce
  Reduce --> Review[Final diff + test evidence / team review]
  Review --> Data
~~~

Firebase is the application's shared data plane. The Linux service uses an
administrative identity; browser rules cannot grant themselves worker privileges.
Use one host initially, with separate control-plane and sandboxed worker processes.
Keep inference credentials outside browser bundles and outside task worktrees.

Recommended runtime spike: app-server behind a local stdio adapter for rich
streaming, approvals, and interaction. The current official documentation marks
app-server experimental, so validate the pinned runtime before production use.
Use the SDK where its programmatic task interface is sufficient. These are
adapter choices, not the source of DAG truth.
[Official Codex app-server documentation](https://learn.chatgpt.com/docs/app-server),
[Codex SDK](https://learn.chatgpt.com/docs/codex-sdk).

## Map/reduce execution semantics

Contracts/scaffold → parallel UI, services, and acceptance tasks → integrate →
review. This is a general dependency graph with fan-out and fan-in.

Each task attempt returns its input/base commits, output head SHA, changed files,
artifact references, checks and exit codes, and remaining concerns. A reduce node
starts from the pinned upstream state, merges dependency heads in deterministic
order, resolves conflicts, and validates the combined behavior. Preserve common
Git ancestry to avoid applying shared foundation commits repeatedly.

The scheduler owns dispatch, state transitions, retries, and concurrency limits.
Codex proposes task breakdowns and performs bounded work. A process exit or a
plausible summary alone is insufficient evidence that a task succeeded.

## UI design

Use a quiet, light workspace with a persistent room sidebar and two main views:
Plan & conversation, and Control plane. Use shadcn buttons, inputs, dialogs,
badges, and focus behavior as the base.

Original agent components:
- Document presence and suggestions: named carets, highlighted ranges, inline
  proposed edits, accept/reject, and follow-agent behavior.
- Interview cards: one active question, collaborative answers, open decisions.
- DAG task cards: status, elapsed time, worker, input/output artifacts.
- Event edges and a task inspector: animate actual events; show commands and results.
- Approval and final review cards: exact snapshot or diff and a clear action.

Visual effects consume real domain events and have reduced-motion equivalents.
Apply edits atomically; animation is a rendering concern. Use Yjs relative
positions to keep selections attached as collaborators edit. Start with
React Flow for the dependency graph and a deliberate layout; do not encode
execution state in graph coordinates.
[Yjs updates](https://docs.yjs.dev/api/document-updates),
[Yjs relative positions](https://docs.yjs.dev/api/relative-positions),
[React Flow layout](https://reactflow.dev/learn/layouting/layouting).

## Build sequence

1. Firebase foundation: auth, room membership, shared chat/plan, DAG preview,
   snapshot approval, CI, rules tests, and automatic Hosting deployments.
2. Runtime spike: one Linux Codex task with streamed events, a request for input,
   interruption, and recovery after a service restart.
3. Planner: adaptive interview, typed plan-edit tools, task contracts, and validation.
4. Scheduler: two independent real tasks, durable leases, bounded retries,
   sandboxed worktrees, and Firestore run events.
5. Reducer: integrate commits, resolve conflicts, run acceptance checks, final diff.
6. Agent UI: anchored suggestions, inspector, real event animations, replay,
   reconnection, and accessibility polish.

## Non-goals for the initial foundation

Public multi-tenant hosting, arbitrary repository cloning, automatic main-branch
merges from coding workers, production deployment by coding workers, a general
browser automation platform, and fabricated Codex execution.

## Success criteria and next decisions

The first milestone is successful when two invited users can create a room,
chat and edit concurrently, approve a fixed snapshot, refresh without losing
saved work, and see a subsequent main-branch merge deploy automatically.

Before the execution milestone, decide the Linux host/repository path, inference
authentication and budget, sandbox/network policy, task concurrency, and the
policy for resolving conflicting team answers. Plan-log compaction and an
automated two-browser regression belong before wider adoption.

## Deployment references

Firebase Hosting serves the SPA; Firebase Auth supplies the identity used by
Firestore rules. GitHub's deployment identity is restricted to this repo's main
branch. Rules and hosting deploy from the same checked commit.
[Firebase Hosting](https://firebase.google.com/docs/hosting),
[Firebase Authentication](https://firebase.google.com/docs/auth/web/start),
[Firestore realtime listeners](https://firebase.google.com/docs/firestore/query-data/listen),
[Firebase rule tests](https://firebase.google.com/docs/rules/unit-tests).
