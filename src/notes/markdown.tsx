import { Fragment, type JSX } from "react";
import { blockKind } from "./blocks";

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
    const char = text[i];

    // Inline code: `code`
    if (char === "`") {
      const close = text.indexOf("`", i + 1);
      const nextNl = text.indexOf("\n", i);
      if (close !== -1 && (nextNl === -1 || close < nextNl) && close > i + 1) {
        flushText();
        tokens.push({ type: "code", value: text.slice(i + 1, close) });
        i = close + 1;
        continue;
      }
    }

    // Wikilink: [[title]] or [[title|alias]]
    if (char === "[" && text.startsWith("[[", i)) {
      const close = text.indexOf("]]", i + 2);
      const nextNl = text.indexOf("\n", i);
      if (close !== -1 && (nextNl === -1 || close < nextNl)) {
        const inner = text.slice(i + 2, close);
        const pipeIdx = inner.indexOf("|");
        let title: string;
        let alias: string | undefined;
        if (pipeIdx !== -1) {
          title = inner.slice(0, pipeIdx).trim();
          alias = inner.slice(pipeIdx + 1).trim() || undefined;
        } else {
          title = inner.trim();
          alias = undefined;
        }

        if (title.length > 0) {
          flushText();
          tokens.push(
            alias !== undefined
              ? { type: "wikilink", title, alias }
              : { type: "wikilink", title },
          );
          i = close + 2;
          continue;
        }
      }
    }

    // Markdown link: [text](href)
    if (char === "[" && !text.startsWith("[[", i)) {
      const closeBracket = text.indexOf("]", i + 1);
      const nextNl = text.indexOf("\n", i);
      if (
        closeBracket !== -1 &&
        (nextNl === -1 || closeBracket < nextNl) &&
        text[closeBracket + 1] === "("
      ) {
        const closeParen = text.indexOf(")", closeBracket + 2);
        if (closeParen !== -1 && (nextNl === -1 || closeParen < nextNl)) {
          const linkText = text.slice(i + 1, closeBracket);
          const href = text.slice(closeBracket + 2, closeParen).trim();
          flushText();
          tokens.push({ type: "link", text: linkText, href });
          i = closeParen + 1;
          continue;
        }
      }
    }

    // Bold: **bold**
    if (char === "*" && text.startsWith("**", i)) {
      const close = text.indexOf("**", i + 2);
      const nextNl = text.indexOf("\n", i);
      if (close !== -1 && (nextNl === -1 || close < nextNl) && close > i + 2) {
        flushText();
        tokens.push({ type: "bold", value: text.slice(i + 2, close) });
        i = close + 2;
        continue;
      }
    }

    // Italic: *italic*
    if (char === "*" && !text.startsWith("**", i)) {
      const close = text.indexOf("*", i + 1);
      const nextNl = text.indexOf("\n", i);
      if (
        close !== -1 &&
        (nextNl === -1 || close < nextNl) &&
        close > i + 1 &&
        text[close + 1] !== "*"
      ) {
        flushText();
        tokens.push({ type: "italic", value: text.slice(i + 1, close) });
        i = close + 1;
        continue;
      }
    }

    // Italic: _italic_ (not inside snake_case words)
    if (char === "_") {
      const isWordCharBefore = i > 0 && /\w/.test(text[i - 1]);
      if (!isWordCharBefore) {
        const close = text.indexOf("_", i + 1);
        const nextNl = text.indexOf("\n", i);
        const isWordCharAfter =
          close !== -1 && close + 1 < len && /\w/.test(text[close + 1]);
        if (
          close !== -1 &&
          (nextNl === -1 || close < nextNl) &&
          close > i + 1 &&
          !isWordCharAfter
        ) {
          flushText();
          tokens.push({ type: "italic", value: text.slice(i + 1, close) });
          i = close + 1;
          continue;
        }
      }
    }

    textBuffer += char;
    i++;
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

function renderInline(text: string, props: PreviewProps): JSX.Element[] {
  const tokens = inlineTokens(text);
  return tokens.map((token, idx) => {
    switch (token.type) {
      case "text":
        return <Fragment key={idx}>{token.value}</Fragment>;
      case "bold":
        return (
          <strong key={idx} className="font-semibold text-ink">
            {token.value}
          </strong>
        );
      case "italic":
        return (
          <em key={idx} className="italic text-ink">
            {token.value}
          </em>
        );
      case "code":
        return (
          <code
            key={idx}
            className="rounded bg-stage px-1.5 py-0.5 font-mono text-[0.9em] text-ink"
          >
            {token.value}
          </code>
        );
      case "link": {
        if (!isHttpUrl(token.href)) {
          return <Fragment key={idx}>{token.text}</Fragment>;
        }
        return (
          <a
            key={idx}
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
            key={idx}
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
          {lines.map((line, idx) => (
            <li key={idx} className="leading-relaxed">
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
          {lines.map((line, idx) => (
            <li key={idx} className="leading-relaxed">
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
          {lines.map((line, idx) => {
            const match = line.match(/^(\s*(?:[-*+]\s+)?)\[([ xX])\]\s*(.*)$/);
            if (!match) {
              return (
                <li key={idx} className="leading-relaxed text-ink pl-6">
                  {renderInline(line, props)}
                </li>
              );
            }
            const checked = match[2].toLowerCase() === "x";
            const content = match[3];
            return (
              <li key={idx} className="flex items-start gap-2 leading-relaxed">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => {
                    props.onToggleTodo(idx);
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
          {lines.map((line, idx) => (
            <p key={idx} className="m-0 leading-relaxed">
              {renderInline(line.replace(/^\s*>\s?/, ""), props)}
            </p>
          ))}
        </blockquote>
      );
    }
    case "code": {
      const lines = props.text.split("\n");
      let innerLines: string[];
      if (
        lines.length > 0 &&
        lines[0].trimStart().startsWith("```")
      ) {
        if (
          lines.length > 1 &&
          lines[lines.length - 1].trimStart().startsWith("```")
        ) {
          innerLines = lines.slice(1, -1);
        } else {
          innerLines = lines.slice(1);
        }
      } else {
        innerLines = lines;
      }
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
