/** [rotation°, distance from the rim, scale, opacity] for each anchovy (DESIGN.md §4). */
const FISH: [number, number, number, number][] = [
  [198, 24, 0.95, 0.15], [215, 20, 0.77, 0.21], [221, 19, 0.78, 0.17], [237, 13, 0.82, 0.2],
  [250, 11, 1.0, 0.24], [264, 25, 1.12, 0.23], [264, 24, 0.93, 0.33], [274, 17, 1.07, 0.27],
  [288, 25, 0.86, 0.26], [299, 19, 0.98, 0.34], [305, 21, 1.19, 0.37], [311, 17, 1.1, 0.42],
  [326, 21, 1.3, 0.29], [331, 14, 0.97, 0.38], [335, 15, 1.25, 0.41], [353, 21, 1.24, 0.43],
  [358, 19, 1.32, 0.52], [365, 15, 0.99, 0.48], [376, 10, 1.35, 0.4], [381, 15, 1.0, 0.45],
  [386, 24, 1.03, 0.55], [394, 22, 1.2, 0.59], [401, 19, 1.3, 0.61], [418, 12, 1.18, 0.5],
  [420, 12, 1.53, 0.43], [426, 22, 1.19, 0.55],
];
const BODY = "M-7 0C-3-2.4 3-2.6 7 0C3 2.6-3 2.4-7 0ZM-6 0L-10.5-2.8L-9.2 0L-10.5 2.8Z";

/** Ring of anchovies around the avatar, rotated as one element. */
export function School({ color, dimmed, running }: Readonly<{ color: string; dimmed: boolean; running: boolean }>) {
  return (
    <svg
      data-anim
      width="300"
      height="300"
      viewBox="0 0 300 300"
      aria-hidden="true"
      className="absolute bottom-[123px] left-1/2 -ml-[150px]"
      style={{
        color,
        fill: "currentColor",
        opacity: dimmed ? 0.45 : 1,
        transition: "color 0.4s, opacity 0.4s",
        animation: "anchoa-school 48s linear infinite",
        animationPlayState: running ? "running" : "paused",
      }}
    >
      {FISH.map(([rotate, distance, scale, alpha]) => (
        <g key={`${rotate}-${distance}`} transform={`rotate(${rotate} 150 150) translate(150 ${distance}) scale(${scale})`}>
          <path d={BODY} fillOpacity={alpha} />
        </g>
      ))}
    </svg>
  );
}
