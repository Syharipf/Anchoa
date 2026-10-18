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
      className="flex flex-col gap-1.5 rounded-[12px] border border-line bg-surface p-2.5"
    >
      <div className="flex items-center justify-between px-1">
        <span className="font-display text-[11px] font-semibold uppercase tracking-wider text-muted">
          Pipeline Siklus Pengerjaan AI
        </span>
        <span className="font-mono text-[11px] text-accent">
          Tahap {currentStage}/6:{" "}
          {currentStage === 1 && "Penyusunan PRD"}
          {currentStage === 2 && "Validasi Arsitektur"}
          {currentStage === 3 && "Antrean Rencana"}
          {currentStage === 4 && "Coding AI (Harness Aktif)"}
          {currentStage === 5 && "Pengujian & Review"}
          {currentStage === 6 && "Selesai / Siap Rilis"}
        </span>
      </div>

      <div className="w-full overflow-x-auto">
        <svg
          viewBox="0 0 1150 46"
          className="block h-[46px] w-[1150px] min-w-[1150px] overflow-visible"
          fill="none"
        >
          {/* Connector Lines */}
          <line
            x1="160"
            y1="23"
            x2="230"
            y2="23"
            stroke={currentStage > 1 ? "#4E6A26" : "#22343A"}
            strokeWidth="2.5"
          />
          <line
            x1="390"
            y1="23"
            x2="460"
            y2="23"
            stroke={currentStage > 2 ? "#4E6A26" : "#22343A"}
            strokeWidth="2.5"
          />
          <line
            x1="620"
            y1="23"
            x2="690"
            y2="23"
            stroke={currentStage >= 4 ? "#C6F36B" : "#22343A"}
            strokeWidth="2.5"
            strokeDasharray={currentStage === 4 ? "6 4" : undefined}
            className={currentStage === 4 ? "animate-pulse" : undefined}
          />
          <line
            x1="850"
            y1="23"
            x2="920"
            y2="23"
            stroke={currentStage > 4 ? "#4E6A26" : "#22343A"}
            strokeWidth="2"
            strokeDasharray="4 4"
          />
          <line
            x1="1040"
            y1="23"
            x2="1080"
            y2="23"
            stroke={currentStage === 6 ? "#4E6A26" : "#22343A"}
            strokeWidth="2"
            strokeDasharray="4 4"
          />

          {/* Node 1: PRD & Bisnis */}
          <g
            transform="translate(10, 6)"
            className="cursor-pointer"
            onClick={() => onSelectStage?.(1)}
          >
            <rect
              width="150"
              height="34"
              rx="8"
              fill="#121D21"
              stroke={currentStage === 1 ? "#C6F36B" : status.hasPrd ? "#4E6A26" : "#22343A"}
              strokeWidth={currentStage === 1 ? "2" : "1.5"}
            />
            <circle cx="20" cy="17" r="8" fill={status.hasPrd ? "#1E2A12" : "#18262B"} />
            {status.hasPrd ? (
              <path
                d="M16 17l3 3 5-5"
                stroke="#C6F36B"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            ) : (
              <circle cx="20" cy="17" r="3" fill="#94A8AE" />
            )}
            <text
              x="36"
              y="16"
              fill="#E6EEF0"
              fontFamily="sans-serif"
              fontSize="11.5"
              fontWeight="600"
            >
              1. PRD &amp; Bisnis
            </text>
            <text
              x="36"
              y="27"
              fill={status.hasPrd ? "#86B33A" : "#94A8AE"}
              fontFamily="monospace"
              fontSize="9.5"
            >
              {status.hasPrd ? "Tersedia ✓" : "Belum Ada"}
            </text>
          </g>

          {/* Node 2: Arsitektur / Flow */}
          <g
            transform="translate(240, 6)"
            className="cursor-pointer"
            onClick={() => onSelectStage?.(2)}
          >
            <rect
              width="150"
              height="34"
              rx="8"
              fill="#121D21"
              stroke={currentStage === 2 ? "#C6F36B" : status.hasFlow ? "#4E6A26" : "#22343A"}
              strokeWidth={currentStage === 2 ? "2" : "1.5"}
            />
            <circle cx="20" cy="17" r="8" fill={status.hasFlow ? "#1E2A12" : "#18262B"} />
            {status.hasFlow ? (
              <path
                d="M16 17l3 3 5-5"
                stroke="#C6F36B"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            ) : (
              <circle cx="20" cy="17" r="3" fill="#94A8AE" />
            )}
            <text
              x="36"
              y="16"
              fill="#E6EEF0"
              fontFamily="sans-serif"
              fontSize="11.5"
              fontWeight="600"
            >
              2. Arsitektur
            </text>
            <text
              x="36"
              y="27"
              fill={status.hasFlow ? "#86B33A" : "#94A8AE"}
              fontFamily="monospace"
              fontSize="9.5"
            >
              {status.hasFlow ? "Graf Valid ✓" : "Draf Kosong"}
            </text>
          </g>

          {/* Node 3: Rencana Kanban */}
          <g
            transform="translate(470, 6)"
            className="cursor-pointer"
            onClick={() => onSelectStage?.(3)}
          >
            <rect
              width="150"
              height="34"
              rx="8"
              fill="#121D21"
              stroke={currentStage === 3 ? "#C6F36B" : "#22343A"}
              strokeWidth={currentStage === 3 ? "2" : "1.5"}
            />
            <circle cx="20" cy="17" r="8" fill="#18262B" />
            <text
              x="17"
              y="20"
              fill="#C6F36B"
              fontFamily="monospace"
              fontSize="10"
              fontWeight="bold"
            >
              {status.planCount}
            </text>
            <text
              x="36"
              y="16"
              fill="#E6EEF0"
              fontFamily="sans-serif"
              fontSize="11.5"
              fontWeight="600"
            >
              3. Rencana
            </text>
            <text
              x="36"
              y="27"
              fill="#94A8AE"
              fontFamily="monospace"
              fontSize="9.5"
            >
              {status.planCount} Task Antre
            </text>
          </g>

          {/* Node 4: Coding AI / Harness */}
          <g
            transform="translate(700, 6)"
            className="cursor-pointer"
            onClick={() => onSelectStage?.(4)}
          >
            <rect
              width="150"
              height="34"
              rx="8"
              fill={currentStage === 4 ? "#18262B" : "#121D21"}
              stroke={currentStage === 4 ? "#C6F36B" : "#22343A"}
              strokeWidth={currentStage === 4 ? "2" : "1"}
            />
            {currentStage === 4 ? (
              <circle cx="20" cy="17" r="5" fill="#C6F36B" className="animate-pulse" />
            ) : (
              <circle cx="20" cy="17" r="5" fill="#18262B" />
            )}
            <text
              x="36"
              y="16"
              fill={currentStage === 4 ? "#C6F36B" : "#E6EEF0"}
              fontFamily="sans-serif"
              fontSize="11.5"
              fontWeight="600"
            >
              4. Coding (omp)
            </text>
            <text
              x="36"
              y="27"
              fill={currentStage === 4 ? "#DDFA9E" : "#94A8AE"}
              fontFamily="monospace"
              fontSize="9.5"
            >
              {status.doingCount > 0 ? `${status.doingCount} Aktif di Repo` : "Idle"}
            </text>
          </g>

          {/* Node 5: Tes & Review */}
          <g
            transform="translate(930, 6)"
            className="cursor-pointer"
            onClick={() => onSelectStage?.(5)}
          >
            <rect
              width="150"
              height="34"
              rx="8"
              fill="#121D21"
              stroke={currentStage === 5 ? "#C6F36B" : "#22343A"}
              strokeWidth={currentStage === 5 ? "2" : "1"}
            />
            <circle cx="20" cy="17" r="7" fill="#18262B" />
            <text
              x="17"
              y="20"
              fill="#94A8AE"
              fontFamily="monospace"
              fontSize="9"
            >
              {status.testReviewCount}
            </text>
            <text
              x="36"
              y="16"
              fill={currentStage === 5 ? "#C6F36B" : "#94A8AE"}
              fontFamily="sans-serif"
              fontSize="11.5"
              fontWeight={currentStage === 5 ? "600" : "500"}
            >
              5. Tes &amp; Review
            </text>
            <text
              x="36"
              y="27"
              fill="#556C73"
              fontFamily="monospace"
              fontSize="9.5"
            >
              {status.testReviewCount} Task
            </text>
          </g>
        </svg>
      </div>
    </section>
  );
}
