import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export function Markdown({ children, compact = false }: { children: string; compact?: boolean }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={{
    a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noreferrer noopener"/>,
    table: ({ node: _node, ...props }) => <div className="markdown-table"><table {...props}/></div>,
    h1: ({ node: _node, ...props }) => compact ? <h4 {...props}/> : <h1 {...props}/>,
    h2: ({ node: _node, ...props }) => compact ? <h4 {...props}/> : <h2 {...props}/>,
    h3: ({ node: _node, ...props }) => compact ? <h4 {...props}/> : <h3 {...props}/>,
  }}>{children}</ReactMarkdown>;
}
