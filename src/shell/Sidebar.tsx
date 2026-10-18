import { useCallback, useEffect, useRef, useState } from "react";
import { PAGES, type PageId } from "./nav";
import { AnchoaLogo } from "../brand/AnchoaLogo";
import { NavRailOcean } from "./NavRailOcean";

const ICON_PATHS: Record<string, string[]> = {
  dashboard: ["M3 3h7v9H3z", "M14 3h7v5h-7z", "M14 12h7v9h-7z", "M3 16h7v5H3z"],
  jurnal: ["M6 3h11a2 2 0 0 1 2 2v16H8a2 2 0 0 1-2-2z", "M6 17a2 2 0 0 1 2-2h11", "M10 7h5M10 10h3"],
  catatan: ["M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z", "M14 2v6h6", "M16 13H8M16 17H8M10 9H8"],
  email: ["M3 5h18v14H3z", "M3 7l9 6 9-6"],
  jadwal: ["M3 5h18v16H3z", "M3 10h18M8 3v4M16 3v4"],
  habit: ["M12 2.5c.8 3.2 5 5.3 5 10a5 5 0 0 1-10 0c0-2.3 1.1-3.9 2.4-5 .1 1.7.9 2.8 2.1 3.2-.6-3 .1-5.9.5-8.2z"],
  keuangan: ["M3 6h18v13H3z", "M16 12.5h2M3 10h18"],
  proyek: ["M3 3h18v18H3z", "M8 7v7M12 7v4M16 7v10"],
  berkas: ["M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"],
  unduhan: ["M12 4v11M7 10l5 5 5-5M5 20h14"],
  profil: ["M4 21a8 8 0 0 1 16 0", "M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0z"],
  settings: ["M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4", "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"],
};

function NavSvg({ id, size = 20 }: Readonly<{ id: string; size?: number }>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
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

const COLLAPSED_KEY = "anchoa.sidebar.collapsed";
function loadCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}
function saveCollapsed(v: boolean) {
  try {
    localStorage.setItem(COLLAPSED_KEY, v ? "1" : "0");
  } catch {
    // Ignore storage errors
  }
}

