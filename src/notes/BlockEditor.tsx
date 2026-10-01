import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type JSX,
  type KeyboardEvent,
} from "react";
import {
  blockKind,
  createBlock,
  filterSlashOptions,
  insertLink,
  joinBlocks,
  linkQuery,
  mergeBlockWithPrevious,
  setKind,
  slashQuery,
  splitBlockAt,
  splitBlocks,
  toggleTodo,
  type Block,
  type SlashOption,
} from "./blocks";
import { BlockPreview } from "./markdown";

export function BlockEditor(
  props: Readonly<{
    pageId: string;
    body: string;
    titles: readonly string[]; // judul halaman untuk saran [[ dan isResolved
    onChange: (body: string) => void; // dipanggil setiap edit; debounce simpan di NotesPage
    onOpenLink: (title: string) => void;
    onOpenUrl: (href: string) => void;
    onCreatePage: (title: string) => Promise<void>; // pilihan "Buat halaman" di saran [[
  }>,
): JSX.Element {
  const [blocks, setBlocks] = useState<Block[]>(() => {
    const initial = splitBlocks(props.body);
    return initial.length > 0 ? initial : [createBlock("")];
  });
  const [activeBlockId, setActiveBlockId] = useState<number | null>(null);
  const [prevPageId, setPrevPageId] = useState(props.pageId);

  // Re-split only when pageId prop changes
  if (props.pageId !== prevPageId) {
    setPrevPageId(props.pageId);
    const reSplit = splitBlocks(props.body);
    setBlocks(reSplit.length > 0 ? reSplit : [createBlock("")]);
    setActiveBlockId(null);
  }
  const [caretPos, setCaretPos] = useState(0);

  const pendingCaret = useRef<number | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [dismissedSlashQuery, setDismissedSlashQuery] = useState<string | null>(
    null,
  );
  const [dismissedLinkQuery, setDismissedLinkQuery] = useState<string | null>(
    null,
  );

  const activeBlock = useMemo(
    () => blocks.find((b) => b.id === activeBlockId),
    [blocks, activeBlockId],
  );

  // Slash menu state
  const sq = activeBlock ? slashQuery(activeBlock.text) : null;
  const showSlashMenu = sq !== null && dismissedSlashQuery !== sq;
  const filteredSlashOptions = useMemo(() => {
    if (sq === null) return [];
    return filterSlashOptions(sq);
  }, [sq]);
  const [slashSelectedIndex, setSlashSelectedIndex] = useState(0);

  useEffect(() => {
    setSlashSelectedIndex(0);
  }, [sq]);

  // Link suggestions state
  const lq = activeBlock ? linkQuery(activeBlock.text, caretPos) : null;
  const showLinkSuggestions = lq !== null && dismissedLinkQuery !== lq;
  const matchingTitles = useMemo(() => {
    if (lq === null) return [];
    const query = lq.toLowerCase();
    return props.titles.filter((t) => t.toLowerCase().includes(query)).slice(0, 8);
  }, [lq, props.titles]);
  const [linkSelectedIndex, setLinkSelectedIndex] = useState(0);

  useEffect(() => {
    setLinkSelectedIndex(0);
  }, [lq]);

  const adjustHeight = useCallback(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.max(textareaRef.current.scrollHeight, 28)}px`;
    }
  }, []);

  useEffect(() => {
    adjustHeight();
  });

  useEffect(() => {
    if (activeBlockId !== null && textareaRef.current) {
      if (pendingCaret.current !== null) {
        const pos = Math.min(
          pendingCaret.current,
          textareaRef.current.value.length,
        );
        textareaRef.current.setSelectionRange(pos, pos);
        pendingCaret.current = null;
      }
    }
  }, [activeBlockId, blocks]);

  useEffect(() => {
    if (activeBlockId !== null && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [activeBlockId]);

  const isResolved = useCallback(
    (title: string) => {
      const normalized = title.trim().toLowerCase();
      return props.titles.some((t) => t.trim().toLowerCase() === normalized);
    },
    [props.titles],
  );

  function handleTextChange(e: ChangeEvent<HTMLTextAreaElement>) {
    if (activeBlockId === null) return;
    const value = e.target.value;
    const newBlocks = blocks.map((b) =>
      b.id === activeBlockId ? { ...b, text: value } : b,
    );
    setBlocks(newBlocks);
    setCaretPos(e.target.selectionStart);
    props.onChange(joinBlocks(newBlocks));
  }

  function handleSelectSlash(option: SlashOption) {
    if (activeBlockId === null) return;
    const currentBlock = blocks.find((b) => b.id === activeBlockId);
    if (!currentBlock) return;
    const newText = setKind(currentBlock.text, option.kind);
    const newBlocks = blocks.map((b) =>
      b.id === activeBlockId ? { ...b, text: newText } : b,
    );
    setBlocks(newBlocks);
    // Inside a code block the caret goes before the closing fence.
    const closing = option.kind === "code" ? newText.lastIndexOf("\n```") : -1;
    pendingCaret.current = closing >= 0 ? closing : newText.length;
    props.onChange(joinBlocks(newBlocks));
    setDismissedSlashQuery(null);
  }

  function handleSelectExistingLink(title: string) {
    if (activeBlockId === null) return;
    const currentBlock = blocks.find((b) => b.id === activeBlockId);
    if (!currentBlock) return;
    const caret = textareaRef.current?.selectionStart ?? currentBlock.text.length;
    const res = insertLink(currentBlock.text, caret, title);
    const newBlocks = blocks.map((b) =>
      b.id === activeBlockId ? { ...b, text: res.text } : b,
    );
    setBlocks(newBlocks);
    pendingCaret.current = res.caret;
    props.onChange(joinBlocks(newBlocks));
    setDismissedLinkQuery(null);
  }

  // The link goes in first and the page is created in the background, so nothing
  // typed meanwhile is overwritten by a stale copy of the blocks.
  function handleSelectCreateLink(query: string) {
    if (activeBlockId === null) return;
    const currentBlock = blocks.find((b) => b.id === activeBlockId);
    if (!currentBlock) return;
    const trimmed = query.trim();
    if (trimmed) {
      void props.onCreatePage(trimmed);
    }
    const caret = textareaRef.current?.selectionStart ?? currentBlock.text.length;
    const res = insertLink(currentBlock.text, caret, trimmed);
    const newBlocks = blocks.map((b) =>
      b.id === activeBlockId ? { ...b, text: res.text } : b,
    );
    setBlocks(newBlocks);
    pendingCaret.current = res.caret;
    props.onChange(joinBlocks(newBlocks));
    setDismissedLinkQuery(null);
  }

  function handleToggleTodo(blockId: number, line: number) {
    const targetBlock = blocks.find((b) => b.id === blockId);
    if (!targetBlock) return;
    const newText = toggleTodo(targetBlock.text, line);
    const newBlocks = blocks.map((b) =>
      b.id === blockId ? { ...b, text: newText } : b,
    );
    setBlocks(newBlocks);
    props.onChange(joinBlocks(newBlocks));
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    const textarea = e.currentTarget;
    const blockIndex = blocks.findIndex((b) => b.id === activeBlockId);
    if (blockIndex === -1) return;

    // 1. Link suggestions popup navigation
    if (showLinkSuggestions) {
      const total = matchingTitles.length + 1;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setLinkSelectedIndex((prev) => (prev + 1) % total);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setLinkSelectedIndex((prev) => (prev - 1 + total) % total);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        if (linkSelectedIndex < matchingTitles.length) {
          handleSelectExistingLink(matchingTitles[linkSelectedIndex]);
        } else {
          handleSelectCreateLink(lq!);
        }
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setDismissedLinkQuery(lq);
        return;
      }
    }

    // 2. Slash menu popup navigation
    if (showSlashMenu && filteredSlashOptions.length > 0) {
      const total = filteredSlashOptions.length;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSlashSelectedIndex((prev) => (prev + 1) % total);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSlashSelectedIndex((prev) => (prev - 1 + total) % total);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        handleSelectSlash(filteredSlashOptions[slashSelectedIndex]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setDismissedSlashQuery(sq);
        return;
      }
    }

    // 3. Escape key (no popup open): exit edit mode
    if (e.key === "Escape") {
      e.preventDefault();
      setActiveBlockId(null);
      return;
    }

    // 4. Ctrl+Enter or Cmd+Enter: exit edit mode
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      setActiveBlockId(null);
      return;
    }

    // 5. Enter without modifier (split block or continue list item/code)
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const res = splitBlockAt(blocks, blockIndex, textarea.selectionStart);
      setBlocks(res.blocks);
      setActiveBlockId(res.activeId);
      pendingCaret.current = res.caret;
      props.onChange(joinBlocks(res.blocks));
      return;
    }

    // 6. Backspace at start of block
    if (e.key === "Backspace") {
      if (textarea.selectionStart === 0 && textarea.selectionEnd === 0) {
        if (blockIndex > 0) {
          e.preventDefault();
          const res = mergeBlockWithPrevious(blocks, blockIndex);
          if (res) {
            setBlocks(res.blocks);
            setActiveBlockId(res.activeId);
            pendingCaret.current = res.caret;
            props.onChange(joinBlocks(res.blocks));
          }
          return;
        }
      }
    }

    // 7. ArrowUp at first line -> move to previous block
    if (
      e.key === "ArrowUp" &&
      !e.shiftKey &&
      !e.altKey &&
      !e.ctrlKey &&
      !e.metaKey
    ) {
      const textBefore = textarea.value.slice(0, textarea.selectionStart);
      if (!textBefore.includes("\n") && blockIndex > 0) {
        e.preventDefault();
        const prevBlock = blocks[blockIndex - 1];
        setActiveBlockId(prevBlock.id);
        pendingCaret.current = prevBlock.text.length;
        return;
      }
    }

    // 8. ArrowDown at last line -> move to next block
    if (
      e.key === "ArrowDown" &&
      !e.shiftKey &&
      !e.altKey &&
      !e.ctrlKey &&
      !e.metaKey
    ) {
      const textAfter = textarea.value.slice(textarea.selectionEnd);
      if (!textAfter.includes("\n") && blockIndex < blocks.length - 1) {
        e.preventDefault();
        const nextBlock = blocks[blockIndex + 1];
        setActiveBlockId(nextBlock.id);
        pendingCaret.current = 0;
        return;
      }
    }
  }

  function updateCaretPos(e: { currentTarget: HTMLTextAreaElement }) {
    setCaretPos(e.currentTarget.selectionStart);
  }

  return (
    <div className="flex flex-col gap-1.5 py-2">
      {blocks.map((block) => {
        const isActive = block.id === activeBlockId;
        if (isActive) {
          const isCode = blockKind(block.text) === "code";
          return (
            <div key={block.id} className="relative">
              <textarea
                ref={textareaRef}
                value={block.text}
                onChange={handleTextChange}
                onKeyDown={handleKeyDown}
                onKeyUp={updateCaretPos}
                onClick={updateCaretPos}
                onSelect={updateCaretPos}
                placeholder="Ketik / untuk jenis blok, [[ untuk menautkan"
                rows={1}
                className={`w-full resize-none overflow-hidden rounded-lg bg-surface-2/40 px-2 py-1 text-ink outline-none border border-line focus:border-field-focus transition-colors ${
                  isCode
                    ? "font-mono text-sm leading-normal"
                    : "font-sans text-[15px] leading-relaxed"
                }`}
              />
              {showSlashMenu && filteredSlashOptions.length > 0 && (
                <div
                  className="absolute z-20 mt-1 max-h-60 w-64 overflow-y-auto rounded-xl border border-line bg-surface p-1 shadow-lg"
                  role="listbox"
                  aria-label="Pilihan jenis blok"
                >
                  {filteredSlashOptions.map((opt, idx) => (
                    <button
                      key={opt.kind}
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => handleSelectSlash(opt)}
                      className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors ${
                        slashSelectedIndex === idx
                          ? "bg-surface-2 text-ink font-medium"
                          : "text-muted hover:bg-surface-2 hover:text-ink"
                      }`}
                    >
                      <span>{opt.label}</span>
                    </button>
                  ))}
                </div>
              )}
              {showLinkSuggestions && (
                <div
                  className="absolute z-20 mt-1 max-h-60 w-72 overflow-y-auto rounded-xl border border-line bg-surface p-1 shadow-lg"
                  role="listbox"
                  aria-label="Saran tautan"
                >
                  {matchingTitles.map((title, idx) => (
                    <button
                      key={title}
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => handleSelectExistingLink(title)}
                      className={`flex w-full items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors ${
                        linkSelectedIndex === idx
                          ? "bg-surface-2 text-ink font-medium"
                          : "text-muted hover:bg-surface-2 hover:text-ink"
                      }`}
                    >
                      <span className="text-accent font-mono text-xs">[[</span>
                      <span className="truncate text-ink">{title}</span>
                      <span className="text-accent font-mono text-xs">]]</span>
                    </button>
                  ))}
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => handleSelectCreateLink(lq!)}
                    className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors ${
                      matchingTitles.length > 0
                        ? "border-t border-line/50 mt-1"
                        : ""
                    } ${
                      linkSelectedIndex === matchingTitles.length
                        ? "bg-surface-2 text-ink font-medium"
                        : "text-muted hover:bg-surface-2 hover:text-ink"
                    }`}
                  >
                    <span className="text-accent text-base leading-none">+</span>
                    <span className="truncate">Buat halaman &quot;{lq}&quot;</span>
                  </button>
                </div>
              )}
            </div>
          );
        }

        const isEmpty = block.text.trim() === "";
        return (
          <div
            key={block.id}
            role="button"
            tabIndex={0}
            onClick={() => {
              setActiveBlockId(block.id);
              pendingCaret.current = block.text.length;
            }}
            onKeyDown={(e) => {
              // Keys on a link or checkbox inside the preview keep their own meaning.
              if (e.target !== e.currentTarget) return;
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setActiveBlockId(block.id);
                pendingCaret.current = block.text.length;
              }
            }}
            className="group relative min-h-[30px] cursor-text rounded-lg px-2 py-1 transition-colors hover:bg-surface-2/30 focus-visible:outline-accent"
          >
            {isEmpty ? (
              <p className="m-0 leading-relaxed text-muted italic text-[15px]">
                Ketik / untuk jenis blok, [[ untuk menautkan
              </p>
            ) : (
              <BlockPreview
                text={block.text}
                isResolved={isResolved}
                onOpenLink={props.onOpenLink}
                onOpenUrl={props.onOpenUrl}
                onToggleTodo={(line) => handleToggleTodo(block.id, line)}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
