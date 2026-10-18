export type PipelineStage = 1 | 2 | 3 | 4 | 5 | 6;

export interface PipelineStatus {
  hasPrd: boolean;
  hasFlow: boolean;
  planCount: number;
  doingCount: number;
  testReviewCount: number;
  doneCount: number;
}

export function calculateActiveStage(status: PipelineStatus): PipelineStage {
  if (!status.hasPrd) return 1;
  if (!status.hasFlow) return 2;
  if (status.doingCount > 0) return 4;
  if (status.planCount > 0) return 3;
  if (status.testReviewCount > 0) return 5;
  return 6;
}

export function PipelineTracker({
  status,
  activeStage: overrideStage,
  onSelectStage,
}: Readonly<{
  status: PipelineStatus;
  activeStage?: PipelineStage;
  onSelectStage?: (stage: PipelineStage) => void;
}>) {
  const currentStage = overrideStage ?? calculateActiveStage(status);

  return (
    <section
      aria-label="Alur Pipeline Proyek"
      className="flex flex-col gap-2 rounded-2xl border border-line bg-surface p-3.5 shadow-sm"
    >
      <div className="flex items-center justify-between px-1">
        <span className="font-display text-xs font-semibold uppercase tracking-wider text-muted">
          Pipeline Siklus Pengerjaan AI
        </span>
        <span className="font-mono text-xs font-medium text-accent">
          Tahap {currentStage}/6:{" "}
          {currentStage === 1 && "Penyusunan PRD"}
          {currentStage === 2 && "Validasi Arsitektur"}
          {currentStage === 3 && "Antrean Rencana"}
          {currentStage === 4 && "Coding AI (Harness Aktif)"}
          {currentStage === 5 && "Pengujian & Review"}
          {currentStage === 6 && "Selesai / Siap Rilis"}
        </span>
      </div>

      <div className="w-full overflow-x-auto pb-0.5">
        <svg
          viewBox="0 0 1150 52"
          className="block h-[52px] w-[1150px] min-w-[1150px] overflow-visible"
          fill="none"
        >
          {/* Connector Lines */}
          <line
            x1="165"
            y1="26"
            x2="235"
            y2="26"
            stroke={currentStage > 1 ? "#4E6A26" : "#22343A"}
            strokeWidth="2.5"
          />
          <line
            x1="400"
            y1="26"
            x2="470"
            y2="26"
            stroke={currentStage > 2 ? "#4E6A26" : "#22343A"}
            strokeWidth="2.5"
          />
          <line
            x1="635"
            y1="26"
            x2="705"
            y2="26"
            stroke={currentStage >= 4 ? "#C6F36B" : "#22343A"}
            strokeWidth="2.5"
            strokeDasharray={currentStage === 4 ? "6 4" : undefined}
            className={currentStage === 4 ? "animate-pulse" : undefined}
          />
          <line
            x1="870"
            y1="26"
            x2="940"
            y2="26"
            stroke={currentStage > 4 ? "#4E6A26" : "#22343A"}
            strokeWidth="2"
            strokeDasharray="4 4"
          />
          <line
            x1="1060"
            y1="26"
            x2="1095"
            y2="26"
            stroke={currentStage === 6 ? "#4E6A26" : "#22343A"}
            strokeWidth="2"
            strokeDasharray="4 4"
          />

          {/* Node 1: PRD & Bisnis */}
          <g
            transform="translate(10, 7)"
            className="cursor-pointer"
            onClick={() => onSelectStage?.(1)}
          >
            <rect
              width="155"
              height="38"
              rx="9"
              fill="#121D21"
              stroke={currentStage === 1 ? "#C6F36B" : status.hasPrd ? "#4E6A26" : "#22343A"}
              strokeWidth={currentStage === 1 ? "2" : "1.5"}
            />
            <circle cx="22" cy="19" r="9" fill={status.hasPrd ? "#1E2A12" : "#18262B"} />
            {status.hasPrd ? (
              <path
                d="M18 19l3 3 5-5"
                stroke="#C6F36B"
                strokeWidth="2"
                strokeLinecap="round"
              />
            ) : (
              <circle cx="22" cy="19" r="3.5" fill="#94A8AE" />
            )}
            <text
              x="38"
              y="18"
              fill="#E6EEF0"
              fontFamily="sans-serif"
              fontSize="12"
              fontWeight="600"
            >
              1. PRD &amp; Bisnis
            </text>
            <text
              x="38"
              y="30"
              fill={status.hasPrd ? "#86B33A" : "#94A8AE"}
              fontFamily="monospace"
              fontSize="10"
            >
              {status.hasPrd ? "Tersedia ✓" : "Belum Ada"}
            </text>
          </g>

          {/* Node 2: Arsitektur / Flow */}
          <g
            transform="translate(245, 7)"
            className="cursor-pointer"
            onClick={() => onSelectStage?.(2)}
          >
            <rect
              width="155"
              height="38"
              rx="9"
              fill="#121D21"
              stroke={currentStage === 2 ? "#C6F36B" : status.hasFlow ? "#4E6A26" : "#22343A"}
              strokeWidth={currentStage === 2 ? "2" : "1.5"}
            />
            <circle cx="22" cy="19" r="9" fill={status.hasFlow ? "#1E2A12" : "#18262B"} />
            {status.hasFlow ? (
              <path
                d="M18 19l3 3 5-5"
                stroke="#C6F36B"
                strokeWidth="2"
                strokeLinecap="round"
              />
            ) : (
              <circle cx="22" cy="19" r="3.5" fill="#94A8AE" />
            )}
            <text
              x="38"
              y="18"
              fill="#E6EEF0"
              fontFamily="sans-serif"
              fontSize="12"
              fontWeight="600"
            >
              2. Arsitektur
            </text>
            <text
              x="38"
              y="30"
              fill={status.hasFlow ? "#86B33A" : "#94A8AE"}
              fontFamily="monospace"
              fontSize="10"
            >
              {status.hasFlow ? "Graf Valid ✓" : "Draf Kosong"}
            </text>
          </g>

          {/* Node 3: Rencana Kanban */}
          <g
            transform="translate(480, 7)"
            className="cursor-pointer"
            onClick={() => onSelectStage?.(3)}
          >
            <rect
              width="155"
              height="38"
              rx="9"
              fill="#121D21"
              stroke={currentStage === 3 ? "#C6F36B" : "#22343A"}
              strokeWidth={currentStage === 3 ? "2" : "1.5"}
            />
            <circle cx="22" cy="19" r="9" fill="#18262B" />
            <text
              x="19"
              y="22"
              fill="#C6F36B"
              fontFamily="monospace"
              fontSize="10.5"
              fontWeight="bold"
            >
              {status.planCount}
            </text>
            <text
              x="38"
              y="18"
              fill="#E6EEF0"
              fontFamily="sans-serif"
              fontSize="12"
              fontWeight="600"
            >
              3. Rencana
            </text>
            <text
              x="38"
              y="30"
              fill="#94A8AE"
              fontFamily="monospace"
              fontSize="10"
            >
              {status.planCount} Task Antre
            </text>
          </g>

          {/* Node 4: Coding AI / Harness */}
          <g
            transform="translate(715, 7)"
            className="cursor-pointer"
            onClick={() => onSelectStage?.(4)}
          >
            <rect
              width="155"
              height="38"
              rx="9"
              fill={currentStage === 4 ? "#18262B" : "#121D21"}
              stroke={currentStage === 4 ? "#C6F36B" : "#22343A"}
              strokeWidth={currentStage === 4 ? "2" : "1.2"}
            />
            {currentStage === 4 ? (
              <circle cx="22" cy="19" r="6" fill="#C6F36B" className="animate-pulse" />
            ) : (
              <circle cx="22" cy="19" r="6" fill="#18262B" />
            )}
            <text
              x="38"
              y="18"
              fill={currentStage === 4 ? "#C6F36B" : "#E6EEF0"}
              fontFamily="sans-serif"
              fontSize="12"
              fontWeight="600"
            >
              4. Coding (omp)
            </text>
            <text
              x="38"
              y="30"
              fill={currentStage === 4 ? "#DDFA9E" : "#94A8AE"}
              fontFamily="monospace"
              fontSize="10"
            >
              {status.doingCount > 0 ? `${status.doingCount} Aktif di Repo` : "Idle"}
            </text>
          </g>

          {/* Node 5: Tes & Review */}
          <g
            transform="translate(950, 7)"
            className="cursor-pointer"
            onClick={() => onSelectStage?.(5)}
          >
            <rect
              width="155"
              height="38"
              rx="9"
              fill="#121D21"
              stroke={currentStage === 5 ? "#C6F36B" : "#22343A"}
              strokeWidth={currentStage === 5 ? "2" : "1.2"}
            />
            <circle cx="22" cy="19" r="8" fill="#18262B" />
            <text
              x="19"
              y="22"
              fill="#94A8AE"
              fontFamily="monospace"
              fontSize="9.5"
            >
              {status.testReviewCount}
            </text>
            <text
              x="38"
              y="18"
              fill={currentStage === 5 ? "#C6F36B" : "#94A8AE"}
              fontFamily="sans-serif"
              fontSize="12"
              fontWeight={currentStage === 5 ? "600" : "500"}
            >
              5. Tes &amp; Review
            </text>
            <text
              x="38"
              y="30"
              fill="#556C73"
              fontFamily="monospace"
              fontSize="10"
            >
              {status.testReviewCount} Task
            </text>
          </g>
        </svg>
      </div>
    </section>
  );
}
