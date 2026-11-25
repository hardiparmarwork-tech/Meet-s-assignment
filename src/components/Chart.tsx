"use client";
import { useEffect, useRef, useState } from "react";
import type { MetricView } from "@/lib/view";
import { fmtNumber } from "@/lib/mapping/validate";
import { compact, fmtDate } from "@/lib/format";

// Validated with the dataviz palette checker (light surface): CVD, lightness, chroma and contrast pass.
export const SERIES_COLORS = ["#2461a8", "#b85c1e", "#00896b"];

export function Sparkline({ m }: { m: MetricView }) {
  const from = (m.paperYear ?? m.series.at(-1)!.period) - 15;
  const pts = m.series.filter((o) => o.period >= from);
  if (pts.length < 2) return null;
  const W = 120, H = 34;
  const xs = pts.map((p) => p.period), ys = pts.map((p) => p.value);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const x = (v: number) => 3 + ((v - x0) / (x1 - x0 || 1)) * (W - 6);
  const y = (v: number) => H - 3 - ((v - y0) / (y1 - y0 || 1)) * (H - 6);
  const marked = pts.find((p) => p.period === m.paperYear);
  return (
    <svg className="spark" viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img"
      aria-label={`Source series ${x0} to ${x1}, from ${fmtNumber(pts[0].value)} to ${fmtNumber(pts.at(-1)!.value)} ${m.seriesUnit}`}>
      {marked && <line x1={x(marked.period)} x2={x(marked.period)} y1={0} y2={H} stroke="#b9b6ab" strokeDasharray="2 2" />}
      <polyline fill="none" stroke={SERIES_COLORS[0]} strokeWidth="1.75" points={pts.map((p) => `${x(p.period)},${y(p.value)}`).join(" ")} />
      <circle cx={x(x1)} cy={y(pts.at(-1)!.value)} r="2.75" fill={SERIES_COLORS[0]} />
    </svg>
  );
}

function ticks(min: number, max: number, count = 5): number[] {
  const span = max - min || Math.abs(max) || 1;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((s) => s * mag).find((s) => s >= raw)!;
  const out: number[] = [];
  for (let v = Math.floor(min / step) * step; v <= max + step * 0.999; v += step) out.push(Number(v.toPrecision(12)));
  return out;
}

type Range = "since" | "10" | "25" | "all";

