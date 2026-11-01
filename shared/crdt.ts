import * as Y from 'yjs';

/** Change only the edited range, retaining the CRDT identities of surrounding text. */
export function replaceText(text: Y.Text, next: string) {
  const previous = text.toString();
  let start = 0;
  while (start < previous.length && start < next.length && previous[start] === next[start]) start++;
  let end = 0;
  while (end < previous.length - start && end < next.length - start
    && previous[previous.length - 1 - end] === next[next.length - 1 - end]) end++;
  text.doc!.transact(() => {
    const removed = previous.length - start - end;
    if (removed) text.delete(start, removed);
    const inserted = next.slice(start, next.length - end);
    if (inserted) text.insert(start, inserted);
  }, 'local');
}
