import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type JSX,
  type KeyboardEvent,
  type ReactNode,
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

interface PopupItem {
  readonly id: string;
  readonly content: ReactNode;
  readonly onSelect: () => void;
  readonly isSeparator?: boolean;
}

function PopupList(
  props: Readonly<{
    items: readonly PopupItem[];
    selectedIndex: number;
    widthClass: string;
  }>,
): JSX.Element {
  return (
    <ul
      className={`absolute z-20 mt-1 max-h-60 ${props.widthClass} overflow-y-auto rounded-xl border border-line bg-surface p-1 shadow-lg m-0 list-none`}
    >
      {props.items.map((item, idx) => (
        <li key={item.id}>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={item.onSelect}
            className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors ${
              item.isSeparator ? "border-t border-line/50 mt-1" : ""
            } ${
              props.selectedIndex === idx
                ? "bg-surface-2 text-ink font-medium"
                : "text-muted hover:bg-surface-2 hover:text-ink"
            }`}
          >
            {item.content}
          </button>
        </li>
      ))}
    </ul>
  );
}

function handlePopupNavigation(
  e: KeyboardEvent<HTMLTextAreaElement>,
  total: number,
  setIndex: (updater: (prev: number) => number) => void,
  onConfirm: () => void,
  onDismiss: () => void,
): boolean {
  if (e.key === "ArrowDown") {
    e.preventDefault();
    setIndex((prev) => (prev + 1) % total);
    return true;
  }
  if (e.key === "ArrowUp") {
    e.preventDefault();
    setIndex((prev) => (prev - 1 + total) % total);
    return true;
  }
  if (e.key === "Enter" || e.key === "Tab") {
    e.preventDefault();
    onConfirm();
    return true;
  }
  if (e.key === "Escape") {
    e.preventDefault();
    onDismiss();
    return true;
  }
  return false;
}

function handleBlockArrowMove(
  e: KeyboardEvent<HTMLTextAreaElement>,
  textarea: HTMLTextAreaElement,
  blockIndex: number,
  blocks: readonly Block[],
  onMove: (id: number, caret: number) => void,
): boolean {
  if (e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) {
    return false;
  }
  if (e.key === "ArrowUp" && blockIndex > 0) {
    const textBefore = textarea.value.slice(0, textarea.selectionStart);
    if (!textBefore.includes("\n")) {
      e.preventDefault();
      const prevBlock = blocks[blockIndex - 1];
      onMove(prevBlock.id, prevBlock.text.length);
      return true;
    }
  }
  if (e.key === "ArrowDown" && blockIndex < blocks.length - 1) {
    const textAfter = textarea.value.slice(textarea.selectionEnd);
    if (!textAfter.includes("\n")) {
      e.preventDefault();
      const nextBlock = blocks[blockIndex + 1];
      onMove(nextBlock.id, 0);
      return true;
    }
  }
  return false;
}

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

  const applyBlocks = useCallback(
    (newBlocks: Block[], nextActiveId?: number, caret?: number) => {
      setBlocks(newBlocks);
      if (nextActiveId !== undefined) {
        setActiveBlockId(nextActiveId);
      }
      if (caret !== undefined) {
        pendingCaret.current = caret;
      }
      props.onChange(joinBlocks(newBlocks));
    },
    [props],
  );

  function handleTextChange(e: ChangeEvent<HTMLTextAreaElement>) {
    if (activeBlockId === null) return;
    const value = e.target.value;
    const newBlocks = blocks.map((b) =>
      b.id === activeBlockId ? { ...b, text: value } : b,
    );
    setCaretPos(e.target.selectionStart);
    applyBlocks(newBlocks);
  }

  const handleSelectSlash = useCallback(
    (option: SlashOption) => {
      if (activeBlockId === null) return;
      const currentBlock = blocks.find((b) => b.id === activeBlockId);
      if (!currentBlock) return;
      const newText = setKind(currentBlock.text, option.kind);
      const newBlocks = blocks.map((b) =>
        b.id === activeBlockId ? { ...b, text: newText } : b,
      );
      const closing = option.kind === "code" ? newText.lastIndexOf("\n```") : -1;
      const nextCaret = closing >= 0 ? closing : newText.length;
      applyBlocks(newBlocks, activeBlockId, nextCaret);
      setDismissedSlashQuery(null);
    },
    [activeBlockId, blocks, applyBlocks],
  );

  const handleSelectExistingLink = useCallback(
    (title: string) => {
      if (activeBlockId === null) return;
      const currentBlock = blocks.find((b) => b.id === activeBlockId);
      if (!currentBlock) return;
      const caret = textareaRef.current?.selectionStart ?? currentBlock.text.length;
      const res = insertLink(currentBlock.text, caret, title);
      const newBlocks = blocks.map((b) =>
        b.id === activeBlockId ? { ...b, text: res.text } : b,
      );
      applyBlocks(newBlocks, activeBlockId, res.caret);
      setDismissedLinkQuery(null);
    },
    [activeBlockId, blocks, applyBlocks],
  );

  // The link goes in first and the page is created in the background, so nothing
  // typed meanwhile is overwritten by a stale copy of the blocks.
  const handleSelectCreateLink = useCallback(
    (query: string) => {
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
      applyBlocks(newBlocks, activeBlockId, res.caret);
      setDismissedLinkQuery(null);
    },
    [activeBlockId, blocks, props, applyBlocks],
  );

  function handleToggleTodo(blockId: number, line: number) {
    const targetBlock = blocks.find((b) => b.id === blockId);
    if (!targetBlock) return;
    const newText = toggleTodo(targetBlock.text, line);
    const newBlocks = blocks.map((b) =>
      b.id === blockId ? { ...b, text: newText } : b,
    );
    applyBlocks(newBlocks);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    const textarea = e.currentTarget;
    const blockIndex = blocks.findIndex((b) => b.id === activeBlockId);
    if (blockIndex === -1) return;

    if (showLinkSuggestions) {
      const handled = handlePopupNavigation(
        e,
        matchingTitles.length + 1,
        setLinkSelectedIndex,
        () => {
          if (linkSelectedIndex < matchingTitles.length) {
            handleSelectExistingLink(matchingTitles[linkSelectedIndex]);
          } else {
            handleSelectCreateLink(lq!);
          }
        },
        () => setDismissedLinkQuery(lq),
      );
      if (handled) return;
    }

    if (showSlashMenu && filteredSlashOptions.length > 0) {
      const handled = handlePopupNavigation(
        e,
        filteredSlashOptions.length,
        setSlashSelectedIndex,
        () => handleSelectSlash(filteredSlashOptions[slashSelectedIndex]),
        () => setDismissedSlashQuery(sq),
      );
      if (handled) return;
    }

    if (e.key === "Escape" || (e.key === "Enter" && (e.ctrlKey || e.metaKey))) {
      e.preventDefault();
      setActiveBlockId(null);
      return;
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const res = splitBlockAt(blocks, blockIndex, textarea.selectionStart);
      applyBlocks(res.blocks, res.activeId, res.caret);
      return;
    }

    if (
      e.key === "Backspace" &&
      textarea.selectionStart === 0 &&
      textarea.selectionEnd === 0 &&
      blockIndex > 0
    ) {
      e.preventDefault();
      const res = mergeBlockWithPrevious(blocks, blockIndex);
      if (res) {
        applyBlocks(res.blocks, res.activeId, res.caret);
      }
      return;
    }

    handleBlockArrowMove(e, textarea, blockIndex, blocks, (id, caret) => {
      setActiveBlockId(id);
      pendingCaret.current = caret;
    });
  }

  function updateCaretPos(e: { currentTarget: HTMLTextAreaElement }) {
    setCaretPos(e.currentTarget.selectionStart);
  }

  const slashItems: readonly PopupItem[] = useMemo(
    () =>
      filteredSlashOptions.map((opt) => ({
        id: opt.kind,
        content: <span>{opt.label}</span>,
        onSelect: () => handleSelectSlash(opt),
      })),
    [filteredSlashOptions, handleSelectSlash],
  );

  const linkItems: readonly PopupItem[] = useMemo(() => {
    const existing: PopupItem[] = matchingTitles.map((title) => ({
      id: `link-${title}`,
      content: (
        <>
          <span className="text-accent font-mono text-xs">[[</span>
          <span className="truncate text-ink">{title}</span>
          <span className="text-accent font-mono text-xs">]]</span>
        </>
      ),
      onSelect: () => handleSelectExistingLink(title),
    }));

    const createItem: PopupItem = {
      id: "link-create-new-page",
      content: (
        <>
          <span className="text-accent text-base leading-none">+</span>
          <span className="truncate">Buat halaman &quot;{lq}&quot;</span>
        </>
      ),
      onSelect: () => handleSelectCreateLink(lq ?? ""),
      isSeparator: matchingTitles.length > 0,
    };

    return [...existing, createItem];
  }, [matchingTitles, lq, handleSelectExistingLink, handleSelectCreateLink]);

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
              {showSlashMenu && slashItems.length > 0 && (
                <PopupList
                  items={slashItems}
                  selectedIndex={slashSelectedIndex}
                  widthClass="w-64"
                />
              )}
              {showLinkSuggestions && (
                <PopupList
                  items={linkItems}
                  selectedIndex={linkSelectedIndex}
                  widthClass="w-72"
                />
              )}
            </div>
          );
        }

        const isEmpty = block.text.trim() === "";
        return (
          <button
            key={block.id}
            type="button"
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
            className="group relative min-h-[30px] w-full cursor-text rounded-lg px-2 py-1 text-left transition-colors hover:bg-surface-2/30 focus-visible:outline-accent"
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
          </button>
        );
      })}
    </div>
  );
}
