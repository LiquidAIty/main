import React, { useEffect, useMemo, useRef } from "react";
import * as d3 from "d3";

// Theme colors
const C = {
  bg: "#0B0C0E",
  panel: "#121317",
  border: "#2A2F36",
  text: "#E9EEF5",
  muted: "#9AA3B2",
  primary: "#6EFAFB",   // turquoise
  accent:  "#E2725B",   // terra cotta
  neutral: "#6E7E85",   // gray
};

// Types for our components
export interface TimeSeriesPoint {
  ts: string;
  y: number;
  type: 'actual' | 'forecast';
}

export interface BandPoint {
  ts: string;
  ylo: number;
  yhi: number;
}

export interface EventPoint {
  ts: string;
  entity: string;
  kind: 'news' | 'release' | 'social';
  severity: number;
  title: string;
  url?: string;
}

export interface TimeSeriesChartProps {
  series?: TimeSeriesPoint[];
  band?: BandPoint[];
  events?: EventPoint[];
  height?: number;
}

export function TimeSeriesChart({ series, band, events, height = 360 }: TimeSeriesChartProps) {
  const ref = useRef<SVGSVGElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const parsed = useMemo(() => ({
    s: (series || []).map(d => ({ ...d, t: new Date(d.ts) })),
    b: (band || []).map(d => ({ ...d, t: new Date(d.ts) })),
    e: (events || []).map(d => ({ ...d, t: new Date(d.ts) })),
  }), [series, band, events]);

  useEffect(() => {
    if (!ref.current) return;
    const svg = d3.select(ref.current);
    svg.selectAll("*").remove();

    const width = ref.current.clientWidth || 720;
    const margin = { top: 16, right: 24, bottom: 30, left: 48 };
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;

    const root = svg.attr("width", width).attr("height", height);
    const g = root.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

    const times = [...parsed.s, ...parsed.b, ...parsed.e].map(d => d.t).filter(t => !Number.isNaN(+t));
    const x = d3.scaleTime()
      .domain(times.length ? [d3.min(times) || new Date(), d3.max(times) || new Date()] : [new Date(Date.now() - 3.6e6), new Date()])
      .range([0, innerW]);

    const ys = parsed.s.map(d => d.y);
    const yMin = parsed.b.length ? d3.min(parsed.b, d => d.ylo) : d3.min(ys);
    const yMax = parsed.b.length ? d3.max(parsed.b, d => d.yhi) : d3.max(ys);
    const y = d3.scaleLinear().domain([yMin ?? 0, yMax ?? 1]).nice().range([innerH, 0]);

    g.append("g")
      .attr("transform", `translate(0,${innerH})`)
      .call(d3.axisBottom(x).ticks(6).tickSizeOuter(0))
      .selectAll("text")
      .attr("fill", C.muted);
      
    g.append("g")
      .call(d3.axisLeft(y).ticks(5).tickSizeOuter(0))
      .selectAll("text")
      .attr("fill", C.muted);

    if (parsed.b.length) {
      const area = d3.area<{ t: Date; ylo: number; yhi: number }>()
        .x(d => x(d.t))
        .y0(d => y(d.ylo))
        .y1(d => y(d.yhi))
        .curve(d3.curveMonotoneX);
      g.append("path")
        .datum(parsed.b)
        .attr("fill", C.accent)
        .attr("opacity", 0.15)
        .attr("d", area);
    }

    const line = d3.line<{ t: Date; y: number }>()
      .x(d => x(d.t))
      .y(d => y(d.y))
      .curve(d3.curveMonotoneX);
      
    const sActual = parsed.s.filter(d => d.type === 'actual');
    const sForecast = parsed.s.filter(d => d.type === 'forecast');
    
    if (sActual.length) {
      g.append("path")
        .datum(sActual)
        .attr("fill", "none")
        .attr("stroke", C.primary)
        .attr("stroke-width", 2)
        .attr("d", line);
    }
    
    if (sForecast.length) {
      g.append("path")
        .datum(sForecast)
        .attr("fill", "none")
        .attr("stroke", C.accent)
        .attr("stroke-width", 2)
        .attr("stroke-dasharray", "5 4")
        .attr("d", line);
    }

    const tt = d3.select(tooltipRef.current);
    const colorByKind = d3.scaleOrdinal<string>()
      .domain(["news", "release", "social"])
      .range(["#e15759", "#76b7b2", "#59a14f"]);
      
    const size = d3.scaleSqrt()
      .domain([0, 1])
      .range([4, 10]);

    const snapY = (t: Date) => {
      if (!parsed.s.length) return y.range()[0];
      let best = parsed.s[0], bt = Math.abs(+parsed.s[0].t - +t);
      for (let i = 1; i < parsed.s.length; i++) {
        const dt = Math.abs(+parsed.s[i].t - +t);
        if (dt < bt) {
          best = parsed.s[i];
          bt = dt;
        }
      }
      return y(best.y);
    };

    g.append("g")
      .selectAll("circle.event")
      .data(parsed.e)
      .join("circle")
      .attr("class", "event")
      .attr("cx", d => x(d.t))
      .attr("cy", d => snapY(d.t))
      .attr("r", d => size(d.severity ?? 0.3))
      .attr("fill", d => colorByKind(d.kind) || "#aaa")
      .attr("stroke", "#222")
      .attr("stroke-width", 0.6)
      .on("mouseenter", (_: any, d: any) => {
        tt.style("opacity", 1)
          .html(`<div style='font-size:12px'><b>${(d.kind || 'event').toUpperCase()}</b> · ${d.entity || ''}</div><div style='opacity:.8;font-size:11px'>${new Date(d.ts).toLocaleString()}</div><div>${d.title || ''}</div>${d.url ? ` <div><a href='${d.url}' target='_blank' rel='noopener noreferrer'>${d.url}</a></div>` : ''}`);
      })
      .on("mousemove", (ev: any) => tt.style("left", (ev.clientX + 12) + "px").style("top", (ev.clientY + 12) + "px"))
      .on("mouseleave", () => tt.style("opacity", 0));

    const vr = g.append("line")
      .attr("y1", 0)
      .attr("y2", innerH)
      .attr("stroke", "#999")
      .attr("stroke-dasharray", "2 4")
      .style("opacity", 0);
      
    root.on("mousemove", (ev: any) => {
      const [mx, my] = d3.pointer(ev, g.node());
      if (mx < 0 || mx > innerW || my < 0 || my > innerH) {
        vr.style("opacity", 0);
        return;
      }
      vr.attr("x1", mx).attr("x2", mx).style("opacity", 1);
    });
  }, [parsed, height]);

  return (
    <div className="w-full">
      <svg ref={ref} className="w-full" />
      <div 
        ref={tooltipRef} 
        className="fixed pointer-events-none bg-black text-white text-xs px-3 py-2 rounded-md shadow-xl" 
        style={{ opacity: 0, maxWidth: 360 }}
      />
    </div>
  );
}
