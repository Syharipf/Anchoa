import { useState, type KeyboardEvent } from "react";
import { parseTag } from "./view";

export function TagInput({
  tags,
  onChange,
  disabled = false,
}: Readonly<{
  tags: readonly string[];
  onChange: (tags: string[]) => void;
  disabled?: boolean;
}>) {
  const [inputVal, setInputVal] = useState("");

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      e.preventDefault();
      const parsed = parseTag(inputVal);
      if (parsed) {
        if (!tags.includes(parsed)) {
          onChange([...tags, parsed]);
        }
        setInputVal("");
      }
    }
  }

  function handleRemove(tagToRemove: string) {
    onChange(tags.filter((t) => t !== tagToRemove));
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {tags.map((tag) => (
        <span
          key={tag}
          className="inline-flex items-center gap-1 rounded-md bg-surface-2 px-2 py-0.5 font-mono text-[11px] text-muted"
        >
          <span>#{tag}</span>
          {!disabled && (
            <button
              type="button"
              aria-label={`Hapus tag ${tag}`}
              onClick={() => handleRemove(tag)}
              className="ml-0.5 cursor-pointer text-xs text-muted hover:text-ink"
            >
              ×
            </button>
          )}
        </span>
      ))}
      {!disabled && (
        <input
          value={inputVal}
          onChange={(e) => setInputVal(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="#tambah-tag…"
          aria-label="Tambah tag"
          className="min-w-[90px] flex-1 border-0 bg-transparent font-mono text-xs text-ink outline-none placeholder:text-muted focus:outline-none"
        />
      )}
    </div>
  );
}
