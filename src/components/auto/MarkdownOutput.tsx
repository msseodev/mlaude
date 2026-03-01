'use client';

import { useMemo } from 'react';

interface MarkdownOutputProps {
  text: string;
}

type Block =
  | { kind: 'code'; lang: string; content: string }
  | { kind: 'lines'; lines: string[] };

function parseBlocks(text: string): Block[] {
  const rawLines = text.split('\n');
  const blocks: Block[] = [];
  let currentLines: string[] = [];
  let inCode = false;
  let codeLang = '';
  let codeLines: string[] = [];

  for (const line of rawLines) {
    if (!inCode) {
      const fenceMatch = line.match(/^```(\w*)$/);
      if (fenceMatch) {
        // Flush accumulated plain lines
        if (currentLines.length > 0) {
          blocks.push({ kind: 'lines', lines: currentLines });
          currentLines = [];
        }
        inCode = true;
        codeLang = fenceMatch[1];
        codeLines = [];
      } else {
        currentLines.push(line);
      }
    } else {
      if (line.match(/^```$/)) {
        blocks.push({ kind: 'code', lang: codeLang, content: codeLines.join('\n') });
        inCode = false;
        codeLang = '';
        codeLines = [];
      } else {
        codeLines.push(line);
      }
    }
  }

  // Handle unclosed code block
  if (inCode) {
    blocks.push({ kind: 'code', lang: codeLang, content: codeLines.join('\n') });
  }

  // Flush remaining plain lines
  if (currentLines.length > 0) {
    blocks.push({ kind: 'lines', lines: currentLines });
  }

  return blocks;
}

function renderInline(text: string): React.ReactNode[] {
  // Process inline code and bold markers
  const nodes: React.ReactNode[] = [];
  // Pattern: `code` or **bold**
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    // Text before the match
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    const token = match[0];
    if (token.startsWith('`')) {
      // Inline code
      nodes.push(
        <code
          key={match.index}
          className="rounded px-1 py-0.5"
          style={{ backgroundColor: '#2D2D2D' }}
        >
          {token.slice(1, -1)}
        </code>
      );
    } else if (token.startsWith('**')) {
      // Bold
      nodes.push(
        <strong key={match.index} className="font-bold text-white">
          {token.slice(2, -2)}
        </strong>
      );
    }
    lastIndex = match.index + token.length;
  }

  // Remaining text
  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}

function renderLine(line: string, index: number): React.ReactNode {
  // Headers
  const headerMatch = line.match(/^(#{1,3})\s+(.+)$/);
  if (headerMatch) {
    const level = headerMatch[1].length;
    const content = headerMatch[2];
    const sizeClass = level === 1 ? 'text-base' : level === 2 ? 'text-sm' : 'text-sm';
    return (
      <div key={index} className={`${sizeClass} font-bold text-white`}>
        {renderInline(content)}
      </div>
    );
  }

  // List items (- or *)
  const listMatch = line.match(/^(\s*)[*-]\s+(.+)$/);
  if (listMatch) {
    const indent = listMatch[1].length;
    const content = listMatch[2];
    return (
      <div key={index} className="flex" style={{ paddingLeft: `${1 + indent * 0.5}rem` }}>
        <span className="mr-2 select-none text-gray-500">&bull;</span>
        <span>{renderInline(content)}</span>
      </div>
    );
  }

  // Empty line
  if (line === '') {
    return <div key={index} className="h-1" />;
  }

  // Regular text with inline formatting
  return <span key={index}>{renderInline(line)}{'\n'}</span>;
}

export function MarkdownOutput({ text }: MarkdownOutputProps) {
  const rendered = useMemo(() => {
    const blocks = parseBlocks(text);
    const elements: React.ReactNode[] = [];
    let lineKey = 0;

    for (const block of blocks) {
      if (block.kind === 'code') {
        elements.push(
          <pre
            key={`code-${lineKey++}`}
            className="my-1 overflow-x-auto rounded p-2 text-gray-100"
            style={{ backgroundColor: '#2D2D2D' }}
          >
            {block.content}
          </pre>
        );
      } else {
        for (const line of block.lines) {
          elements.push(renderLine(line, lineKey++));
        }
      }
    }

    return elements;
  }, [text]);

  return <>{rendered}</>;
}
