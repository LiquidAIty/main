/**
 * Entity: Trading
 * Relationship: Computes observed-candle price levels, window VWAP, approximate visible-range volume profile and optional pattern annotations inside the existing Lightweight Charts pane.
 */
import type { IPrimitivePaneRenderer, ISeriesPrimitive, SeriesAttachedParameter, UTCTimestamp } from 'lightweight-charts';
import type { ForecastBar } from './KronosForecastPanel';

type Candle = ForecastBar & { open: number; high: number; low: number; close: number; volume: number };
export type IndicatorOptions = { profile: boolean; levels: boolean; patterns: boolean; vwap: boolean };
type Level = { label: string; price: number };
const time = (bar: ForecastBar) => Date.parse(bar.timestamp) / 1000 as UTCTimestamp;

export function observedCandles(rows: ForecastBar[]): Candle[] {
  return rows.filter((row): row is Candle => row.valid !== false && Number.isFinite(time(row))
    && [row.open, row.high, row.low, row.close, row.volume].every(value => typeof value === 'number' && Number.isFinite(value))
    && row.low! > 0 && row.volume! >= 0 && row.high! >= Math.max(row.open!, row.close!, row.low!)
    && row.low! <= Math.min(row.open!, row.close!));
}

export function windowVwap(rows: ForecastBar[]) {
  let amount = 0, volume = 0;
  return observedCandles(rows).flatMap(row => {
    amount += (row.high + row.low + row.close) / 3 * row.volume;
    volume += row.volume;
    return volume > 0 ? [{ time: time(row), value: amount / volume }] : [];
  });
}

export function priceVolumeProfile(rows: ForecastBar[], count = 36) {
  const candles = observedCandles(rows);
  if (!candles.length || !Number.isInteger(count) || count < 2 || count > 100) return null;
  const low = Math.min(...candles.map(row => row.low)), high = Math.max(...candles.map(row => row.high));
  if (high <= low) return null;
  const step = (high - low) / count;
  const bins = Array.from({ length: count }, (_, index) => ({ low: low + index * step, high: low + (index + 1) * step, volume: 0 }));
  for (const row of candles) {
    if (row.high === row.low) {
      bins[Math.min(count - 1, Math.max(0, Math.floor((row.close - low) / step)))].volume += row.volume;
    } else for (const bin of bins) {
      const overlap = Math.max(0, Math.min(bin.high, row.high) - Math.max(bin.low, row.low));
      bin.volume += row.volume * overlap / (row.high - row.low);
    }
  }
  const total = bins.reduce((sum, bin) => sum + bin.volume, 0);
  if (!total) return null;
  const poc = bins.reduce((best, bin, index) => bin.volume > bins[best].volume ? index : best, 0);
  let first = poc, last = poc, included = bins[poc].volume;
  while (included < total * .7 && (first > 0 || last < count - 1)) {
    if (first > 0 && (last === count - 1 || bins[first - 1].volume >= bins[last + 1].volume)) included += bins[--first].volume;
    else included += bins[++last].volume;
  }
  return { bins, maximum: bins[poc].volume, levels: [
    { label: 'POC', price: (bins[poc].low + bins[poc].high) / 2 },
    { label: 'VAH 70%', price: bins[last].high }, { label: 'VAL 70%', price: bins[first].low },
  ] };
}

const exchangeDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
function dateKeys(row: Candle) {
  const parts = exchangeDate.formatToParts(new Date(row.timestamp));
  const part = (type: string) => Number(parts.find(item => item.type === type)?.value);
  const day = Date.UTC(part('year'), part('month') - 1, part('day'));
  const monday = day - ((new Date(day).getUTCDay() + 6) % 7) * 86400000;
  return { day, week: monday };
}

export function observedPriceLevels(rows: ForecastBar[]): Level[] {
  const candles = observedCandles(rows);
  if (!candles.length) return [];
  const current = dateKeys(candles.at(-1)!);
  const days = [...new Set(candles.map(row => dateKeys(row).day))].sort((a, b) => a - b);
  const groups = [
    { label: 'Day', rows: candles.filter(row => dateKeys(row).day === current.day) },
    { label: 'Prior day', rows: candles.filter(row => dateKeys(row).day === days.at(-2)) },
    { label: 'Week', rows: candles.filter(row => dateKeys(row).week === current.week) },
  ];
  return groups.flatMap(group => group.rows.length ? [
    { label: `${group.label} high`, price: Math.max(...group.rows.map(row => row.high)) },
    { label: `${group.label} low`, price: Math.min(...group.rows.map(row => row.low)) },
  ] : []);
}

