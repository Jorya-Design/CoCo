# Live plan collaboration — work in progress

The editable plan binds directly to the existing Y.Text through the supported
Yjs/CodeMirror binding. Relative selections, named collaborator cursors, and
local undo are handled by the editor binding. Rendered Markdown remains the
reading view. Cursor awareness is transient, member-owned Firestore data;
leaving editing clears the selection, stale sessions expire, and document
updates continue to use the durable append-only update log.

## Codex adapter boundary

`shared/plan-edits.ts` is a domain contract, not a worker wire protocol.
`capturePlanContext` captures the actual current Markdown and state vector.
`anchorPlanEdit` binds a proposed change to relative CRDT positions.
`applyPlanEdits` resolves every range against current content, checks the
original text, and applies the proposal atomically. A conflicting human edit
rejects the whole proposal; unrelated changes are preserved.

The runtime is being developed independently. Its adapter must load the latest
room document and interview/chat context, authenticate requests as members,
translate Codex responses into anchored proposals, and publish actual agent
status. The editor must show preview/accept/reject for suggestions and use the
same checked application function for explicitly requested direct edits.

Remaining before release: connect and validate that adapter against the current
runtime protocol; implement actual chat/proposal UI; verify two-browser cursor
behavior and rich document editing UX. This branch is not a completed AI chat
integration and should not be deployed as one.
