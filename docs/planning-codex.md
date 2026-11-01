# Codex in the planning conversation

Each new member message (including interview answers) atomically saves a planning
request. The authenticated Linux worker polls the control plane, receives a fenced
lease, and runs Codex app-server in a disposable container. The result is saved as
an AI-labelled Codex message in the same room. Existing messages are not replayed,
and Codex messages do not enqueue more replies.

Context contains the plan and interview snapshot visible to the sender (up to
60,000 characters), the target message, and up to 30 recent messages. Earlier
messages are bounded to 2,000 characters each. Each turn starts a fresh Codex
thread with that context; the room's Firestore conversation is the durable history.
This feature discusses the plan; it does not apply document edits or run tasks.

Planning uses the existing worker identity, machine gateway and inference proxy.
The real API key stays on the control plane. Planning capabilities remove model
tools and cap output at 4,096 tokens. The container has no repository or persistent
volume, and a three-minute execution limit. JSON-RPC calls follow the official
[Codex app-server protocol](https://learn.chatgpt.com/docs/app-server).

The current VM worker executes one job at a time. Planning requests have priority
between coding tasks, but do not interrupt an active coding task. Requests are
ordered by creation time, with a room lease to prevent concurrent room replies.
Membership is checked on claim and report. Transactional fences and a reserved
deterministic message ID prevent duplicate replies. Expired attempts fail visibly
and release their room when the assigned worker reconnects; they are not silently
replayed. A new member message requests another reply. A permanently removed
worker's outstanding lease requires administrative recovery.

The chat shows queued, replying, and failed states. API/model failures never become
successful-looking messages. GitHub Actions deploys the Firestore queue index,
rules, frontend, control plane, and executor image. During deployment, queued work
waits for the worker and index to become ready.