export function Sidebar({
  current,
  onSelect,
  reminders,
  notificationsOpen,
  onToggleNotifications,
}: Readonly<{
  current: string;
  onSelect: (page: PageId) => void;
  reminders: number;
  notificationsOpen: boolean;
  onToggleNotifications: () => void;
}>) {
  const wheelPages = PAGES.filter((p) => !p.bottom);
  const bottomPages = PAGES.filter((p) => p.bottom);
  const N = wheelPages.length;

  const [collapsed, setCollapsed] = useState(loadCollapsed);
  const activeIdx = wheelPages.findIndex((p) => p.id === current);
  const [rot, setRot] = useState(() => (activeIdx >= 0 ? activeIdx : 0));

  const prefersReduced =
    (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) ?? false;

  const lastWheel = useRef(0);
  const dragY = useRef<number | null>(null);

  const toggle = useCallback(() => {
    setCollapsed((v) => {
      const n = !v;
      saveCollapsed(n);
      return n;
    });
  }, []);

  const turn = useCallback(
    (d: number) => {
      setRot((prevRot) => {
        const next = prevRot + d;
        const idx = ((next % N) + N) % N;
        const id = wheelPages[idx].id;
        if (id !== current) onSelect(id);
        return next;
      });
    },
    [N, current, onSelect, wheelPages]
  );

  const selectItem = useCallback(
    (id: PageId, idx: number) => {
      let off = ((idx - rot) % N + N) % N;
      if (off > N / 2) off -= N;
      if (off !== 0) {
        setRot((r) => r + off);
      }
      if (id !== current) onSelect(id);
    },
    [N, current, onSelect, rot]
  );

  // Keep wheel centered on the active item whenever current page changes
  useEffect(() => {
    const idx = wheelPages.findIndex((p) => p.id === current);
    if (idx >= 0) {
      setRot((r) => {
        let off = ((idx - r) % N + N) % N;
        if (off > N / 2) off -= N;
        return r + off;
      });
    }
  }, [current, N, wheelPages]);

  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "b") {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [toggle]);

  const half = 2;
  const items = wheelPages.map((m, i) => {
    let off = ((i - rot) % N + N) % N;
    if (off > N / 2) off -= N;
    const ad = Math.abs(off);
    const mid = off === 0;
    const here = m.id === current;
    const show = ad <= half;

    // Smooth cylindrical depth within 72px rail:
    // Center: x=14, y=368
    // Step 1: x=11, y=368 ± 60
    // Step 2: x=7, y=368 ± 116
    const x = mid ? 14 : ad === 1 ? 11 : 7;
    const y = 368 + off * (ad === 2 ? 58 : 60);

    return {
      page: m,
      here,
      mid,
      show,
      x,
      y,
      scale: mid ? 1.15 : ad === 1 ? 0.88 : 0.72,
      op: show ? (mid ? 1 : ad === 1 ? 0.72 : 0.35) : 0,
      pe: show ? ("auto" as const) : ("none" as const),
      color: here || mid ? "#C6F36B" : "#CFE3EA",
      bg: here || mid ? "#10303A" : "rgba(10,36,45,0.85)",
      border: here ? "#C6F36B" : mid ? "#5E9AAA" : "#223E4A",
      glow: here
        ? "0 0 0 2px #C6F36B, 0 0 16px rgba(198,243,107,0.38), inset 0 0 8px rgba(198,243,107,0.18)"
        : mid
          ? "0 0 12px rgba(47,116,134,0.4)"
          : "none",
      tr: prefersReduced
        ? "none"
        : "transform 0.42s cubic-bezier(.22, 1, .36, 1), opacity 0.3s ease, border-color 0.25s, box-shadow 0.25s",
    };
  });

  if (collapsed) {
    return (
      <div className="flex shrink-0">
        <nav
          data-navwheel
          aria-label="Menu utama"
          className="w-0 h-[800px] relative select-none"
          style={{
            position: "relative",
            zIndex: 40,
            width: 0,
            height: 800,
            flexShrink: 0,
            outline: "none",
            userSelect: "none",
            overflow: "visible",
          }}
        >
          <button
            type="button"
            onClick={toggle}
            aria-label="Tampilkan menu samping"
            aria-expanded={false}
            style={{
              position: "absolute",
              left: 0,
              top: 200,
              width: 14,
              height: 96,
              borderRadius: "0 8px 8px 0",
              border: "1px solid #1F3E49",
              borderLeft: "none",
              background: "rgba(11,38,48,0.9)",
              color: "#CFE3EA",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              padding: 0,
            }}
          >
            <svg
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M9 6l6 6-6 6" />
            </svg>
          </button>
        </nav>
      </div>
    );
  }

  return (
    <div className="flex shrink-0 sticky top-0 h-screen z-40">
      <nav
        data-navwheel
        aria-label="Menu utama"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            turn(1);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            turn(-1);
          }
        }}
        onWheel={(e) => {
          const now = Date.now();
          if (now - lastWheel.current < 160) return;
          lastWheel.current = now;
          turn(e.deltaY > 0 ? 1 : -1);
        }}
        onPointerDown={(e) => {
          dragY.current = e.clientY;
        }}
        onPointerMove={(e) => {
          if (dragY.current === null) return;
          const d = e.clientY - dragY.current;
          if (Math.abs(d) > 46) {
            dragY.current = e.clientY;
            turn(d < 0 ? 1 : -1);
          }
        }}
        onPointerUp={() => {
          dragY.current = null;
        }}
        onPointerCancel={() => {
          dragY.current = null;
        }}
        className="w-[72px] h-full relative select-none"
        style={{
          position: "relative",
          zIndex: 40,
          width: 72,
          height: "100%",
          flexShrink: 0,
          outline: "none",
          userSelect: "none",
        }}
      >
        {/* Fixed underwater ocean rail background — 72px permanent */}
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: 72,
            height: "100%",
            overflow: "hidden",
            borderRight: "1px solid #1F3E49",
          }}
        >
          <NavRailOcean paused={prefersReduced} />
        </div>

        {/* Ambient center radial glow */}
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            left: 0,
            top: 346,
            width: 72,
            height: 88,
            pointerEvents: "none",
            background: "radial-gradient(circle, rgba(47,116,134,0.35) 0%, transparent 70%)",
          }}
        />

        {/* Active center indicator pill on right edge */}
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            right: 0,
            top: 380,
            width: 3,
            height: 20,
            borderRadius: "2px 0 0 2px",
            background: "#C6F36B",
            boxShadow: "0 0 8px #C6F36B",
          }}
        />

        {/* Logo at top */}
        <div
          role="button"
          tabIndex={0}
          aria-label="Anchoa, ke Dashboard"
          title="Dashboard"
          onClick={() => onSelect("dashboard")}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onSelect("dashboard");
            }
          }}
          style={{
            position: "absolute",
            left: 16,
            top: 18,
            cursor: "pointer",
            zIndex: 10,
          }}
        >
          <AnchoaLogo tile size={40} label="Logo Anchoa" />
        </div>

        {/* Up arrow ▲ — top: 120px */}
        <button
          type="button"
          onClick={() => turn(-1)}
          aria-label="Menu sebelumnya"
          title="Menu sebelumnya (Scroll / Panah Atas)"
          className="group hover:border-accent hover:text-accent transition-all duration-200 hover:scale-105 active:scale-95"
          style={{
            position: "absolute",
            left: 22,
            top: 120,
            width: 28,
            height: 28,
            borderRadius: "50%",
            border: "1px solid #2C5868",
            background: "rgba(11,38,48,0.85)",
            color: "#CFE3EA",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            padding: 0,
            zIndex: 10,
          }}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="transition-transform group-hover:-translate-y-0.5"
            aria-hidden="true"
          >
            <path d="M6 15l6-6 6 6" />
          </svg>
        </button>

        {/* Position readout — top: 154px */}
        <span
          style={{
            position: "absolute",
            left: 0,
            top: 154,
            width: 72,
            textAlign: "center",
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 10,
            color: "#8FB3BE",
            pointerEvents: "none",
          }}
        >
          {activeIdx >= 0 ? `${activeIdx + 1}/${N}` : "—"}
        </span>

        {/* Vertical Arc Menu Items (Up/Down motion inside 72px rail) */}
        {items.map((it, i) => (
          <button
            key={it.page.id}
            type="button"
            onClick={() => selectItem(it.page.id, i)}
            aria-label={it.page.label}
            title={it.page.label}
            aria-current={it.here ? "page" : undefined}
            tabIndex={it.show ? 0 : -1}
            className="group outline-none"
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              display: "flex",
              alignItems: "center",
              color: it.color,
              background: "transparent",
              border: "none",
              padding: 0,
              cursor: it.show ? "pointer" : "default",
              opacity: it.op,
              pointerEvents: it.pe,
              transform: `translate(${it.x}px, ${it.y}px) scale(${it.scale})`,
              transformOrigin: "22px 22px",
              transition: it.tr,
              zIndex: it.mid ? 8 : 5,
            }}
          >
            <span
              style={{
                position: "relative",
                flexShrink: 0,
                width: 44,
                height: 44,
                borderRadius: "50%",
                boxSizing: "border-box",
                border: `1px solid ${it.border}`,
                background: it.bg,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: it.glow,
                pointerEvents: it.pe,
                transition: "border-color 0.2s, background-color 0.2s, transform 0.2s, box-shadow 0.2s",
              }}
              className="group-hover:border-accent group-hover:scale-105"
            >
              <NavSvg id={it.page.id} size={it.mid ? 22 : 19} />
              {it.page.id === "email" && reminders > 0 && (
                <span
                  aria-hidden="true"
                  style={{
                    position: "absolute",
                    top: -3,
                    right: -4,
                    minWidth: 16,
                    height: 16,
                    padding: "0 4px",
                    boxSizing: "border-box",
                    borderRadius: 8,
                    background: "#C6F36B",
                    color: "#0F1115",
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: 9.5,
                    fontWeight: 500,
                    lineHeight: "16px",
                    textAlign: "center",
                  }}
                >
                  {reminders}
                </span>
              )}
            </span>
          </button>
        ))}

        {/* Down arrow ▼ — top: 580px */}
        <button
          type="button"
          onClick={() => turn(1)}
          aria-label="Menu berikutnya"
          title="Menu berikutnya (Scroll / Panah Bawah)"
          className="group hover:border-accent hover:text-accent transition-all duration-200 hover:scale-105 active:scale-95"
          style={{
            position: "absolute",
            left: 22,
            top: 580,
            width: 28,
            height: 28,
            borderRadius: "50%",
            border: "1px solid #2C5868",
            background: "rgba(11,38,48,0.85)",
            color: "#CFE3EA",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            padding: 0,
            zIndex: 10,
          }}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="transition-transform group-hover:translate-y-0.5"
            aria-hidden="true"
          >
            <path d="M6 9l6 6-6 6" />
          </svg>
        </button>

        {/* Bottom stack: Notif · Profil · Pengaturan (left:14 bottom:14, gap:6) */}
        <div
          style={{
            position: "absolute",
            left: 14,
            bottom: 14,
            display: "flex",
            flexDirection: "column",
            gap: 6,
            zIndex: 10,
          }}
        >
          {/* Notifikasi */}
          <button
            type="button"
            onClick={onToggleNotifications}
            aria-label={reminders > 0 ? `Notifikasi, ${reminders} pengingat` : "Notifikasi"}
            title="Notifikasi"
            aria-haspopup="dialog"
            aria-expanded={notificationsOpen}
            className="transition-transform hover:scale-105 active:scale-95"
            style={{
              position: "relative",
              width: 44,
              height: 44,
              borderRadius: 12,
              border: 0,
              padding: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              background: notificationsOpen ? "rgba(22,60,72,0.9)" : "rgba(8,26,33,0.75)",
              color: notificationsOpen ? "#C6F36B" : "#CFE3EA",
            }}
          >
            <svg
              width="19"
              height="19"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z" />
              <path d="M10 20a2 2 0 0 0 4 0" />
            </svg>
            {reminders > 0 && (
              <span
                aria-hidden="true"
                style={{
                  position: "absolute",
                  top: 9,
                  right: 10,
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  background: "#FF8A7A",
                }}
              />
            )}
          </button>

          {/* Profil + Pengaturan */}
          {bottomPages.map((p) => {
            const active = current === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => onSelect(p.id)}
                aria-label={p.label}
                title={p.label}
                aria-current={active ? "page" : undefined}
                className="transition-transform hover:scale-105 active:scale-95"
                style={{
                  position: "relative",
                  width: 44,
                  height: 44,
                  borderRadius: 12,
                  border: active ? "1px solid #C6F36B" : 0,
                  padding: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                  background: active ? "rgba(22,60,72,0.9)" : "rgba(8,26,33,0.75)",
                  color: active ? "#C6F36B" : "#CFE3EA",
                }}
              >
                <NavSvg id={p.id} size={19} />
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
