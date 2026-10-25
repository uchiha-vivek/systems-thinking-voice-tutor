"use client";

import { useId } from "react";

import type { Diagram, Point, Shape } from "@/lib/diagram";

// Text sizes in diagram units, before scaling up for big diagrams (see DiagramView).
const FONT = 13;
const LINE = 15;
const SIGN: Record<string, string> = { "+": "+", "-": "−", "?": "?" };

const path = (pts: Point[]) => pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");

function Label({ s, k }: { s: Shape; k: number }) {
  const n = s.label.length;
  const size = FONT * k;
  const gap = LINE * k;
  let x = s.x;
  let y: number;
  let anchor: "middle" | "start" | "end" = "middle";
  switch (s.labelSide) {
    case "center":
      y = s.y - ((n - 1) * gap) / 2 + size / 3;
      break;
    case "top":
      y = s.y - s.h / 2 - 6 - (n - 1) * gap;
      break;
    case "left":
      x = s.x - s.w / 2 - 6;
      anchor = "end";
      y = s.y - ((n - 1) * gap) / 2 + size / 3;
      break;
    case "right":
      x = s.x + s.w / 2 + 6;
      anchor = "start";
      y = s.y - ((n - 1) * gap) / 2 + size / 3;
      break;
    default:
      y = s.y + s.h / 2 + size + 2;
  }
  return (
    <text x={x} y={y} textAnchor={anchor} fontSize={size} fill="var(--fg)" fontStyle={s.kind === "alias" ? "italic" : undefined}>
      {s.label.map((line, i) => (
        <tspan key={i} x={x} dy={i ? gap : 0}>
          {line}
        </tspan>
      ))}
    </text>
  );
}

function Cloud({ at: [x, y] }: { at: Point }) {
  return (
    <g fill="var(--surface)" stroke="var(--muted)" strokeWidth={1.2}>
      <circle cx={x - 6} cy={y + 2} r={6} />
      <circle cx={x + 6} cy={y + 2} r={6} />
      <circle cx={x} cy={y - 4} r={7} />
    </g>
  );
}

/** Where to write an arrow's +/− sign: near its head, a little to one side. */
function signSpot(pts: Point[]): Point {
  const i = Math.max(1, Math.floor(pts.length * 0.8));
  const [x0, y0] = pts[i - 1];
  const [x1, y1] = pts[i];
  const len = Math.hypot(x1 - x0, y1 - y0) || 1;
  return [x1 + ((y0 - y1) / len) * 10, y1 + ((x1 - x0) / len) * 10];
}

/** The model's stock-and-flow diagram, drawn from the positions saved in the Stella file. */
export function DiagramView({ diagram, title }: { diagram: Diagram; title: string }) {
  const id = useId();
  const arrowHead = `${id}-arrow`;
  const pipeHead = `${id}-pipe`;
  const [bx, by, bw, bh] = diagram.box;
  // A big model is shrunk to fit the page, so grow its text to stay readable.
  const k = Math.min(2, Math.max(1, Math.max(bw, bh) / 900));

  return (
    <figure className="rounded-2xl border border-line bg-surface p-3 shadow-card sm:p-4">
      <svg
        viewBox={`${bx} ${by} ${bw} ${bh}`}
        className="h-auto max-h-[75vh] w-full"
        aria-hidden="true"
        fontFamily="inherit"
      >
        <defs>
          <marker id={arrowHead} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" fill="var(--fg)" />
          </marker>
          <marker id={pipeHead} viewBox="0 0 10 10" refX="5" refY="5" markerWidth="4" markerHeight="4" orient="auto">
            <path d="M0 0 L10 5 L0 10 z" fill="var(--fg)" />
          </marker>
        </defs>

        {diagram.pipes.map((p, i) => (
          <g key={`pipe${i}`}>
            <path d={path(p.points)} fill="none" stroke="var(--fg)" strokeWidth={7} strokeLinejoin="round" markerEnd={`url(#${pipeHead})`} />
            <path d={path(p.points)} fill="none" stroke="var(--surface)" strokeWidth={3.5} strokeLinejoin="round" />
            {p.cloudStart && <Cloud at={p.points[0]} />}
            {p.cloudEnd && <Cloud at={p.points[p.points.length - 1]} />}
          </g>
        ))}

        {diagram.arrows.map((a, i) => {
          const [sx, sy] = signSpot(a.points);
          return (
            <g key={`arrow${i}`}>
              <path d={path(a.points)} fill="none" stroke="var(--fg)" strokeWidth={1.3} markerEnd={`url(#${arrowHead})`} />
              {a.polarity && (
                <text x={sx} y={sy + 5 * k} textAnchor="middle" fontSize={15 * k} fontWeight={700} fill="var(--accent)">
                  {SIGN[a.polarity]}
                </text>
              )}
            </g>
          );
        })}

        {diagram.shapes.map((s, i) => (
          <g key={`shape${i}`}>
            {s.kind === "stock" ? (
              <rect x={s.x - s.w / 2} y={s.y - s.h / 2} width={s.w} height={s.h} fill="var(--tint)" stroke="var(--fg)" strokeWidth={1.5} />
            ) : (
              <circle
                cx={s.x}
                cy={s.y}
                r={Math.max(s.w, s.h) / 2}
                fill="var(--surface)"
                stroke="var(--fg)"
                strokeWidth={1.3}
                strokeDasharray={s.kind === "alias" ? "3 2" : undefined}
              />
            )}
            <Label s={s} k={k} />
          </g>
        ))}

        {diagram.loops.map((l, i) => (
          <g key={`loop${i}`}>
            <circle cx={l.x} cy={l.y} r={l.r} fill="var(--surface)" stroke="var(--accent)" strokeWidth={2} />
            <text x={l.x} y={l.y + 6 * k} textAnchor="middle" fontSize={17 * k} fontWeight={700} fill="var(--accent)">
              {l.text}
            </text>
          </g>
        ))}
      </svg>
      <figcaption className="mt-2 px-1 text-sm text-muted">
        {title}, drawn from your file. On each arrow, + means both change the same way, − means opposite, and ? means unclear.
      </figcaption>
    </figure>
  );
}
