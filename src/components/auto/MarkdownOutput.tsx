'use client';

import { useMemo } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';

interface MarkdownOutputProps {
  text: string;
}

export function MarkdownOutput({ text }: MarkdownOutputProps) {
  const components = useMemo(() => ({
    code({ className, children, ...props }: React.ComponentProps<'code'> & { inline?: boolean }) {
      const match = /language-(\w+)/.exec(className || '');
      const codeString = String(children).replace(/\n$/, '');

      if (match) {
        return (
          <SyntaxHighlighter
            style={oneDark}
            language={match[1]}
            PreTag="div"
            customStyle={{ margin: '0.25rem 0', borderRadius: '0.375rem', fontSize: '0.8rem' }}
          >
            {codeString}
          </SyntaxHighlighter>
        );
      }

      // Inline code
      return (
        <code
          className="rounded px-1 py-0.5 text-gray-100"
          style={{ backgroundColor: '#2D2D2D' }}
          {...props}
        >
          {children}
        </code>
      );
    },
    pre({ children }: React.ComponentProps<'pre'>) {
      // SyntaxHighlighter renders its own <pre>, so just pass through
      return <>{children}</>;
    },
    h1({ children }: React.ComponentProps<'h1'>) {
      return <div className="text-base font-bold text-white mt-2 mb-1">{children}</div>;
    },
    h2({ children }: React.ComponentProps<'h2'>) {
      return <div className="text-sm font-bold text-white mt-2 mb-1">{children}</div>;
    },
    h3({ children }: React.ComponentProps<'h3'>) {
      return <div className="text-sm font-bold text-white mt-1 mb-0.5">{children}</div>;
    },
    p({ children }: React.ComponentProps<'p'>) {
      return <p className="my-0.5">{children}</p>;
    },
    ul({ children }: React.ComponentProps<'ul'>) {
      return <ul className="ml-4 list-disc space-y-0.5">{children}</ul>;
    },
    ol({ children }: React.ComponentProps<'ol'>) {
      return <ol className="ml-4 list-decimal space-y-0.5">{children}</ol>;
    },
    li({ children }: React.ComponentProps<'li'>) {
      return <li className="text-gray-300">{children}</li>;
    },
    table({ children }: React.ComponentProps<'table'>) {
      return (
        <div className="my-1 overflow-x-auto">
          <table className="min-w-full text-sm border-collapse border border-gray-600">{children}</table>
        </div>
      );
    },
    th({ children }: React.ComponentProps<'th'>) {
      return <th className="border border-gray-600 bg-gray-700 px-2 py-1 text-left text-gray-200">{children}</th>;
    },
    td({ children }: React.ComponentProps<'td'>) {
      return <td className="border border-gray-600 px-2 py-1 text-gray-300">{children}</td>;
    },
    strong({ children }: React.ComponentProps<'strong'>) {
      return <strong className="font-bold text-white">{children}</strong>;
    },
    a({ href, children }: React.ComponentProps<'a'>) {
      return <a href={href} className="text-blue-400 underline" target="_blank" rel="noopener noreferrer">{children}</a>;
    },
    blockquote({ children }: React.ComponentProps<'blockquote'>) {
      return <blockquote className="border-l-2 border-gray-500 pl-3 text-gray-400 my-1">{children}</blockquote>;
    },
    hr() {
      return <hr className="my-2 border-gray-600" />;
    },
  }), []);

  return (
    <Markdown remarkPlugins={[remarkGfm]} components={components}>
      {text}
    </Markdown>
  );
}
