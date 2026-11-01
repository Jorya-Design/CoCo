import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Markdown } from '../apps/web/src/components/markdown.tsx';

const render = (source: string) => renderToStaticMarkup(createElement(Markdown, { children: source }));

test('plans render headings, lists, tables, checklists, and code', () => {
  const html = render('# Plan\n\n- **A useful result**\n\n- [x] Verified\n\n| Task | Owner |\n| --- | --- |\n| Build | Team |\n\n```ts\nconst ready = true;\n```');
  for (const pattern of [/<h1>Plan<\/h1>/, /<strong>A useful result<\/strong>/, /<table>/, /type="checkbox"/, /<pre><code class="language-ts">/]) assert.match(html, pattern);
});

test('untrusted plan text cannot inject raw HTML or executable links', () => {
  const html = render('<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">\n\n[Unsafe](javascript:alert%281%29)\n\n[Docs](https://example.com)');
  assert.doesNotMatch(html, /<script|onerror=|href="javascript:/i);
  assert.match(html, /href="https:\/\/example.com"/);
  assert.match(html, /rel="noreferrer noopener"/);
});
