import { Fragment, type JSX } from "react";
import { blockKind, unwrapFencedCodeLines } from "./blocks";

export interface LinkTarget {
  readonly title: string;
  readonly resolved: boolean;
}

export type InlineToken =
  | { readonly type: "text"; readonly value: string }
  | { readonly type: "bold"; readonly value: string }
  | { readonly type: "italic"; readonly value: string }
  | { readonly type: "code"; readonly value: string }
  | { readonly type: "link"; readonly text: string; readonly href: string }
  | { readonly type: "wikilink"; readonly title: string; readonly alias?: string };

type ParsedToken = { readonly token: InlineToken; readonly nextIndex: number };

function hasNewlineBefore(text: string, start: number, end: number): boolean {
  const nextNl = text.indexOf("\n", start);
  return nextNl !== -1 && nextNl < end;
}

function tryParseCode(text: string, i: number): ParsedToken | null {
  if (text[i] !== "`") return null;
  const close = text.indexOf("`", i + 1);
  if (close > i + 1 && !hasNewlineBefore(text, i, close)) {
    return {
      token: { type: "code", value: text.slice(i + 1, close) },
      nextIndex: close + 1,
    };
  }
  return null;
}

function tryParseWikilink(text: string, i: number): ParsedToken | null {
  if (!text.startsWith("[[", i)) return null;
  const close = text.indexOf("]]", i + 2);
  if (close === -1 || hasNewlineBefore(text, i, close)) return null;

  const inner = text.slice(i + 2, close);
  const pipeIdx = inner.indexOf("|");
  const title = (pipeIdx !== -1 ? inner.slice(0, pipeIdx) : inner).trim();
  const alias = pipeIdx !== -1 ? inner.slice(pipeIdx + 1).trim() || undefined : undefined;

  if (title.length === 0) return null;
  return {
    token: alias !== undefined ? { type: "wikilink", title, alias } : { type: "wikilink", title },
    nextIndex: close + 2,
  };
}

function tryParseLink(text: string, i: number): ParsedToken | null {
  if (text[i] !== "[" || text.startsWith("[[", i)) return null;
  const closeBracket = text.indexOf("]", i + 1);
  if (closeBracket === -1 || hasNewlineBefore(text, i, closeBracket)) return null;
  if (text[closeBracket + 1] !== "(") return null;

  const closeParen = text.indexOf(")", closeBracket + 2);
  if (closeParen === -1 || hasNewlineBefore(text, i, closeParen)) return null;

  return {
    token: {
      type: "link",
      text: text.slice(i + 1, closeBracket),
      href: text.slice(closeBracket + 2, closeParen).trim(),
    },
    nextIndex: closeParen + 1,
  };
}

function tryParseBold(text: string, i: number): ParsedToken | null {
  if (!text.startsWith("**", i)) return null;
  const close = text.indexOf("**", i + 2);
  if (close > i + 2 && !hasNewlineBefore(text, i, close)) {
    return {
      token: { type: "bold", value: text.slice(i + 2, close) },
      nextIndex: close + 2,
    };
  }
  return null;
}

function tryParseAsteriskItalic(text: string, i: number): ParsedToken | null {
  if (text[i] !== "*" || text.startsWith("**", i)) return null;
  const close = text.indexOf("*", i + 1);
  if (
    close > i + 1 &&
    text[close + 1] !== "*" &&
    !hasNewlineBefore(text, i, close)
  ) {
    return {
      token: { type: "italic", value: text.slice(i + 1, close) },
      nextIndex: close + 1,
    };
  }
  return null;
}

function tryParseUnderscoreItalic(text: string, i: number, len: number): ParsedToken | null {
  if (text[i] !== "_") return null;
  if (i > 0 && /\w/.test(text[i - 1])) return null;

  const close = text.indexOf("_", i + 1);
  if (close <= i + 1 || hasNewlineBefore(text, i, close)) return null;

  const isWordCharAfter = close + 1 < len && /\w/.test(text[close + 1]);
  if (isWordCharAfter) return null;

  return {
    token: { type: "italic", value: text.slice(i + 1, close) },
    nextIndex: close + 1,
  };
}

function parseNextInlineToken(text: string, i: number, len: number): ParsedToken | null {
  const char = text[i];
  if (char === "`") return tryParseCode(text, i);
  if (char === "[") return tryParseWikilink(text, i) ?? tryParseLink(text, i);
  if (char === "*") return tryParseBold(text, i) ?? tryParseAsteriskItalic(text, i);
  if (char === "_") return tryParseUnderscoreItalic(text, i, len);
  return null;
}

/**
 * Parses inline Markdown tokens: bold, italic, code, links, wikilinks, and plain text.
 * Leaves unclosed syntax as plain text.
 */
export function inlineTokens(text: string): InlineToken[] {
  if (!text) {
    return [];
  }

  const tokens: InlineToken[] = [];
  let textBuffer = "";
  let i = 0;
  const len = text.length;

  function flushText(): void {
    if (textBuffer.length > 0) {
      tokens.push({ type: "text", value: textBuffer });
      textBuffer = "";
    }
  }

  while (i < len) {
    const match = parseNextInlineToken(text, i, len);
    if (match) {
      flushText();
      tokens.push(match.token);
      i = match.nextIndex;
    } else {
      textBuffer += text[i];
      i++;
    }
  }

  flushText();
  return tokens;
}

function isHttpUrl(href: string): boolean {
  try {
    const parsed = new URL(href);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return /^https?:\/\//i.test(href);
  }
}

