// Entity: Building Results
// Relationship: Draws real case channels on one time axis and shared quantity scale; null samples break lines instead of becoming zeros.
import { useEffect, useRef, useState } from 'react';

export type Comparison = {
  channel: { name: string; key: string; units: string; frequency: string };
  timeBasis: string;
  cases: { caseId: string; runId: string; revision: string; engine: string; weatherSha256: string; missing: number }[];
  rows: { time: string; intervalMinutes: number; values: (number | null)[] }[];
  summary?: null | { units: string; values: (number | null)[]; changePercent: (number | null)[] };
  energy?: null | { title: string; components: string[]; units: string;
    daily: { period: string; values: (number | null)[][] }[]; monthly: { period: string; values: (number | null)[][] }[] };
  hourly: null | { profile: { hour: number; values: (number | null)[]; sampleCounts: number[] }[];
    heatmap: { date: string; hour: number; values: (number | null)[] }[]; profileMeaning: string };
};
const colors = ['#4FA2AD', '#F2A64A', '#C694DF'];
const GRAPH_TEXT = '#A7B0BA';
const caseColor = (id: string) => colors[['baseline', 'case1', 'case2'].indexOf(id)] || colors[0];
export const caseName = (id: string) => ({ baseline: 'Baseline', case1: 'Comparison 1', case2: 'Comparison 2' }[id] || id);

