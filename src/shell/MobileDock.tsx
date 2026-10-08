import { useCallback, useState } from "react";
import { PAGES, type PageId } from "./nav";

const ICON_PATHS: Record<string, string[]> = {
  dashboard: ["M3 3h7v9H3z", "M14 3h7v5h-7z", "M14 12h7v9h-7z", "M3 16h7v5H3z"],
  jurnal: ["M6 3h11a2 2 0 0 1 2 2v16H8a2 2 0 0 1-2-2z", "M6 17a2 2 0 0 1 2-2h11", "M10 7h5M10 10h3"],
  catatan: ["M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z", "M14 2v6h6", "M16 13H8M16 17H8M10 9H8"],
  email: ["M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z", "M22 6l-10 7L2 6"],
  jadwal: ["M19 4H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z", "M16 2v4M8 2v4M3 10h18"],
  habit: ["M9 11l3 3L22 4", "M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"],
  keuangan: ["M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"],
  proyek: ["M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"],
  berkas: ["M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z", "M13 2v7h7"],
  unduhan: ["M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4", "M7 10l5 5 5-5", "M12 15V3"],
  profil: ["M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2", "M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"],
  settings: [
    "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
    "M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z",
  ],
};

function PageIcon({ id, size = 20 }: Readonly<{ id: string; size?: number }>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {(ICON_PATHS[id] ?? []).map((d, k) => (
        <path key={k} d={d} />
      ))}
    </svg>
  );
}

export interface MobileDockProps {
  current: string;
  onSelect: (page: PageId) => void;
  onOpenSearch: () => void;
  onOpenAssistant: () => void;
}

export function MobileDock({
  current,
  onSelect,
  onOpenSearch,
  onOpenAssistant,
}: Readonly<MobileDockProps>) {
  const [wheelOpen, setWheelOpen] = useState(false);

  const toggleWheel = useCallback(() => {
    setWheelOpen((v) => !v);
  }, []);

  const handleSelect = useCallback(
    (id: PageId) => {
      setWheelOpen(false);
      onSelect(id);
    },
    [onSelect],
  );

  return (
    <>
      {/* Scrim and Wheel Menu Modal */}
      {wheelOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Roda menu utama"
          className="fixed inset-0 z-50 flex flex-col justify-end bg-black/70 backdrop-blur-sm transition-opacity"
        >
          {/* Backdrop dismiss touch */}
          <button
            type="button"
            className="flex-1 cursor-default bg-transparent border-0"
            aria-label="Tutup menu"
            onClick={() => setWheelOpen(false)}
          />

          {/* Wheel panel */}
          <div className="relative rounded-t-3xl border-t border-[#1F3E49] bg-[#0A242D] px-6 pb-28 pt-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <span className="font-['Space_Grotesk'] text-lg font-semibold text-[#E7E9EE]">
                Menu Utama
              </span>
              <button
                type="button"
                onClick={() => setWheelOpen(false)}
                aria-label="Tutup menu"
                className="flex h-9 w-9 items-center justify-center rounded-full bg-[#10303A] text-[#CFE3EA] hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="grid grid-cols-4 gap-3">
              {PAGES.map((page) => {
                const active = page.id === current;
                return (
                  <button
                    key={page.id}
                    type="button"
                    onClick={() => handleSelect(page.id)}
                    className={`flex flex-col items-center gap-1.5 rounded-2xl p-2.5 transition-colors ${
                      active
                        ? "bg-[#10303A] text-[#C6F36B] ring-1 ring-[#C6F36B]"
                        : "bg-[#081A21] text-[#DCEAEE] hover:bg-[#10303A]"
                    }`}
                  >
                    <PageIcon id={page.id} size={22} />
                    <span className="text-[11px] font-medium leading-none">
                      {page.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Dok Bawah Ringkas (3 tombol) */}
      <nav
        aria-label="Navigasi Dok Mobile"
        className="fixed bottom-0 inset-x-0 z-40 flex h-20 items-center justify-around border-t border-[#1F3E49]/60 bg-[#0A242D]/95 px-6 backdrop-blur-md"
      >
        {/* Tombol 1: Cari */}
        <button
          type="button"
          onClick={onOpenSearch}
          aria-label="Cari item dan menu"
          className="flex h-12 w-12 items-center justify-center rounded-full bg-[#10303A] text-[#CFE3EA] transition-transform active:scale-95"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </button>

        {/* Tombol 2: Menu Utama (Tengah) */}
        <button
          type="button"
          onClick={toggleWheel}
          aria-label="Menu utama"
          aria-expanded={wheelOpen}
          className="relative flex h-14 w-14 items-center justify-center rounded-full bg-[#163C48] text-[#C6F36B] shadow-[0_0_16px_rgba(198,243,107,0.25)] ring-2 ring-[#C6F36B] transition-transform active:scale-95"
        >
          <PageIcon id={current} size={24} />
        </button>

        {/* Tombol 3: Asisten (Mic) */}
        <button
          type="button"
          onClick={onOpenAssistant}
          aria-label="Buka asisten AI"
          className="flex h-12 w-12 items-center justify-center rounded-full bg-[#10303A] text-[#C6F36B] transition-transform active:scale-95"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" y1="19" x2="12" y2="23" />
            <line x1="8" y1="23" x2="16" y2="23" />
          </svg>
        </button>
      </nav>
    </>
  );
}
