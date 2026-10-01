// Pure model and operations for Markdown blocks (spec Fase 4B §5).

export type BlockKind =
  | "paragraph"
  | "heading1"
  | "heading2"
  | "heading3"
  | "bullet"
  | "numbered"
  | "todo"
  | "quote"
  | "code";

export interface Block {
  readonly id: number;
  readonly text: string;
}

let nextBlockId = 1;

/** Resets the module-level counter for predictable unit tests. */
export function resetBlockIdCounterForTests(start = 1): void {
  nextBlockId = start;
}

function nextId(): number {
  return nextBlockId++;
}

/**
 * Splits Markdown body into distinct blocks separated by blank lines.
 * Fenced code blocks (```) remain intact even if they contain blank lines.
 * Returns an empty array when body is empty or whitespace-only.
 */
export function splitBlocks(body: string): Block[] {
  if (!body || body.trim() === "") {
    return [];
  }
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  // Length of the open fence's backtick run; 0 outside a fence. A fence closes
  // only on a line of at least as many backticks and nothing else (CommonMark).
  let fence = 0;
  let currentLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const ticks = /^\s{0,3}(`{3,})/.exec(line)?.[1].length ?? 0;
    const isFence = ticks > 0;

    if (fence > 0) {
      currentLines.push(line);
      if (ticks >= fence && /^\s*`+\s*$/.test(line)) {
        fence = 0;
        blocks.push({ id: nextId(), text: currentLines.join("\n") });
        currentLines = [];
      }
    } else if (isFence) {
      if (currentLines.length > 0) {
        blocks.push({ id: nextId(), text: currentLines.join("\n") });
        currentLines = [];
      }
      fence = ticks;
      currentLines.push(line);
    } else if (line.trim() === "") {
      if (currentLines.length > 0) {
        blocks.push({ id: nextId(), text: currentLines.join("\n") });
        currentLines = [];
      }
    } else {
      currentLines.push(line);
    }
  }

  if (currentLines.length > 0) {
    blocks.push({ id: nextId(), text: currentLines.join("\n") });
  }

  return blocks;
}

/**
 * Joins blocks into Markdown text separated by double newlines.
 * Drops trailing empty blocks so the saved body has no trailing blank blocks.
 */
export function joinBlocks(blocks: readonly Block[]): string {
  let end = blocks.length;
  while (end > 0 && blocks[end - 1].text.trim() === "") {
    end--;
  }
  return blocks
    .slice(0, end)
    .map((b) => b.text)
    .join("\n\n");
}

/**
 * Determines block kind from its first line.
 */
export function blockKind(text: string): BlockKind {
  const firstLine = text.split("\n")[0] ?? "";
  const trimmed = firstLine.trimStart();

  if (trimmed.startsWith("```")) {
    return "code";
  }
  if (/^###(\s+|$)/.test(trimmed)) {
    return "heading3";
  }
  if (/^##(\s+|$)/.test(trimmed)) {
    return "heading2";
  }
  if (/^#(\s+|$)/.test(trimmed)) {
    return "heading1";
  }
  if (/^>(\s+|$)/.test(trimmed)) {
    return "quote";
  }
  if (/^(?:[-*+]\s+)?\[[ xX]\](\s+|$)/.test(trimmed)) {
    return "todo";
  }
  if (/^[-*+](\s+|$)/.test(trimmed)) {
    return "bullet";
  }
  if (/^\d+\.(\s+|$)/.test(trimmed)) {
    return "numbered";
  }
  return "paragraph";
}

/**
 * Handles Enter key at caret:
 * - Paragraph, headings, quotes: split into before and after (heading markers not copied to after).
 * - Bullet, numbered, todo: continue the list; empty list line clears the line and produces after = "".
 * - Code: inserts newline inside the code block without splitting.
 */
