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
      aria-label="Project Pipeline"
      className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-5 shadow-sm"
    >
      <div className="flex items-center justify-between px-1">
        <span className="font-display text-xs font-semibold uppercase tracking-wider text-muted">
          AI Work Cycle Pipeline
        </span>
        <span className="font-mono text-xs font-medium text-accent">
          Stage {currentStage}/6:{" "}
          {currentStage === 1 && "PRD Drafting"}
          {currentStage === 2 && "Architecture Validation"}
          {currentStage === 3 && "Plan Queue"}
          {currentStage === 4 && "AI Coding (Harness Active)"}
          {currentStage === 5 && "Testing & Review"}
          {currentStage === 6 && "Complete / Ready to Release"}
        </span>
      </div>

      {/* Spacious container with bottom padding so scrollbar NEVER overlays text */}
      <div className="w-full overflow-x-auto pb-4">
        <svg
          viewBox="0 0 1160 76"
          className="block h-[76px] w-[1160px] min-w-[1160px] overflow-visible"
          fill="none"
        >
          {/* Connector Lines centered at y=30 */}
          <line
            x1="170"
            y1="30"
            x2="240"
            y2="30"
            stroke={currentStage > 1 ? "#4E6A26" : "#22343A"}
            strokeWidth="3"
          />
          <line
            x1="410"
            y1="30"
            x2="480"
            y2="30"
            stroke={currentStage > 2 ? "#4E6A26" : "#22343A"}
            strokeWidth="3"
          />
          <line
            x1="650"
            y1="30"
            x2="720"
            y2="30"
            stroke={currentStage >= 4 ? "#C6F36B" : "#22343A"}
            strokeWidth="3"
            strokeDasharray={currentStage === 4 ? "8 5" : undefined}
            className={currentStage === 4 ? "animate-pulse" : undefined}
          />
          <line
            x1="890"
            y1="30"
            x2="960"
            y2="30"
            stroke={currentStage > 4 ? "#4E6A26" : "#22343A"}
            strokeWidth="2.5"
            strokeDasharray="4 4"
          />
          <line
            x1="1090"
            y1="30"
            x2="1120"
            y2="30"
            stroke={currentStage === 6 ? "#4E6A26" : "#22343A"}
            strokeWidth="2.5"
            strokeDasharray="4 4"
          />

          {/* Node 1: PRD & Bisnis */}
          <g
            role="button"
            tabIndex={0}
            aria-label="1. PRD & Scope"
            transform="translate(10, 6)"
            className="cursor-pointer outline-none focus:opacity-80"
            onClick={() => onSelectStage?.(1)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelectStage?.(1);
              }
            }}
          >
            <rect
              width="160"
              height="48"
              rx="10"
              fill="#121D21"
              stroke={currentStage === 1 ? "#C6F36B" : status.hasPrd ? "#4E6A26" : "#22343A"}
              strokeWidth={currentStage === 1 ? "2.5" : "1.5"}
            />
            <circle cx="24" cy="24" r="10" fill={status.hasPrd ? "#1E2A12" : "#18262B"} />
            {status.hasPrd ? (
              <path
                d="M19 24l3 3 6-6"
                stroke="#C6F36B"
                strokeWidth="2"
                strokeLinecap="round"
              />
            ) : (
              <circle cx="24" cy="24" r="4" fill="#94A8AE" />
            )}
            <text
              x="42"
              y="22"
              fill="#E6EEF0"
              fontFamily="sans-serif"
              fontSize="12.5"
              fontWeight="600"
            >
              1. PRD &amp; Business
            </text>
            <text
              x="42"
              y="37"
              fill={status.hasPrd ? "#86B33A" : "#94A8AE"}
              fontFamily="monospace"
              fontSize="10.5"
            >
              {status.hasPrd ? "Available ✓" : "None"}
            </text>
          </g>

          {/* Node 2: Arsitektur / Flow */}
          <g
            role="button"
            tabIndex={0}
            aria-label="2. Architecture"
            transform="translate(250, 6)"
            className="cursor-pointer outline-none focus:opacity-80"
            onClick={() => onSelectStage?.(2)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelectStage?.(2);
              }
            }}
          >
            <rect
              width="160"
              height="48"
              rx="10"
              fill="#121D21"
              stroke={currentStage === 2 ? "#C6F36B" : status.hasFlow ? "#4E6A26" : "#22343A"}
              strokeWidth={currentStage === 2 ? "2.5" : "1.5"}
            />
            <circle cx="24" cy="24" r="10" fill={status.hasFlow ? "#1E2A12" : "#18262B"} />
            {status.hasFlow ? (
              <path
                d="M19 24l3 3 6-6"
                stroke="#C6F36B"
                strokeWidth="2"
                strokeLinecap="round"
              />
            ) : (
              <circle cx="24" cy="24" r="4" fill="#94A8AE" />
            )}
            <text
              x="42"
              y="22"
              fill="#E6EEF0"
              fontFamily="sans-serif"
              fontSize="12.5"
              fontWeight="600"
            >
              2. Architecture
            </text>
            <text
              x="42"
              y="37"
              fill={status.hasFlow ? "#86B33A" : "#94A8AE"}
              fontFamily="monospace"
              fontSize="10.5"
            >
              {status.hasFlow ? "Valid Graph ✓" : "Empty Draft"}
            </text>
          </g>

          {/* Node 3: Rencana Kanban */}
          <g
            role="button"
            tabIndex={0}
            aria-label="3. Plan"
            transform="translate(490, 6)"
            className="cursor-pointer outline-none focus:opacity-80"
            onClick={() => onSelectStage?.(3)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelectStage?.(3);
              }
            }}
          >
            <rect
              width="160"
              height="48"
              rx="10"
              fill="#121D21"
              stroke={currentStage === 3 ? "#C6F36B" : "#22343A"}
              strokeWidth={currentStage === 3 ? "2.5" : "1.5"}
            />
            <circle cx="24" cy="24" r="10" fill="#18262B" />
            <text
              x="20.5"
              y="28"
              fill="#C6F36B"
              fontFamily="monospace"
              fontSize="11"
              fontWeight="bold"
            >
              {status.planCount}
            </text>
            <text
              x="42"
              y="22"
              fill="#E6EEF0"
              fontFamily="sans-serif"
              fontSize="12.5"
              fontWeight="600"
            >
              3. Plan
            </text>
            <text
              x="42"
              y="37"
              fill="#94A8AE"
              fontFamily="monospace"
              fontSize="10.5"
            >
              {status.planCount} Tasks Queued
            </text>
          </g>

          {/* Node 4: Coding AI / Harness */}
          <g
            role="button"
            tabIndex={0}
            aria-label="4. Coding"
            transform="translate(730, 6)"
            className="cursor-pointer outline-none focus:opacity-80"
            onClick={() => onSelectStage?.(4)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelectStage?.(4);
              }
            }}
          >
            <rect
              width="160"
              height="48"
              rx="10"
              fill={currentStage === 4 ? "#18262B" : "#121D21"}
              stroke={currentStage === 4 ? "#C6F36B" : "#22343A"}
              strokeWidth={currentStage === 4 ? "2.5" : "1.2"}
            />
            {currentStage === 4 ? (
              <circle cx="24" cy="24" r="7" fill="#C6F36B" className="animate-pulse" />
            ) : (
              <circle cx="24" cy="24" r="7" fill="#18262B" />
            )}
            <text
              x="42"
              y="22"
              fill={currentStage === 4 ? "#C6F36B" : "#E6EEF0"}
              fontFamily="sans-serif"
              fontSize="12.5"
              fontWeight="600"
            >
              4. Coding (omp)
            </text>
            <text
              x="42"
              y="37"
              fill={currentStage === 4 ? "#DDFA9E" : "#94A8AE"}
              fontFamily="monospace"
              fontSize="10.5"
            >
              {status.doingCount > 0 ? `${status.doingCount} Active in Repo` : "Idle"}
            </text>
          </g>

          {/* Node 5: Tes & Review */}
          <g
            role="button"
            tabIndex={0}
            aria-label="5. Test & Review"
            transform="translate(970, 6)"
            className="cursor-pointer outline-none focus:opacity-80"
            onClick={() => onSelectStage?.(5)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelectStage?.(5);
              }
            }}
          >
            <rect
              width="160"
              height="48"
              rx="10"
              fill="#121D21"
              stroke={currentStage === 5 ? "#C6F36B" : "#22343A"}
              strokeWidth={currentStage === 5 ? "2.5" : "1.2"}
            />
            <circle cx="24" cy="24" r="9" fill="#18262B" />
            <text
              x="20.5"
              y="28"
              fill="#94A8AE"
              fontFamily="monospace"
              fontSize="10.5"
            >
              {status.testReviewCount}
            </text>
            <text
              x="42"
              y="22"
              fill={currentStage === 5 ? "#C6F36B" : "#94A8AE"}
              fontFamily="sans-serif"
              fontSize="12.5"
              fontWeight={currentStage === 5 ? "600" : "500"}
            >
              5. Test &amp; Review
            </text>
            <text
              x="42"
              y="37"
              fill="#556C73"
              fontFamily="monospace"
              fontSize="10.5"
            >
              {status.testReviewCount} Tasks
            </text>
          </g>
        </svg>
      </div>
    </section>
  );
}
