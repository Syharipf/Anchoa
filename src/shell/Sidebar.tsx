import { useCallback, useEffect, useRef, useState } from "react";
import { PAGES, type PageId } from "./nav";
import { AnchoaLogo } from "../brand/AnchoaLogo";
import { NavRailOcean } from "./NavRailOcean";
import { NavFishSchool } from "./NavFishSchool";
import { NAV_OVERLAY_BG } from "./navOverlayBg";


const ICON_PATHS: Record<string, string[]> = {
  dashboard: ["M3 3h7v9H3z","M14 3h7v5h-7z","M14 12h7v9h-7z","M3 16h7v5H3z"],
  jurnal: ["M6 3h11a2 2 0 0 1 2 2v16H8a2 2 0 0 1-2-2z","M6 17a2 2 0 0 1 2-2h11","M10 7h5M10 10h3"],
  catatan: ["M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z","M14 2v6h6","M16 13H8M16 17H8M10 9H8"],
  email: ["M3 5h18v14H3z","M3 7l9 6 9-6"],
  jadwal: ["M3 5h18v16H3z","M3 10h18M8 3v4M16 3v4"],
  habit: ["M12 2.5c.8 3.2 5 5.3 5 10a5 5 0 0 1-10 0c0-2.3 1.1-3.9 2.4-5 .1 1.7.9 2.8 2.1 3.2-.6-3 .1-5.9.5-8.2z"],
  keuangan: ["M3 6h18v13H3z","M16 12.5h2M3 10h18"],
  proyek: ["M3 3h18v18H3z","M8 7v7M12 7v4M16 7v10"],
  berkas: ["M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"],
  unduhan: ["M12 4v11M7 10l5 5 5-5M5 20h14"],
  profil: ["M4 21a8 8 0 0 1 16 0","M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0z"],
  settings: ["M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4","M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"],
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
function loadCollapsed() {
  try { return localStorage.getItem(COLLAPSED_KEY) === "1"; } catch { return false; }
}
function saveCollapsed(v: boolean) {
  try { localStorage.setItem(COLLAPSED_KEY, v ? "1" : "0"); } catch { /**/ }
}

// Arc geometry per DESIGN.md §1 and Main.dc.html ANCHOA_NAV.
const CY = 388;
const ARC = {
  closed: { cx: -250, r: 290, step: 11 },
  open:   { cx: -100, r: 198, step: 27 },
};

export function Sidebar({
  current, onSelect, reminders, notificationsOpen, onToggleNotifications,
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
  const [open, setOpen] = useState(false);

  const activeIdx = wheelPages.findIndex((p) => p.id === current);
  const [rot, setRot] = useState(() => activeIdx >= 0 ? activeIdx : 0);

  const prefersReduced =
    (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) ?? false;

  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastWheel  = useRef(0);
  const dragY      = useRef<number | null>(null);
  const prevOff    = useRef<Record<string, number>>({});

  const toggle = useCallback(() => {
    setCollapsed((v) => { const n = !v; saveCollapsed(n); return n; });
  }, []);

  const turn = useCallback((d: number) => {
    setRot((r) => r + d);
    setOpen(true);
  }, []);

  const close = useCallback(() => {
    if (hoverTimer.current) { clearTimeout(hoverTimer.current); hoverTimer.current = null; }
    setOpen(false);
  }, []);

  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "b") {
        e.preventDefault(); toggle();
      }
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [toggle]);

  useEffect(() => () => { if (hoverTimer.current) clearTimeout(hoverTimer.current); }, []);

  const prev = prevOff.current;
  const arc  = open ? ARC.open : ARC.closed;
  const half = 2;

  const items = wheelPages.map((m, i) => {
    let off = ((i - rot) % N + N) % N;
    if (off > N / 2) off -= N;
    const ad   = Math.abs(off);
    const mid  = off === 0;
    const here = m.id === current;
    const show = ad <= half;
    const jump = prev[m.id] !== undefined && Math.abs(prev[m.id] - off) > 1.5;
    prev[m.id] = off;
    const a   = off * arc.step;
    const rad = (a * Math.PI) / 180;
    const x   = (arc.cx + arc.r * Math.cos(rad) - 22).toFixed(1);
    const y   = (CY    + arc.r * Math.sin(rad) - 22).toFixed(1);
    return {
      page: m, here, show, x, y,
      scale: open ? (mid ? 1.08 : ad === 1 ? 0.96 : 0.84)
                  : (mid ? 0.86 : ad === 1 ? 0.76 : 0.68),
      op:  show ? (mid ? 1 : 0.62) : 0,
      pe:  show ? "auto" as const : "none" as const,
      color:  here ? "#C6F36B" : "#DCEAEE",
      bg:     here ? "#10303A" : mid ? "rgba(16,48,58,0.95)" : "rgba(8,26,33,0.78)",
      border: here ? "#C6F36B" : mid ? "#5E9AAA" : "#2C5868",
      glow:   here ? "0 0 0 3px rgba(198,243,107,0.14), 0 0 14px rgba(198,243,107,0.3)" : "none",
      tr:     jump ? "none" : "transform 0.45s cubic-bezier(.3,.7,.2,1), opacity 0.35s ease",
      fs:     mid ? 12.5 : 12,
      fw:     mid || here ? 600 : 400,
    };
  });

  const posIdx    = ((rot % N) + N) % N;
  const posText   = `${posIdx + 1} / ${N}`;
  const schoolRot = -rot * arc.step;

  if (collapsed) {
    return (
      <div className="flex shrink-0">
        <nav
          data-navwheel
          aria-label="Menu utama"
          className="w-0 h-[800px] relative select-none"
          style={{ position: "relative", zIndex: 40, width: 0, height: 800, flexShrink: 0, outline: "none", userSelect: "none", overflow: "visible" }}
        >
          <button
            type="button"
            onClick={toggle}
            aria-label="Tampilkan menu samping"
            aria-expanded={false}
            style={{ position: "absolute", left: 0, top: 200, width: 14, height: 96, borderRadius: "0 8px 8px 0", border: "1px solid #1F3E49", borderLeft: "none", background: "rgba(11,38,48,0.9)", color: "#CFE3EA", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", padding: 0 }}
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
              <path d="M9 6l6 6-6 6" />
            </svg>
          </button>
        </nav>
      </div>
    );
  }

  return (
    <div className="flex shrink-0">
      <nav
        data-navwheel
        aria-label="Menu utama"
        tabIndex={0}
        onFocus={() => setOpen(true)}
        onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) close(); }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); turn(1); }
          else if (e.key === "ArrowUp") { e.preventDefault(); turn(-1); }
          else if (e.key === "Escape") close();
        }}
        className="w-[72px] h-[800px] relative select-none"
        style={{ position: "relative", zIndex: 40, width: 72, height: 800, flexShrink: 0, outline: "none", userSelect: "none" }}
      >
        {/* Layer 1 – 72px rail background: underwater ocean */}
        <div
          aria-hidden="true"
          style={{ position: "absolute", left: 0, top: 0, width: 72, height: 800, overflow: "hidden", borderRight: "1px solid #1F3E49" }}
        >
          <NavRailOcean paused={prefersReduced} />
        </div>

        {/* Layer 2 – full-screen overlay (pointer-events none, page still clickable) */}
        <div
          aria-hidden="true"
          style={{
            position: "fixed", inset: 0,
            pointerEvents: "none",
            opacity: open ? 1 : 0,
            visibility: open ? "visible" : "hidden",
            transition: "opacity 0.35s ease, visibility 0.35s",
            backdropFilter: open && !prefersReduced ? "blur(2px)" : "none",
            WebkitBackdropFilter: open && !prefersReduced ? "blur(2px)" : "none",
            background: "linear-gradient(90deg, rgba(10,36,45,0.88) 0, rgba(10,36,45,0.74) 300px, rgba(8,26,33,0.46) 640px, rgba(8,26,33,0.32) 100%)",
          }}
        >
          {/* Laut overlay image (36% opacity) – exact from artboard */}
          <img
            src={NAV_OVERLAY_BG}
            alt=""
            aria-hidden="true"
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", opacity: 0.36 }}
          />
        </div>

        {/* Layer 3 – interactive hover + gesture zone; expands 72→320px */}
        <div
          onMouseEnter={() => {
            if (hoverTimer.current) clearTimeout(hoverTimer.current);
            hoverTimer.current = setTimeout(() => setOpen(true), 140);
          }}
          onMouseLeave={close}
          onWheel={(e) => {
            const now = Date.now();
            if (now - lastWheel.current < 160) return;
            lastWheel.current = now;
            turn(e.deltaY > 0 ? 1 : -1);
          }}
          onPointerDown={(e) => { dragY.current = e.clientY; }}
          onPointerMove={(e) => {
            if (dragY.current === null) return;
            const d = e.clientY - dragY.current;
            if (Math.abs(d) > 46) { dragY.current = e.clientY; turn(d < 0 ? 1 : -1); }
          }}
          onPointerUp={() => { dragY.current = null; }}
          onPointerCancel={() => { dragY.current = null; }}
          style={{
            position: "absolute", left: 0, top: 0,
            width: open ? 320 : 72,
            height: 800,
            touchAction: "none",
            transition: "width 0.35s cubic-bezier(.3,.7,.2,1)",
          }}
        >
          {/* Fish school — rotates with arc, wobbles via nav-swim */}
          <div
            aria-hidden="true"
            style={{
              position: "absolute", left: 0, top: 0, width: 220, height: 800,
              pointerEvents: "none",
              opacity: open ? 1 : 0,
              transition: "opacity 0.35s",
              overflow: "hidden",
            }}
          >
            <NavFishSchool schoolRot={schoolRot} paused={prefersReduced} />
          </div>

          {/* Logo + "Anchoa" text */}
          <div
            role="button"
            tabIndex={0}
            aria-label="Anchoa, ke Dashboard"
            onClick={() => onSelect("dashboard")}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect("dashboard"); } }}
            style={{ position: "absolute", left: 16, top: 18, display: "flex", alignItems: "center", gap: 10, cursor: "pointer", textDecoration: "none" }}
          >
            <AnchoaLogo tile size={40} label="Logo Anchoa" />
            <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 17, fontWeight: 600, color: "#E7E9EE", opacity: open ? 1 : 0, transition: "opacity 0.25s", pointerEvents: "none", whiteSpace: "nowrap" }}>
              Anchoa
            </span>
          </div>

          {/* Up arrow — top: 150px per artboard */}
          <button
            type="button"
            onClick={() => turn(-1)}
            aria-label="Menu sebelumnya"
            style={{ position: "absolute", left: 22, top: 150, width: 28, height: 28, borderRadius: "50%", border: "1px solid #2C5868", background: "rgba(11,38,48,0.85)", color: "#CFE3EA", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", padding: 0 }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 15l6-6 6 6" /></svg>
          </button>

          {/* Position readout — left: 60 top: 157 per artboard */}
          <span
            style={{ position: "absolute", left: 60, top: 157, fontFamily: "'JetBrains Mono', monospace", fontSize: 10.5, color: "#8FB3BE", opacity: open ? 1 : 0, transition: "opacity 0.25s", pointerEvents: "none", whiteSpace: "nowrap" }}
          >
            {posText}
          </span>

          {/* Down arrow — top: 598px per artboard */}
          <button
            type="button"
            onClick={() => turn(1)}
            aria-label="Menu berikutnya"
            style={{ position: "absolute", left: 22, top: 598, width: 28, height: 28, borderRadius: "50%", border: "1px solid #2C5868", background: "rgba(11,38,48,0.85)", color: "#CFE3EA", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", padding: 0 }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
          </button>

          {/* Arc icon items — 44px circles, exact per ANCHOA_NAV items[] */}
          {items.map((it) => (
            <button
              key={it.page.id}
              type="button"
              onClick={() => onSelect(it.page.id)}
              aria-label={it.page.label}
              aria-current={it.here ? "page" : undefined}
              tabIndex={it.show ? 0 : -1}
              style={{
                position: "absolute", left: 0, top: 0,
                display: "flex", alignItems: "center", gap: 10,
                color: it.color, background: "transparent", border: "none", padding: 0,
                cursor: it.show ? "pointer" : "default",
                opacity: it.op,
                pointerEvents: it.pe,
                transform: `translate(${it.x}px, ${it.y}px) scale(${it.scale})`,
                transformOrigin: "22px 22px",
                transition: it.tr,
                textAlign: "left",
              }}
            >
              <span
                style={{
                  position: "relative", flexShrink: 0,
                  width: 44, height: 44, borderRadius: "50%", boxSizing: "border-box",
                  border: `1px solid ${it.border}`,
                  background: it.bg,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  boxShadow: it.glow,
                  pointerEvents: it.pe,
                }}
              >
                <NavSvg id={it.page.id} size={20} />
                {it.page.id === "email" && reminders > 0 && (
                  <span aria-hidden="true" style={{ position: "absolute", top: -3, right: -4, minWidth: 16, height: 16, padding: "0 4px", boxSizing: "border-box", borderRadius: 8, background: "#C6F36B", color: "#0F1115", fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5, fontWeight: 500, lineHeight: "16px", textAlign: "center" }}>
                    {reminders}
                  </span>
                )}
              </span>
              <span style={{ fontSize: it.fs, fontWeight: it.fw, whiteSpace: "nowrap", textShadow: "0 1px 3px #05141A", opacity: open && it.show ? 1 : 0, pointerEvents: "none", transition: "opacity 0.25s" }}>
                {it.page.label}
              </span>
            </button>
          ))}

          {/* Bottom stack: Notif · Profil · Pengaturan (left:14 bottom:14, gap:6) */}
          <div style={{ position: "absolute", left: 14, bottom: 14, display: "flex", flexDirection: "column", gap: 6 }}>
            {/* Notifikasi */}
            <button
              type="button"
              onClick={onToggleNotifications}
              aria-label={reminders > 0 ? `Notifikasi, ${reminders} pengingat` : "Notifikasi"}
              aria-haspopup="dialog"
              aria-expanded={notificationsOpen}
              style={{ position: "relative", width: 44, height: 44, borderRadius: 12, border: 0, padding: 0, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", background: notificationsOpen ? "rgba(22,60,72,0.9)" : "rgba(8,26,33,0.75)", color: notificationsOpen ? "#C6F36B" : "#CFE3EA" }}
            >
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z" />
                <path d="M10 20a2 2 0 0 0 4 0" />
              </svg>
              {reminders > 0 && (
                <span aria-hidden="true" style={{ position: "absolute", top: 9, right: 10, width: 7, height: 7, borderRadius: "50%", background: "#FF8A7A" }} />
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
                  aria-current={active ? "page" : undefined}
                  style={{ position: "relative", width: 44, height: 44, borderRadius: 12, border: active ? "1px solid #C6F36B" : 0, padding: 0, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", background: active ? "rgba(22,60,72,0.9)" : "rgba(8,26,33,0.75)", color: active ? "#C6F36B" : "#CFE3EA" }}
                >
                  <NavSvg id={p.id} size={19} />
                </button>
              );
            })}


          </div>
        </div>
      </nav>
    </div>
  );
}