export function enterAt(
  text: string,
  caret: number,
): { before: string; after: string | null; caret: number } {
  const kind = blockKind(text);
  const clampedCaret = Math.max(0, Math.min(caret, text.length));

  if (kind === "code") {
    const before =
      text.slice(0, clampedCaret) + "\n" + text.slice(clampedCaret);
    return { before, after: null, caret: clampedCaret + 1 };
  }

  if (kind === "bullet" || kind === "numbered" || kind === "todo") {
    const lastNl = text.lastIndexOf("\n", clampedCaret - 1);
    const lineStart = lastNl === -1 ? 0 : lastNl + 1;
    const nextNl = text.indexOf("\n", clampedCaret);
    const lineEnd = nextNl === -1 ? text.length : nextNl;
    const currentLine = text.slice(lineStart, lineEnd);

    const isBulletEmpty = /^\s*[-*+]\s*$/.test(currentLine);
    const isTodoEmpty = /^\s*(?:[-*+]\s+)?\[[ xX]\]\s*$/.test(currentLine);
    const isNumEmpty = /^\s*\d+\.\s*$/.test(currentLine);

    if (isBulletEmpty || isTodoEmpty || isNumEmpty) {
      let before = "";
      if (lastNl !== -1) {
        before = text.slice(0, lastNl) + text.slice(lineEnd);
      } else if (nextNl !== -1) {
        before = text.slice(nextNl + 1);
      }
      return { before, after: "", caret: 0 };
    }

    let nextMarker = "- ";
    if (kind === "todo") {
      const todoMatch = currentLine.match(/^(\s*)([-*+]\s+)?\[[ xX]\](\s*)/);
      nextMarker = todoMatch
        ? `${todoMatch[1]}${todoMatch[2] ?? "- "}[ ] `
        : "- [ ] ";
    } else if (kind === "numbered") {
      const numMatch = currentLine.match(/^(\s*)(\d+)\.(\s*)/);
      const nextNum = numMatch ? parseInt(numMatch[2], 10) + 1 : 1;
      nextMarker = numMatch ? `${numMatch[1]}${nextNum}. ` : "1. ";
    } else {
      const bulletMatch = currentLine.match(/^(\s*[-*+]\s*)/);
      nextMarker = bulletMatch ? `${bulletMatch[1].trimEnd()} ` : "- ";
    }

    const inserted = "\n" + nextMarker;
    const before =
      text.slice(0, clampedCaret) + inserted + text.slice(clampedCaret);
    return {
      before,
      after: null,
      caret: clampedCaret + inserted.length,
    };
  }

  // Paragraph, headings, and quotes: split into before and after
  const before = text.slice(0, clampedCaret);
  const after = text.slice(clampedCaret);
  return { before, after, caret: 0 };
}