export default function ResultComparison({ data, mode = 'profile' }: { data: Comparison; mode?: 'profile' | 'heatmap' | 'timeseries' | 'daily' | 'monthly' }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const draw = () => {
      const width = element.clientWidth, height = element.clientHeight;
      const dpr = window.devicePixelRatio || 1;
      element.width = Math.max(1, width * dpr); element.height = Math.max(1, height * dpr);
      const ctx = element.getContext('2d');
      if (!ctx || !data.rows.length) return;
      ctx.scale(dpr, dpr);
      if ((mode === 'daily' || mode === 'monthly') && data.energy) {
        const buckets = data.energy[mode], tones = ['#d99a54', '#4FA2AD'];
        const maximum = Math.max(1, ...buckets.flatMap(bucket => bucket.values.map(pair => pair.some(value => value === null) ? 0 : (pair[0]! + pair[1]!))));
        const panelHeight = (height - 18) / data.cases.length;
        ctx.font = '10px system-ui';
        data.cases.forEach((item, index) => {
          const top = index * panelHeight + 18, bottom = top + panelHeight - 32, left = 42, right = width - 8;
          ctx.fillStyle = GRAPH_TEXT; ctx.fillText(caseName(item.caseId), left, top - 6);
          for (let tick = 0; tick <= 2; tick++) {
            const value = maximum * tick / 2, y = bottom - value / maximum * (bottom - top);
            ctx.fillText(value.toLocaleString(undefined, {maximumSignificantDigits: 3}), 0, y + 3);
            ctx.strokeStyle = '#A7B0BA25'; ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke();
          }
          let previousLabel = -Infinity;
          buckets.forEach((bucket, column) => {
            const pair = bucket.values[index];
            const x = left + column / buckets.length * (right - left), barWidth = Math.max(.2, (right - left) / buckets.length * .8);
            let y = bottom;
            if (!pair.some(value => value === null)) pair.forEach((value, component) => {
              const h = value! / maximum * (bottom - top); ctx.fillStyle = tones[component]; ctx.fillRect(x, y - h, barWidth, h); y -= h;
            });
            if (x - previousLabel > 35) {
              ctx.fillStyle = GRAPH_TEXT; ctx.fillText(mode === 'monthly' ? bucket.period.slice(5) : bucket.period.slice(5), x, bottom + 13); previousLabel = x;
            }
          });
        });
        ctx.fillStyle = tones[0]; ctx.fillText(data.energy.components[0], 42, height - 1);
        ctx.fillStyle = tones[1]; ctx.fillText(data.energy.components[1], width / 2, height - 1);
        return;
      }
      const profile = mode === 'profile' && data.hourly;
      const plotted = profile ? data.hourly!.profile : data.rows;
      const values = plotted.flatMap(row => row.values.filter((value): value is number => value !== null));
      if (!values.length) return;
      let low = Infinity, high = -Infinity;
      for (const value of values) { low = Math.min(low, value); high = Math.max(high, value); }
      const pad = (high - low || Math.abs(high) || 1) * .06;
      if (mode === 'heatmap' && data.hourly) {
        const dates = [...new Set(data.hourly.heatmap.map(cell => cell.date))];
        const dateIndex = new Map(dates.map((date, index) => [date, index]));
        const left = 50, right = width - 16, panelHeight = (height - 42) / data.cases.length;
        const scale = high - low || 1;
        const color = (value: number) => `hsl(${220 - (value - low) / scale * 220} 70% 48%)`;
        ctx.font = '11px system-ui';
        data.cases.forEach((item, caseIndex) => {
          const top = caseIndex * panelHeight + 20, plotHeight = panelHeight - 28;
          ctx.fillStyle = caseColor(item.caseId); ctx.fillText(caseName(item.caseId), left, top - 6);
          ctx.fillStyle = '#A7B0BA'; ctx.fillText('24', 8, top + 8); ctx.fillText('00', 8, top + plotHeight);
          ctx.fillStyle = '#20272D'; ctx.fillRect(left, top, right - left, plotHeight);
          for (const cell of data.hourly!.heatmap) {
            const value = cell.values[caseIndex];
            if (value === null) continue;
            ctx.fillStyle = color(value);
            ctx.fillRect(left + dateIndex.get(cell.date)! / dates.length * (right - left), top + (23 - cell.hour) / 24 * plotHeight,
              (right - left) / dates.length + .2, plotHeight / 24 + .2);
          }
        });
        const gradient = ctx.createLinearGradient(left, 0, right, 0);
        for (let step = 0; step <= 10; step++) gradient.addColorStop(step / 10, color(low + scale * step / 10));
        ctx.fillStyle = gradient; ctx.fillRect(left, height - 27, right - left, 8);
        ctx.fillStyle = '#A7B0BA'; ctx.fillText(`${low.toPrecision(4)} ${data.channel.units} · ${dates[0]}`, left, height - 3);
        ctx.textAlign = 'right'; ctx.fillText(`${dates[dates.length - 1]} · ${high.toPrecision(4)} ${data.channel.units}`, right, height - 3);
        return;
      }
      low -= pad; high += pad;
      const left = 75, right = width - 20, top = 20, bottom = height - 30;
      const times = profile ? data.hourly!.profile.map(row => row.hour) : data.rows.map(row => Date.parse(row.time + ':00Z'));
      const first = times[0], span = times[times.length - 1] - first || 1;
      const x = (i: number) => left + (times[i] - first) / span * (right - left);
      const y = (value: number) => bottom - (value - low) / (high - low) * (bottom - top);
      ctx.font = '11px system-ui'; ctx.fillStyle = '#A7B0BA'; ctx.strokeStyle = '#A7B0BA30';
      for (let tick = 0; tick <= 4; tick++) {
        const value = low + (high - low) * tick / 4;
        const py = y(value);
        ctx.beginPath(); ctx.moveTo(left, py); ctx.lineTo(right, py); ctx.stroke();
        ctx.fillText(value.toLocaleString(undefined, { maximumSignificantDigits: 4 }), 5, py + 4);
      }
      for (let c = data.cases.length - 1; c >= 0; c--) {
        ctx.strokeStyle = caseColor(data.cases[c].caseId); ctx.globalAlpha = profile ? 1 : .65; ctx.lineWidth = profile ? 1.5 : 1; ctx.beginPath();
        let connected = false;
        plotted.forEach((row, index) => {
          const value = row.values[c];
          if (value === null) { connected = false; return; }
          const gap = !profile && index > 0 && times[index] - times[index - 1] > data.rows[index].intervalMinutes * 60_000;
          if (!connected || gap) ctx.moveTo(x(index), y(value)); else ctx.lineTo(x(index), y(value));
          connected = true;
        });
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#A7B0BA';
      if (!profile) {
        let previousMonth = '';
        let previousX = -Infinity;
        ctx.textAlign = 'center';
        data.rows.forEach((row, index) => {
          const month = row.time.slice(0, 7);
          if (month === previousMonth) return;
          previousMonth = month;
          const px = x(index);
          if (px < left + 8 || px > right - 12 || px - previousX < 40) return;
          previousX = px;
          ctx.fillText(new Date(row.time + ':00Z').toLocaleString(undefined, { month: 'short', timeZone: 'UTC' }), px, height - 8);
        });
        ctx.textAlign = 'left';
      }
      if (profile) {
        ctx.fillText('00:00', left, height - 8);
        ctx.textAlign = 'right'; ctx.fillText('23:00', right, height - 8);
      } else if (span < 28 * 86400000) {
        ctx.fillText(data.rows[0].time.slice(5).replace('T', ' '), left, height - 8);
        ctx.textAlign = 'right'; ctx.fillText(data.rows[data.rows.length - 1].time.slice(5).replace('T', ' '), right, height - 8);
      }
    };
    const observer = new ResizeObserver(draw); observer.observe(element); draw();
    return () => observer.disconnect();
  }, [data, mode]);
  const row = mode === 'timeseries' && hover !== null ? data.rows[hover] : null;
  return <section aria-label="Simulation comparison" style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 180, padding: 12, color: '#A7B0BA' }}>
    <div style={{ fontSize: 12 }} title={data.channel.key}>{(mode === 'monthly' || mode === 'daily') && data.energy ? `${data.energy.title} · ${data.energy.units} · ${mode === 'monthly' ? 'Monthly' : 'Daily'}` : `${data.channel.name} · ${data.channel.units} · ${data.channel.frequency}`}</div>
    {mode !== 'heatmap' && !data.summary ? <div style={{ display: 'flex', gap: 16, fontSize: 12, marginTop: 6 }}>
      {data.cases.map(item => <span key={item.caseId} style={{ color: caseColor(item.caseId) }} title={`${item.runId}\nModel ${item.revision}\n${item.engine}\nMissing samples: ${item.missing}`}>
        {caseName(item.caseId)}{item.missing ? ` (${item.missing} missing)` : ''}
      </span>)}
    </div> : null}
    {data.summary && mode !== 'monthly' && mode !== 'daily' ? <div aria-label="Period totals and relative change from baseline" title="Totals over the selected period; percentage change from baseline" style={{ fontSize: 11, display: 'flex', flexWrap: 'wrap', gap: '3px 12px', marginTop: 4 }}>
      {data.cases.map((item, index) => <span key={item.caseId} style={{ color: caseColor(item.caseId) }}>
        {caseName(item.caseId)}: {data.summary!.values[index]?.toLocaleString(undefined, { maximumFractionDigits: 1 }) ?? 'missing'} {data.summary!.units}
        {item.caseId !== 'baseline' && data.summary!.changePercent[index] !== null ? ` (${data.summary!.changePercent[index]! > 0 ? '+' : ''}${data.summary!.changePercent[index]!.toFixed(1)}%)` : ''}
      </span>)}
    </div> : null}
    {!data.rows.length ? <p>No samples in this time window.</p> : <canvas ref={canvas} aria-label="Aligned simulation time series" style={{ width: '100%', flex: 1, minHeight: 0 }}
      onPointerLeave={() => setHover(null)} onPointerMove={event => {
        if (mode !== 'timeseries') return;
        const box = event.currentTarget.getBoundingClientRect();
        const fraction = Math.max(0, Math.min(1, (event.clientX - box.left - 75) / (box.width - 95)));
        const target = Date.parse(data.rows[0].time + ':00Z') + fraction * (Date.parse(data.rows[data.rows.length - 1].time + ':00Z') - Date.parse(data.rows[0].time + ':00Z'));
        let index = 0;
        while (index + 1 < data.rows.length && Date.parse(data.rows[index + 1].time + ':00Z') <= target) index++;
        setHover(index);
      }} />}
    <div style={{ fontSize: 12, minHeight: 18 }}>{row ? `${row.time.replace('T', ' ')} · ${row.values.map((value, index) => `${caseName(data.cases[index].caseId)}: ${value === null ? 'missing' : value.toLocaleString(undefined, { maximumSignificantDigits: 6 })} ${data.channel.units}`).join(' · ')}` : mode === 'profile' ? 'Mean hourly values over the selected dates' : mode === 'heatmap' ? 'One shared color scale · missing samples stay blank' : mode === 'daily' || mode === 'monthly' ? 'Energy sums · shared scale' : 'Local standard time · interval end'}</div>
  </section>;
}