export function observedPatterns(rows: ForecastBar[]) {
  const candles = observedCandles(rows);
  const markers: { time: UTCTimestamp; price: number; label: string; up: boolean }[] = [];
  const gaps: { from: UTCTimestamp; to: UTCTimestamp; low: number; high: number; up: boolean }[] = [];
  for (let index = 1; index < candles.length; index++) {
    const row = candles[index], prior = candles[index - 1];
    const bullish = row.close > row.open && prior.close < prior.open && row.open <= prior.close && row.close >= prior.open;
    const bearish = row.close < row.open && prior.close > prior.open && row.open >= prior.close && row.close <= prior.open;
    if (bullish || bearish) markers.push({ time: time(row), price: bullish ? row.low : row.high, label: bullish ? 'Engulf ↑' : 'Engulf ↓', up: bullish });
    if (index >= 20) {
      const preceding = candles.slice(index - 20, index);
      const high = Math.max(...preceding.map(bar => bar.high)), low = Math.min(...preceding.map(bar => bar.low));
      if (row.close > high || row.close < low) {
        const up = row.close > high;
        markers.push({ time: time(row), price: up ? row.low : row.high, label: up ? 'Break ↑' : 'Break ↓', up });
      } else if (row.high > high && row.close < high) {
        markers.push({ time: time(row), price: row.high, label: 'Sweep? ↓', up: false });
      } else if (row.low < low && row.close > low) {
        markers.push({ time: time(row), price: row.low, label: 'Sweep? ↑', up: true });
      }
    }
    if (index >= 2) {
      const earlier = candles[index - 2];
      if (row.low > earlier.high || row.high < earlier.low) {
        const up = row.low > earlier.high;
        gaps.push({ from: time(earlier), to: time(row), low: up ? earlier.high : row.high,
          high: up ? row.low : earlier.low, up });
      }
    }
  }
  return { markers, gaps };
}

export class ChartIndicators implements ISeriesPrimitive {
  private owner?: SeriesAttachedParameter;
  constructor(private rows: ForecastBar[], private options: IndicatorOptions) {}
  attached(owner: SeriesAttachedParameter) { this.owner = owner; owner.requestUpdate(); }
  detached() { this.owner = undefined; }
  setOptions(options: IndicatorOptions) { this.options = options; this.owner?.requestUpdate(); }
  paneViews() { return [{ zOrder: () => 'top' as const, renderer: () => ({ draw: (target: Parameters<IPrimitivePaneRenderer['draw']>[0]) => this.draw(target) }) }]; }
  private draw(target: Parameters<IPrimitivePaneRenderer['draw']>[0]) {
    if (!this.owner) return;
    const { chart, series } = this.owner;
    const scale = chart.timeScale();
    const range = scale.getVisibleLogicalRange();
    const visible = range ? this.rows.filter(row => {
      const index = scale.timeToIndex(time(row));
      return index != null && index >= Math.floor(range.from) && index <= Math.ceil(range.to);
    }) : this.rows;
    const profile = this.options.profile ? priceVolumeProfile(visible) : null;
    const levels = [...(profile?.levels || []), ...(this.options.levels ? observedPriceLevels(this.rows) : [])];
    // Pattern context stays anchored to the loaded observations when the user pans.
    const patterns = this.options.patterns ? observedPatterns(this.rows) : null;
    const visibleTimes = new Set(visible.map(time));
    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      ctx.save(); ctx.font = '11px sans-serif';
      if (profile) {
        ctx.fillStyle = 'rgba(79,162,173,.25)';
        for (const bin of profile.bins) {
          const top = series.priceToCoordinate(bin.high), bottom = series.priceToCoordinate(bin.low);
          if (top != null && bottom != null) ctx.fillRect(0, top, Math.min(160, mediaSize.width * .18) * bin.volume / profile.maximum, Math.max(1, bottom - top - 1));
        }
      }
      const drawn: number[] = [];
      for (const level of levels) {
        const y = series.priceToCoordinate(level.price);
        if (y == null || y < 0 || y > mediaSize.height) continue;
        ctx.strokeStyle = level.label === 'POC' ? 'rgba(242,166,74,.65)' : 'rgba(145,169,184,.35)';
        ctx.setLineDash([3, 5]); ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(mediaSize.width, y); ctx.stroke();
        if (!drawn.some(previous => Math.abs(previous - y) < 13)) {
          ctx.fillStyle = '#b8c3d0'; ctx.fillText(`${level.label} ${level.price.toFixed(2)}`, 5, Math.max(11, y - 3)); drawn.push(y);
        }
      }
      ctx.setLineDash([]);
      for (const gap of (patterns?.gaps || []).filter(item => visibleTimes.has(item.to)).slice(-20)) {
        const left = scale.timeToCoordinate(gap.from), right = scale.timeToCoordinate(gap.to);
        const top = series.priceToCoordinate(gap.high), bottom = series.priceToCoordinate(gap.low);
        if (left == null || right == null || top == null || bottom == null) continue;
        ctx.fillStyle = gap.up ? 'rgba(38,166,154,.14)' : 'rgba(239,83,80,.14)';
        ctx.fillRect(left, top, right - left, bottom - top);
      }
      for (const marker of (patterns?.markers || []).filter(item => visibleTimes.has(item.time)).slice(-15)) {
        const x = scale.timeToCoordinate(marker.time), y = series.priceToCoordinate(marker.price);
        if (x == null || y == null || x < 0 || x > mediaSize.width) continue;
        ctx.fillStyle = marker.up ? '#60c6b9' : '#e78e8c';
        ctx.fillText(marker.label, x + 3, y + (marker.up ? 14 : -8));
      }
      ctx.restore();
    });
  }
}
