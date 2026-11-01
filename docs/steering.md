# DAG inspection and steering

The Implementation view shows the shared task DAG as branching stages, with
parallel work and merge dependencies preserved. Select a task with a pointer,
Tab and Enter, or Space to inspect it. The inspector shows its implementation
prompt, dependency navigation, instructions, and Codex thread metadata, task
activity, output, and errors when a server-owned run publishes them.

The interface starts in dark mode and remembers an explicit light/dark choice
in local storage. On narrow screens the DAG follows a vertical rail; each task
also names its dependencies in the inspector. Dialog focus, Escape to close,
keyboard operation, and reduced motion are supported.

## Instructions

Verified organization members can queue a task instruction with Enter or the
Queue instruction button. Shift+Enter inserts a line break. An active task in
a running run also allows an interrupt request with Ctrl/Command+Enter or
Interrupt now. Escape clears a nonempty instruction before closing the panel.
Members can cancel queued instructions; guests can inspect them read-only.

Requests persist in `rooms/{roomId}/steering/{noteId}` with:

- `taskId`: task from the displayed DAG.
- `runId`: the selected server-owned run ID, or null for the next run.
- `text`: a trimmed instruction, 1–4,000 characters.
- `timing`: `next` (before the next step) or `now` (request an interrupt).
- `status`: `queued`, `applied`, `cancelled`, or `rejected`.
- `authorUid`, `authorName`, `createdAt`: member attribution and server time.

Requests for a run require that run to be running or paused. Immediate requests
require a running run; the UI additionally requires the selected task to be
running. Rules restrict browser creation to `queued` and browser updates to
`queued → cancelled`; only a privileged worker service can acknowledge or reject
an instruction. Text, scope, attribution, and history cannot be rewritten by a
browser. Like the rest of this hackathon workspace, these instructions are public.

The graph defaults to the latest run's task snapshot when a run exists.
Working draft explicitly switches to the collaborative tasks and next-run
instructions. This keeps an edited draft from silently changing an active run's
context. Only instructions matching the task and displayed run are shown.

## Worker integration boundary

The deployed Firebase application has no Linux Codex scheduler yet. This change
persists steering requests and reads run/thread details; it does not execute
instructions or interrupt a Codex process. The UI keeps requests queued and
labels the missing worker connection. An interrupt submission is described as
requested until the server acknowledges it, never as successfully delivered.

The future scheduler must:

1. Claim null-run requests for the next approved snapshot once, checking that
   the task still exists and is appropriate for that snapshot. Atomically bind
   the request to the run so it cannot replay in subsequent runs.
2. Check queued state and task/run status transactionally before delivery,
   respecting cancellation and rejecting stale or invalid task references.
3. Apply `next` instructions at the next step, and process `now` requests through
   the runtime's interruption mechanism. Mark `applied` only on acknowledgement;
   otherwise retain `queued` or publish `rejected`.
4. Publish `Run` data from `shared/types.ts` into `rooms/{roomId}/runs/{runId}`,
   including `createdAt`, tasks, task thread/worker IDs, timestamps, output/errors,
   and task-scoped events. The Firestore document ID is the canonical run ID.

Approvals remain immutable snapshots. Steering is a separate instruction log;
queuing a note does not rewrite the approved plan or claim implementation success.
