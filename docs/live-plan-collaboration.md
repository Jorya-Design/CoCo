# Shared plan and Codex chat

The canonical plan is a Y.Text document. Firestore carries immutable Yjs updates; the default reading view renders Markdown. Edit plan opens a collaborative Markdown editor with formatting tools and named live cursors. Interview history remains below the plan and grows as Grill me continues.

## Chat modes

- **Ask about the plan** gives Codex the latest saved plan, the most recent 30 chat messages, and up to 100 recent interview answers. It cannot edit the plan.
- **Suggest changes** produces a before/after preview with Accept and Dismiss actions. The editor underlines passages with pending suggestions.
- **Edit the plan** authorizes direct edits for that request. Changes appear in both members' documents through the same CRDT transport.
- **Team only** sends a normal message without invoking Codex.

Interview answers also queue a discussion reply through the planning runtime integrated from PR #15. Explicit chat modes queue only one request; Team only suppresses the automatic reply.

Queued and running requests can be cancelled by either member. Activity reflects actual worker states and includes the Codex thread ID. Offline workers leave requests visibly queued; failures and conflicting edits show an explanation. The AI sees a snapshot taken when the worker claims the request. Later human changes are checked before applying its output.

## Runtime adapter

`control-plane/plan-agent.ts` translates Firestore planning intents into ordinary worker jobs with an optional `planning` context. Coding jobs keep their existing protocol. The same authenticated machine gateway, fenced shared worker lease, disposable Docker container, and short-lived inference capability are used. Planning containers have an ephemeral document workspace, no repository mount, and an inference capability with tools disabled. No API key or worker credential reaches the browser. Planning containers skip repository fetch and return structured output through Codex app-server `turn/start.outputSchema`; only the control plane may publish AI replies and edit payloads.

The model returns unique exact before/after passages. The adapter anchors them in the captured Yjs document using relative positions. Applying resolves those anchors against the latest document in a Firestore transaction. Unrelated edits survive. A change inside any proposed passage blocks the entire proposal. Review decisions are checked against current organization membership. Cancelled, expired, or stale attempts cannot publish a result. Private captured contexts are removed on completion/cancellation/expiry.

Keep worker protocol changes isolated to this adapter and `shared/plan-prompt.ts`; do not couple editor components to Codex wire events. The model response is bounded to 16,000 characters; edits are limited to 20 passages. Plans over 120,000 characters or captured histories over 700 KB fail visibly rather than silently dropping document context. Conversation and interview excerpts are bounded to 50,000 and 70,000 characters respectively.

## Validation

`npm test` covers CRDT range conflict checks and the existing runtime boundaries. `npm run test:rules` covers client permissions, planning leases/results/review, cancellation, concurrent human changes, and two authenticated Firestore clients exchanging edits and named cursor awareness and reloading durable state. Browser acceptance should also check two signed-in members in the same room, suggestion preview/acceptance, direct edits, and a continued interview. These browser checks use local emulator accounts, never stored production passwords.

## Final planning stage

Rooms start with a title and no implementation tasks. Once the room agrees on the shared plan, **Agree & create implementation plan** sends its exact saved text and complete interview history to Codex. Codex subdivides that scope into concrete tasks with dependencies and acceptance checks; there is no default task graph.

The server validates the graph and saves an immutable record in `rooms/{roomId}/implementationPlans/{requestId}`. Changes to the plan or interview during generation cause a visible conflict. Later changes require regeneration before approval. Approvals must match a server-generated record exactly, and the scheduler checks that provenance before starting a new run. Historical runs remain available.