export function LineChart({ metric, others }: { metric: MetricView; others: MetricView[] }) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [range, setRange] = useState<Range>("25");
  const [compare, setCompare] = useState<string[]>([]);
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new ResizeObserver(([e]) => setWidth(Math.max(280, e.contentRect.width)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Only series in the identical unit can share the single y-axis.
  const comparable = others.filter((o) => o.id !== metric.id && o.seriesUnit === metric.seriesUnit &&
    !(o.source.indicatorCode === metric.source.indicatorCode && o.geography === metric.geography))
    .filter((o, i, all) => all.findIndex((x) => x.source.indicatorCode === o.source.indicatorCode && x.geography === o.geography) === i);
  const shown = [metric, ...compare.map((id) => comparable.find((c) => c.id === id)!).filter(Boolean)];
  const lastYear = Math.max(...shown.map((s) => s.series.at(-1)!.period));
  const firstYear = range === "all" ? -Infinity : range === "since" && metric.paperYear ? (metric.calculation?.fromYear ?? metric.paperYear - 1) : lastYear - Number(range === "since" ? 10 : range);
  const lines = shown.map((s) => s.series.filter((o) => o.period >= firstYear));
  const years = [...new Set(lines.flatMap((l) => l.map((o) => o.period)))].sort((a, b) => a - b);
  const paper = !metric.calculation && metric.paperYear !== null && metric.mode === "live" ? { period: metric.paperYear, value: paperValue(metric) } : null;
  const values = [...lines.flatMap((l) => l.map((o) => o.value)), ...(paper && years.includes(paper.period) ? [paper.value] : [])];
  if (!years.length) return <p>No observations in this range.</p>;

  const yt = ticks(Math.min(...values), Math.max(...values));
  const H = 300, M = { l: 58, r: 14, t: 12, b: 44 };
  const x0 = years[0], x1 = years.at(-1)!;
  const x = (v: number) => M.l + ((v - x0) / (x1 - x0 || 1)) * (width - M.l - M.r);
  const y = (v: number) => H - M.b - ((v - yt[0]) / (yt.at(-1)! - yt[0] || 1)) * (H - M.t - M.b);
  const every = Math.max(1, Math.ceil(years.length / Math.floor((width - M.l) / 52)));
  const label = (s: MetricView) => `${s.sourceName} · ${s.geography}`;
  const hovered = hover === null ? null : years[hover];

  const move = (clientX: number, rect: DOMRect) => {
    const px = clientX - rect.left;
    let best = 0;
    years.forEach((v, i) => { if (Math.abs(x(v) - px) < Math.abs(x(years[best]) - px)) best = i; });
    setHover(best);
  };

  return (
    <figure className="chart">
      <figcaption>
        <strong>{label(metric)}</strong>
        <span>{metric.seriesUnit}, annual, {x0}–{x1}</span>
      </figcaption>
      <div className="chart-controls">
        <div role="group" aria-label="Time range">
          {([["since", "Around the study"], ["10", "10 years"], ["25", "25 years"], ["all", "All"]] as const).map(([k, text]) => (
            <button key={k} type="button" aria-pressed={range === k} onClick={() => { setRange(k); setHover(null); }}>{text}</button>
          ))}
        </div>
        <button type="button" aria-pressed={table} onClick={() => setTable(!table)}>{table ? "Hide data table" : "Show data table"}</button>
      </div>
      {comparable.length > 0 && (
        <fieldset className="compare">
          <legend>Compare series in the same unit</legend>
          {comparable.map((c) => (
            <label key={c.id}>
              <input type="checkbox" checked={compare.includes(c.id)} disabled={!compare.includes(c.id) && compare.length >= 2}
                onChange={(e) => setCompare(e.target.checked ? [...compare, c.id] : compare.filter((i) => i !== c.id))} />
              {label(c)}
            </label>
          ))}
        </fieldset>
      )}
      <ul className="legend">
        {shown.length > 1 && shown.map((s, i) => <li key={s.id}><i style={{ background: SERIES_COLORS[i] }} />{label(s)}</li>)}
        {shown.length === 1 && <li><i style={{ background: SERIES_COLORS[0] }} />Source observations (current release)</li>}
        {paper && <li><b aria-hidden>◇</b>Value reported in the paper</li>}
      </ul>
      <div ref={box} className="plot">
        <svg width={width} height={H} role="img" tabIndex={0}
          aria-label={`Line chart of ${label(metric)} in ${metric.seriesUnit}, ${x0} to ${x1}. Use left and right arrow keys to read observations.`}
          onPointerMove={(e) => move(e.clientX, e.currentTarget.getBoundingClientRect())}
          onPointerLeave={() => setHover(null)} onBlur={() => setHover(null)}
          onKeyDown={(e) => {
            if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
            e.preventDefault();
            setHover((h) => Math.min(years.length - 1, Math.max(0, (h ?? years.length) + (e.key === "ArrowLeft" ? -1 : 1))));
          }}>
          {yt.map((t) => (
            <g key={t}>
              <line x1={M.l} x2={width - M.r} y1={y(t)} y2={y(t)} stroke="#e4e1d6" />
              <text x={M.l - 7} y={y(t) + 3.5} textAnchor="end">{compact(t)}</text>
            </g>
          ))}
          {years.filter((_, i) => (years.length - 1 - i) % every === 0).map((v) => <text key={v} x={x(v)} y={H - M.b + 17} textAnchor="middle">{v}</text>)}
          <text x={(M.l + width - M.r) / 2} y={H - 6} textAnchor="middle" className="axis-title">Observation year</text>
          <text transform={`translate(11 ${(H - M.b) / 2}) rotate(-90)`} textAnchor="middle" className="axis-title">{metric.seriesUnit}</text>
          {hovered !== null && <line x1={x(hovered)} x2={x(hovered)} y1={M.t} y2={H - M.b} stroke="#8d8a7f" />}
          {lines.map((l, i) => (
            <g key={shown[i].id}>
              {l.slice(1).map((o, k) => (
                // Gaps in the record are dashed so they are not read as observed years.
                <line key={o.period} x1={x(l[k].period)} y1={y(l[k].value)} x2={x(o.period)} y2={y(o.value)} stroke={SERIES_COLORS[i]}
                  strokeWidth="2" strokeLinecap="round" strokeDasharray={o.period - l[k].period > 1 ? "3 5" : undefined} />
              ))}
              {(l.length < 30 ? l : l.slice(-1)).map((o) => <circle key={o.period} cx={x(o.period)} cy={y(o.value)} r="2.5" fill={SERIES_COLORS[i]} />)}
              {hovered !== null && l.some((o) => o.period === hovered) && <circle cx={x(hovered)} cy={y(l.find((o) => o.period === hovered)!.value)} r="4.5" fill={SERIES_COLORS[i]} stroke="#fdfcf7" strokeWidth="2" />}
            </g>
          ))}
          {paper && years.includes(paper.period) && <path d={`M${x(paper.period)} ${y(paper.value) - 6}l6 6l-6 6l-6-6z`} fill="#fdfcf7" stroke="#17191c" strokeWidth="1.75" />}
        </svg>
        {hovered !== null && (
          <div className="tooltip" role="status" style={x(hovered) > width / 2 ? { right: width - x(hovered) + 10 } : { left: x(hovered) + 10 }}>
            <strong>{hovered}</strong>
            {lines.map((l, i) => {
              const o = l.find((p) => p.period === hovered);
              return <span key={shown[i].id}><i style={{ background: SERIES_COLORS[i] }} />{o ? `${fmtNumber(o.value)} ${metric.seriesUnit}` : "no observation"}</span>;
            })}
            {paper?.period === hovered && <span>◇ Paper: {metric.originalRaw}</span>}
          </div>
        )}
      </div>
      <p className="chart-note">
        Source: {shown.map((s) => s.source.citation).filter((v, i, a) => a.indexOf(v) === i).join("; ")}. Retrieved {fmtDate(metric.retrievedAt, true)}.
        {metric.source.providerUpdated && ` Provider dataset updated ${metric.source.providerUpdated}.`} {metric.methodology} Dashed segments span years with no observation. The vertical axis does not necessarily start at zero.
      </p>
      {table && (
        <div className="scroll">
          <table>
            <caption>Observations shown in the chart ({metric.seriesUnit})</caption>
            <thead><tr><th>Year</th>{shown.map((s) => <th key={s.id}>{label(s)}</th>)}</tr></thead>
            <tbody>
              {[...years].reverse().map((v) => (
                <tr key={v}><th scope="row">{v}</th>{lines.map((l, i) => <td key={shown[i].id}>{l.find((o) => o.period === v)?.value.toLocaleString("en-US", { maximumFractionDigits: 4 }) ?? "—"}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </figure>
  );
}

/** The paper's number, parsed from what it wrote, in the source's unit. */
function paperValue(m: MetricView): number {
  const n = Number(m.originalRaw.replace(/,/g, "").match(/\d+(\.\d+)?/)?.[0] ?? NaN);
  const scale = /trillion/i.test(m.originalRaw) ? 1e12 : /billion/i.test(m.originalRaw) ? 1e9 : /million/i.test(m.originalRaw) ? 1e6 : /thousand(?! live)/i.test(m.originalRaw) ? 1e3 : 1;
  return n * scale * (/tonnes? per hectare|t\/ha/i.test(m.originalRaw) ? 1000 : 1);
}
