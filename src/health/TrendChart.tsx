import { buildPolylines, lastPoint } from "./view";

export interface TrendChartProps {
  points: (number | null)[];
  height: number;
  color: string;
  label: string;
  dot?: boolean;
}

export function TrendChart({
  points,
  height,
  color,
  label,
  dot = true,
}: Readonly<TrendChartProps>) {
  const polylines = buildPolylines(points, 100, height, 3);
  const last = dot ? lastPoint(points, 100, height, 3) : null;

  // Grid lines every 10 units when height >= 30
  const gridLines: number[] = [];
  if (height >= 30) {
    for (let y = 10; y < height; y += 10) {
      gridLines.push(y);
    }
  }

  return (
    <svg
      viewBox={`0 0 100 ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
      className="block w-full overflow-visible"
      style={{ height }}
    >
      {gridLines.map((y) => (
        <line
          key={y}
          x1="0"
          y1={y}
          x2="100"
          y2={y}
          stroke="#22343A"
          strokeWidth="0.3"
        />
      ))}
      {polylines.map((pts, i) => (
        <polyline
          key={i}
          points={pts}
          fill="none"
          stroke={color}
          strokeWidth="0.7"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {last && (
        <circle
          cx={last.x}
          cy={last.y}
          r="1.4"
          fill={color}
          vectorEffect="non-scaling-stroke"
        />
      )}
    </svg>
  );
}
