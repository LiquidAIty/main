/**
 * Entity: Trading
 * Relationship: Draws retained forecast sample envelopes and the completed-data boundary inside the existing Lightweight Charts price pane.
 */
import type { IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesPrimitive, Logical, SeriesAttachedParameter, UTCTimestamp } from 'lightweight-charts';

export type ShadowPoint = { time: UTCTimestamp; values: number[] };
type PixelBand = { x: number; top: number; bottom: number };

/** Pixel envelope only: no filtering by fit, probability estimate, or changed model values. */
export function shadowPixels(points: ShadowPoint[], xFor: (time: UTCTimestamp) => number | null, yFor: (price: number) => number | null): PixelBand[][] {
  const segments: PixelBand[][] = [];
  let segment: PixelBand[] = [];
  for (const point of points) {
    const x = xFor(point.time);
    const ys = point.values.map(yFor);
    if (x == null || !Number.isFinite(x) || !ys.length || ys.some(y => y == null || !Number.isFinite(y))) {
      if (segment.length) segments.push(segment);
      segment = [];
    } else segment.push({ x, top: Math.min(...ys as number[]), bottom: Math.max(...ys as number[]) });
  }
  if (segment.length) segments.push(segment);
  return segments;
}

export class ForecastShadow implements ISeriesPrimitive {
  private owner?: SeriesAttachedParameter;
  private segments: PixelBand[][] = [];
  private boundary: number | null = null;
  private views: IPrimitivePaneView[] = [
    { zOrder: () => 'bottom', renderer: () => ({ draw: target => this.drawShadow(target) }) },
    { zOrder: () => 'top', renderer: () => ({ draw: target => this.drawBoundary(target) }) },
  ];
  constructor(private points: ShadowPoint[], private dataEnd: UTCTimestamp | null) {}
  attached(owner: SeriesAttachedParameter) { this.owner = owner; owner.requestUpdate(); }
  detached() { this.owner = undefined; }
  paneViews() { return this.views; }
  updateAllViews() {
    if (!this.owner) return;
    const scale = this.owner.chart.timeScale();
    this.segments = shadowPixels(this.points, time => scale.timeToCoordinate(time), price => this.owner!.series.priceToCoordinate(price));
    const index = this.dataEnd == null ? null : scale.timeToIndex(this.dataEnd);
    // The installed chart maps fractional logical indices to zero. Interpolate
    // two integer coordinates to put the boundary after, not through, the bar.
    const left = index == null ? null : scale.logicalToCoordinate(index as unknown as Logical);
    const right = index == null ? null : scale.logicalToCoordinate((index + 1) as Logical);
    this.boundary = left == null || right == null ? null : (left + right) / 2;
  }
  autoscaleInfo(start: Logical, end: Logical) {
    if (!this.owner) return null;
    const scale = this.owner.chart.timeScale();
    const visible = this.points.filter(point => {
      const index = scale.timeToIndex(point.time);
      return index != null && index >= Math.floor(start) && index <= Math.ceil(end);
    }).flatMap(point => point.values).filter(Number.isFinite);
    return visible.length ? { priceRange: { minValue: Math.min(...visible), maxValue: Math.max(...visible) } } : null;
  }
  private drawShadow(target: Parameters<IPrimitivePaneRenderer['draw']>[0]) {
    target.useMediaCoordinateSpace(({ context: ctx }) => {
      ctx.save();
      ctx.fillStyle = 'rgba(238,176,76,0.18)';
      ctx.strokeStyle = 'rgba(238,176,76,0.35)';
      ctx.lineWidth = 1;
      for (const segment of this.segments) {
        if (segment.length < 2) continue;
        ctx.beginPath();
        ctx.moveTo(segment[0].x, segment[0].top);
        for (const point of segment.slice(1)) ctx.lineTo(point.x, point.top);
        for (const point of [...segment].reverse()) ctx.lineTo(point.x, point.bottom);
        ctx.closePath(); ctx.fill(); ctx.stroke();
      }
      ctx.restore();
    });
  }
  private drawBoundary(target: Parameters<IPrimitivePaneRenderer['draw']>[0]) {
    if (this.boundary == null) return;
    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      const x = this.boundary!;
      if (x < 0 || x > mediaSize.width) return;
      ctx.save();
      ctx.strokeStyle = '#83e3d4'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]);
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, mediaSize.height); ctx.stroke();
      ctx.restore();
    });
  }
}
