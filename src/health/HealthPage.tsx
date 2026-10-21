import { useCallback, useEffect, useState } from "react";
import {
  api,
  errorMessage,
  type HealthDayRow,
  type HealthSeries,
  type HealthToday,
} from "../api";
import { useToast } from "../shell/toast";
import { dateInputToMs, fullDate } from "../format";
import { TrendChart } from "./TrendChart";
import { TodayFields } from "./TodayFields";
import { HealthHistory } from "./HealthHistory";
import { formatValue } from "./view";

export function HealthPage() {
  const toast = useToast();
  const [today, setToday] = useState<HealthToday | null>(null);
  const [weightSeries, setWeightSeries] = useState<HealthSeries | null>(null);
  const [sleepSeries, setSleepSeries] = useState<HealthSeries | null>(null);
  const [stepSeries, setStepSeries] = useState<HealthSeries | null>(null);
  const [history, setHistory] = useState<HealthDayRow[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    try {
      const [t, w, s, st, h] = await Promise.all([
        api.healthToday(),
        api.healthSeries("weight_g", 90),
        api.healthSeries("sleep_min", 30),
        api.healthSeries("steps", 30),
        api.healthHistory(14),
      ]);
      setToday(t);
      setWeightSeries(w);
      setSleepSeries(s);
      setStepSeries(st);
      setHistory(h);
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const allNull =
    today !== null &&
    today.fields.every((f) => f.value === null) &&
    history.every(
      (r) =>
        r.weightG === null &&
        r.sleepMin === null &&
        r.steps === null &&
        r.restingHr === null,
    );

  const lastWeight = weightSeries?.points
    ?.slice()
    .reverse()
    .find((p): p is number => p !== null);

  return (
    <div className="flex flex-1 min-h-0 flex-col gap-3.5">
      {/* Header */}
      <div className="flex items-end justify-between gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h1 className="m-0 font-display text-[28px] font-semibold tracking-[-0.01em] text-ink">
            Health
          </h1>
          <span className="text-[13px] text-muted">
            Daily metrics, trends, and history
          </span>
        </div>
        {today?.date ? (
          <span className="flex h-[34px] items-center gap-2 rounded-[10px] border border-line bg-surface px-3 font-mono text-xs text-ink">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <rect x="3" y="5" width="18" height="16" rx="2" />
              <path d="M3 10h18M8 3v4M16 3v4" />
            </svg>
            {fullDate(dateInputToMs(today.date) ?? Date.now())}
          </span>
        ) : null}
      </div>

      {loading ? (
        <div className="flex flex-1 items-center justify-center py-12 text-muted">
          Loading health data…
        </div>
      ) : allNull ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 py-16 text-center">
          <div className="rounded-[14px] border border-line bg-surface p-8">
            <h2 className="mb-2 font-display text-lg font-semibold text-ink">
              No data yet
            </h2>
            <p className="max-w-md text-sm text-muted">
              Start logging your weight, sleep, steps, and resting heart rate
              today. All metrics stay private on this device.
            </p>
          </div>
          <TodayFields today={today} onSaved={loadData} />
        </div>
      ) : (
        <div className="grid flex-1 min-h-0 grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] gap-4">
          {/* Left Column */}
          <div className="flex min-h-0 flex-col gap-3.5 overflow-hidden">
            <TodayFields today={today} onSaved={loadData} />

            {/* Weight trend 90 days */}
            <section
              aria-labelledby="hl-weight"
              className="flex flex-col gap-1.5 rounded-[14px] border border-line bg-surface p-3 px-4 pb-2.5"
            >
              <div className="flex items-baseline gap-2.5">
                <h2
                  id="hl-weight"
                  className="m-0 font-display text-[15px] font-semibold text-ink"
                >
                  Weight trend{" "}
                  <span className="font-normal text-muted">· 90 days</span>
                </h2>
                <span className="flex-1" />
                <span className="font-mono text-xs text-ink">
                  {lastWeight ? `${formatValue("weight_g", lastWeight)} kg` : "—"}
                </span>
              </div>

              <TrendChart
                points={weightSeries?.points ?? []}
                height={40}
                color="#C6F36B"
                label="Weight over the last 90 days"
              />

              <div className="flex items-center gap-3.5 font-mono text-[11px] text-muted">
                <span>
                  Min{" "}
                  <span className="text-ink">
                    {formatValue("weight_g", weightSeries?.min ?? null)}{" "}
                    {weightSeries?.min ? "kg" : ""}
                  </span>
                </span>
                <span>
                  Avg{" "}
                  <span className="text-ink">
                    {formatValue("weight_g", weightSeries?.avg ?? null)}{" "}
                    {weightSeries?.avg ? "kg" : ""}
                  </span>
                </span>
                <span>
                  Max{" "}
                  <span className="text-ink">
                    {formatValue("weight_g", weightSeries?.max ?? null)}{" "}
                    {weightSeries?.max ? "kg" : ""}
                  </span>
                </span>
              </div>
            </section>

            {/* Sleep & steps trend 30 days */}
            <section
              aria-labelledby="hl-sleep"
              className="flex min-h-0 flex-1 flex-col gap-1.5 rounded-[14px] border border-line bg-surface p-3 px-4 pb-2.5"
            >
              <div className="flex items-baseline gap-2.5">
                <h2
                  id="hl-sleep"
                  className="m-0 font-display text-[15px] font-semibold text-ink"
                >
                  Sleep &amp; steps{" "}
                  <span className="font-normal text-muted">· 30 days</span>
                </h2>
                <span className="flex-1" />
                <span className="flex items-center gap-2.5 text-[11px] text-muted">
                  <span className="inline-flex items-center gap-1">
                    <span className="h-[2px] w-3.5 bg-accent" />
                    Sleep
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className="h-[2px] w-3.5 bg-[#5E9AAA]" />
                    Steps
                  </span>
                </span>
              </div>

              <div className="relative flex-1 min-h-[60px]">
                <div className="absolute inset-0">
                  <TrendChart
                    points={stepSeries?.points ?? []}
                    height={30}
                    color="#5E9AAA"
                    label="Steps over the last 30 days"
                    dot={false}
                  />
                </div>
                <div className="absolute inset-0">
                  <TrendChart
                    points={sleepSeries?.points ?? []}
                    height={30}
                    color="#C6F36B"
                    label="Sleep over the last 30 days"
                    dot={false}
                  />
                </div>
              </div>

              <div className="flex items-center gap-3.5 font-mono text-[11px] text-muted">
                <span>
                  Sleep avg{" "}
                  <span className="text-ink">
                    {formatValue("sleep_min", sleepSeries?.avg ?? null)}
                  </span>
                </span>
                <span>
                  Steps avg{" "}
                  <span className="text-ink">
                    {formatValue("steps", stepSeries?.avg ?? null)}
                  </span>
                </span>
                <span className="flex-1" />
                <span>Gaps are days without data</span>
              </div>
            </section>
          </div>

          {/* Right Column */}
          <div className="flex min-h-0 flex-col gap-3.5 overflow-hidden">
            <HealthHistory history={history} todayDate={today?.date} />

            <section
              aria-labelledby="hl-tip"
              className="flex flex-col gap-1.5 rounded-[14px] border border-line bg-surface-2 p-3 px-4 pr-20"
            >
              <h2
                id="hl-tip"
                className="m-0 font-display text-[13px] font-semibold text-ink"
              >
                One row per day
              </h2>
              <p className="m-0 text-[11.5px] leading-relaxed text-muted">
                Missing values stay empty instead of becoming zero, so lines
                break where there is no data. Health never leaves this device.
              </p>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
