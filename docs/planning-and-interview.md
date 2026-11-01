# Plan document and continuing interview

The shared plan opens as rendered Markdown. Headings, lists, tables, checklists,
links, and code blocks are supported. Members can select **Edit plan** to change
the original Markdown with the existing collaborative editor, then **Done editing**
to return to the document. Raw HTML is skipped and executable link protocols are
filtered by the Markdown renderer.

## Interview history

**Grill me** opens the next question. Each submitted answer is saved with the
exact question, its title, the author, and a server timestamp. The full transcript
appears at the bottom of the plan and updates for other viewers in real time.
It is not limited to the last 100 room messages, and editing the plan body does
not rewrite the transcript.

The interview starts with four foundation questions, continues through deeper
product/implementation prompts, and then revisits topics using the most recent
saved answer for each topic. These are guided prompts and contextual refinements,
not live model-generated questions. There is no four-answer completion/reset.

Pausing keeps the current question and answer draft in the open room. Room chat
has a separate draft. Reloading or reopening the room resumes after the highest
saved question index. Concurrent answers to the same question are both kept and
do not cause the next question to be skipped. A question already being answered
does not change when a teammate replies.

## Persistence and access

Entries are immutable documents at `rooms/{roomId}/interviews/{entryId}`:

- `questionIndex`, `title`, `question`: the exact prompt that was answered.
- `answer`: the trimmed response, up to 8,000 characters.
- `authorUid`, `authorName`, `createdAt`: attribution and server time.

The transcript entry and its room message share an ID and are written in one
Firestore batch. Rules require the matching new message in that batch, so a
failed transcript write cannot leave only a chat reply. The existing two-member,
verified-email editing boundary applies. Public viewers can read the transcript;
browser clients cannot change or delete saved answers.

Plan text already stored in the collaborative document remains intact. New
interview answers are kept separately rather than mixed into editable sections.

## Approval snapshots

Approvals serialize the current plan body and complete transcript as Markdown.
A new interview answer therefore changes the draft relative to an approved
snapshot, and workers consuming the approved plan receive the interview context.
Approval waits until the transcript has loaded from the server and pending
answers have saved. The existing 200,000-character approval limit remains; the
full transcript stays saved even when a snapshot exceeds that limit.

Validation covers Markdown rendering and unsafe content, continuing/refinement
progress, concurrency-safe resume, full transcript snapshots, atomic paired
writes, attribution, size limits, and transcript immutability.