type PreviewProps = Readonly<{
  text: string;
  isResolved: (title: string) => boolean;
  onOpenLink: (title: string) => void;
  onOpenUrl: (href: string) => void;
  onToggleTodo: (line: number) => void;
}>;

let elementKeyCounter = 0;
function nextKey(prefix: string): string {
  return `${prefix}-${++elementKeyCounter}`;
}

function renderInline(text: string, props: PreviewProps): JSX.Element[] {
  const tokens = inlineTokens(text);
  return tokens.map((token) => {
    const key = nextKey("token");
    switch (token.type) {
      case "text":
        return <Fragment key={key}>{token.value}</Fragment>;
      case "bold":
        return (
          <strong key={key} className="font-semibold text-ink">
            {token.value}
          </strong>
        );
      case "italic":
        return (
          <em key={key} className="italic text-ink">
            {token.value}
          </em>
        );
      case "code":
        return (
          <code
            key={key}
            className="rounded bg-stage px-1.5 py-0.5 font-mono text-[0.9em] text-ink"
          >
            {token.value}
          </code>
        );
      case "link": {
        if (!isHttpUrl(token.href)) {
          return <Fragment key={key}>{token.text}</Fragment>;
        }
        return (
          <a
            key={key}
            href={token.href}
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              props.onOpenUrl(token.href);
            }}
            className="cursor-pointer text-accent underline underline-offset-2 hover:text-accent-hover"
          >
            {token.text}
          </a>
        );
      }
      case "wikilink": {
        const resolved = props.isResolved(token.title);
        const displayText = token.alias ?? token.title;
        return (
          <button
            key={key}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              props.onOpenLink(token.title);
            }}
            className={
              resolved
                ? "cursor-pointer text-accent underline underline-offset-2 hover:text-accent-hover"
                : "cursor-pointer text-muted underline decoration-dashed border-b border-dashed border-muted underline-offset-2 hover:text-ink"
            }
          >
            {displayText}
          </button>
        );
      }
    }
  });
}

/**
 * Pure block preview renderer.
 * Renders Markdown blocks without dangerouslySetInnerHTML.
 */
export function BlockPreview(props: PreviewProps): JSX.Element {
  const kind = blockKind(props.text);

  switch (kind) {
    case "heading1": {
      const content = props.text.replace(/^#+\s*/, "");
      return (
        <h2 className="m-0 font-display text-xl font-semibold text-ink">
          {renderInline(content, props)}
        </h2>
      );
    }
    case "heading2": {
      const content = props.text.replace(/^##\s*/, "");
      return (
        <h3 className="m-0 font-display text-lg font-semibold text-ink">
          {renderInline(content, props)}
        </h3>
      );
    }
    case "heading3": {
      const content = props.text.replace(/^###\s*/, "");
      return (
        <h4 className="m-0 font-display text-base font-semibold text-ink">
          {renderInline(content, props)}
        </h4>
      );
    }
    case "bullet": {
      const lines = props.text.split("\n");
      return (
        <ul className="m-0 list-disc pl-5 text-ink space-y-1">
          {lines.map((line) => (
            <li key={nextKey("bullet")} className="leading-relaxed">
              {renderInline(line.replace(/^\s*[-*+]\s*/, ""), props)}
            </li>
          ))}
        </ul>
      );
    }
    case "numbered": {
      const lines = props.text.split("\n");
      return (
        <ol className="m-0 list-decimal pl-5 text-ink space-y-1">
          {lines.map((line) => (
            <li key={nextKey("num")} className="leading-relaxed">
              {renderInline(line.replace(/^\s*\d+\.\s*/, ""), props)}
            </li>
          ))}
        </ol>
      );
    }
    case "todo": {
      const lines = props.text.split("\n");
      return (
        <ul className="m-0 list-none p-0 space-y-1">
          {lines.map((line, lineIndex) => {
            const match = /^\s*(?:[-*+]\s+)?\[([ xX])\]\s?/.exec(line);
            const key = nextKey("todo");
            if (!match) {
              return (
                <li key={key} className="leading-relaxed text-ink pl-6">
                  {renderInline(line, props)}
                </li>
              );
            }
            const checked = match[1].toLowerCase() === "x";
            const content = line.slice(match[0].length);
            return (
              <li key={key} className="flex items-start gap-2 leading-relaxed">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => {
                    props.onToggleTodo(lineIndex);
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                  }}
                  className="mt-1 h-4 w-4 rounded border-line bg-surface text-accent accent-accent focus:ring-accent cursor-pointer"
                />
                <span className={checked ? "text-done line-through" : "text-ink"}>
                  {renderInline(content, props)}
                </span>
              </li>
            );
          })}
        </ul>
      );
    }
    case "quote": {
      const lines = props.text.split("\n");
      return (
        <blockquote className="m-0 border-l-2 border-line pl-3.5 italic text-muted space-y-1">
          {lines.map((line) => (
            <p key={nextKey("quote")} className="m-0 leading-relaxed">
              {renderInline(line.replace(/^\s*>\s?/, ""), props)}
            </p>
          ))}
        </blockquote>
      );
    }
    case "code": {
      const innerLines = unwrapFencedCodeLines(props.text.split("\n"));
      const codeContent = innerLines.join("\n");
      return (
        <pre className="m-0 overflow-x-auto rounded-[10px] bg-stage p-3 font-mono text-sm text-ink">
          <code>{codeContent}</code>
        </pre>
      );
    }
    case "paragraph":
    default:
      return (
        <p className="m-0 leading-relaxed text-ink text-[15px] whitespace-pre-wrap">
          {renderInline(props.text, props)}
        </p>
      );
  }
}