function stripFirstLineMarker(text: string): { content: string; rest: string } {
  const trimmed = text.trimStart();
  if (trimmed.startsWith("```")) {
    const lines = text.split("\n");
    let innerLines: string[];
    if (lines.length > 1 && lines[lines.length - 1].trimStart().startsWith("```")) {
      innerLines = lines.slice(1, -1);
    } else {
      innerLines = lines.slice(1);
    }
    const content = innerLines[0] ?? "";
    const rest = innerLines.slice(1).join("\n");
    return { content, rest };
  }

  const lines = text.split("\n");
  let firstLine = lines[0] ?? "";
  const rest = lines.slice(1).join("\n");

  if (/^\/[^\n]*$/.test(firstLine)) {
    firstLine = "";
  }

  firstLine = firstLine
    .replace(/^###(\s+|$)/, "")
    .replace(/^##(\s+|$)/, "")
    .replace(/^#(\s+|$)/, "")
    .replace(/^>(\s+|$)/, "")
    .replace(/^(?:[-*+]\s+)?\[[ xX]\](\s+|$)/, "")
    .replace(/^[-*+](\s+|$)/, "")
    .replace(/^\d+\.(\s+|$)/, "");

  return { content: firstLine, rest };
}

/**
 * Changes block kind by rewriting the first line's marker (for slash menu).
 */
export function setKind(text: string, kind: BlockKind): string {
  const { content, rest } = stripFirstLineMarker(text);

  let newFirstLine = "";
  switch (kind) {
    case "paragraph":
      newFirstLine = content;
      break;
    case "heading1":
      newFirstLine = content ? `# ${content}` : "# ";
      break;
    case "heading2":
      newFirstLine = content ? `## ${content}` : "## ";
      break;
    case "heading3":
      newFirstLine = content ? `### ${content}` : "### ";
      break;
    case "bullet":
      newFirstLine = content ? `- ${content}` : "- ";
      break;
    case "numbered":
      newFirstLine = content ? `1. ${content}` : "1. ";
      break;
    case "todo":
      newFirstLine = content ? `- [ ] ${content}` : "- [ ] ";
      break;
    case "quote":
      newFirstLine = content ? `> ${content}` : "> ";
      break;
    case "code": {
      const codeBody = rest ? `${content}\n${rest}` : content;
      return codeBody ? `\`\`\`\n${codeBody}\n\`\`\`` : "```\n\n```";
    }
  }

  return rest ? `${newFirstLine}\n${rest}` : newFirstLine;
}

/**
 * Toggles a todo checkbox "[ ]" <-> "[x]" on the specified 0-indexed line.
 */
export function toggleTodo(text: string, line: number): string {
  if (line < 0) {
    return text;
  }
  const lines = text.split("\n");
  if (line >= lines.length) {
    return text;
  }
  // Only the checkbox at the start of the line, never a "[ ]" inside the task's text.
  const match = /^(\s*(?:[-*+]\s+)?)\[([ xX])\]/.exec(lines[line]);
  if (!match) {
    return text;
  }
  const mark = match[2] === " " ? "x" : " ";
  lines[line] = `${match[1]}[${mark}]${lines[line].slice(match[0].length)}`;
  return lines.join("\n");
}

/**
 * Returns the query text following an unclosed "[[" before caret, or null.
 */
export function linkQuery(text: string, caret: number): string | null {
  const clampedCaret = Math.max(0, Math.min(caret, text.length));
  const beforeCaret = text.slice(0, clampedCaret);
  const lastOpen = beforeCaret.lastIndexOf("[[");
  if (lastOpen === -1) {
    return null;
  }
  const lastClose = beforeCaret.lastIndexOf("]]");
  if (lastClose > lastOpen) {
    return null;
  }
  const query = beforeCaret.slice(lastOpen + 2);
  if (query.includes("\n")) {
    return null;
  }
  return query;
}

/**
 * Inserts a wikilink [[title]], replacing any unclosed [[... preceding the caret.
 * Places the caret immediately after the closing brackets.
 */
export function insertLink(
  text: string,
  caret: number,
  title: string,
): { text: string; caret: number } {
  const clampedCaret = Math.max(0, Math.min(caret, text.length));
  const beforeCaret = text.slice(0, clampedCaret);
  const lastOpen = beforeCaret.lastIndexOf("[[");
  const lastClose = beforeCaret.lastIndexOf("]]");

  let start = clampedCaret;
  if (lastOpen !== -1 && lastClose < lastOpen) {
    const textBetween = beforeCaret.slice(lastOpen);
    if (!textBetween.includes("\n")) {
      start = lastOpen;
    }
  }

  const prefix = text.slice(0, start);
  let after = text.slice(clampedCaret);
  if (after.startsWith("]]")) {
    after = after.slice(2);
  }

  const link = `[[${title}]]`;
  const newText = prefix + link + after;
  const newCaret = prefix.length + link.length;

  return { text: newText, caret: newCaret };
}

export interface SlashOption {
  readonly kind: BlockKind;
  readonly label: string;
}

export const SLASH_OPTIONS: readonly SlashOption[] = [
  { kind: "paragraph", label: "Teks" },
  { kind: "heading1", label: "Judul 1" },
  { kind: "heading2", label: "Judul 2" },
  { kind: "heading3", label: "Judul 3" },
  { kind: "bullet", label: "Daftar" },
  { kind: "numbered", label: "Daftar bernomor" },
  { kind: "todo", label: "Tugas" },
  { kind: "quote", label: "Kutipan" },
  { kind: "code", label: "Kode" },
];

/**
 * Returns query string after leading '/' if text begins with '/' and is a single line,
 * or null if text does not represent a slash command.
 */
export function slashQuery(text: string): string | null {
  if (!text.startsWith("/") || text.includes("\n")) {
    return null;
  }
  return text.slice(1);
}

/**
 * Filters slash options case-insensitively by query.
 */
export function filterSlashOptions(query: string): readonly SlashOption[] {
  const q = query.trim().toLowerCase();
  if (!q) {
    return SLASH_OPTIONS;
  }
  return SLASH_OPTIONS.filter((opt) => opt.label.toLowerCase().includes(q));
}

/**
 * Creates a new block using the module-level counter.
 */
export function createBlock(text = ""): Block {
  return { id: nextId(), text };
}

export interface SplitBlockResult {
  readonly blocks: Block[];
  readonly activeId: number;
  readonly caret: number;
}

/**
 * Transforms blocks on Enter at caret within the block at index:
 * - Uses enterAt to determine whether to split or continue inside the block.
 * - Returns new blocks array, the ID of the block that should be active, and caret position.
 */
export function splitBlockAt(
  blocks: readonly Block[],
  index: number,
  caret: number,
): SplitBlockResult {
  if (index < 0 || index >= blocks.length) {
    return {
      blocks: [...blocks],
      activeId: blocks[0]?.id ?? 0,
      caret: 0,
    };
  }

  const curr = blocks[index];
  const res = enterAt(curr.text, caret);

  if (res.after !== null) {
    const updatedCurr: Block = { id: curr.id, text: res.before };
    const nextBlock: Block = { id: nextId(), text: res.after };
    const newBlocks = [
      ...blocks.slice(0, index),
      updatedCurr,
      nextBlock,
      ...blocks.slice(index + 1),
    ];
    return {
      blocks: newBlocks,
      activeId: nextBlock.id,
      caret: res.caret,
    };
  }

  const updatedCurr: Block = { id: curr.id, text: res.before };
  const newBlocks = [
    ...blocks.slice(0, index),
    updatedCurr,
    ...blocks.slice(index + 1),
  ];
  return {
    blocks: newBlocks,
    activeId: curr.id,
    caret: res.caret,
  };
}

export interface MergeBlockResult {
  readonly blocks: Block[];
  readonly activeId: number;
  readonly caret: number;
}

/**
 * Handles Backspace at caret 0:
 * - If index <= 0, does nothing and returns null.
 * - Otherwise merges the block at index into the block at index - 1 (or removes the empty block)
 *   and sets caret at the join point.
 */
export function mergeBlockWithPrevious(
  blocks: readonly Block[],
  index: number,
): MergeBlockResult | null {
  if (index <= 0 || index >= blocks.length) {
    return null;
  }

  const prev = blocks[index - 1];
  const curr = blocks[index];
  const caret = prev.text.length;
  const merged: Block = {
    id: prev.id,
    text: prev.text + curr.text,
  };

  const newBlocks = [
    ...blocks.slice(0, index - 1),
    merged,
    ...blocks.slice(index + 1),
  ];

  return {
    blocks: newBlocks,
    activeId: prev.id,
    caret,
  };
}

