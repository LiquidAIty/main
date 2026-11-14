// @vitest-environment jsdom
/**
 * Entity: Trading
 * Relationship: Verifies the real forecast presentation keeps raw invalid bars distinct, aligns actual timestamps, and never generates forecasts on mount or history read.
 */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import KronosForecastPanel, { forecastCandleData, forecastInputWindow, forecastObservedHistory, forecastShadowPoints, type Forecast } from './KronosForecastPanel';
import { shadowPixels } from './ForecastShadow';
import { applicationFetch } from '../../lib/applicationApi';
vi.mock('../../lib/applicationApi', () => ({ applicationFetch: vi.fn() }));

// Presentation protocol only; never used as broker/model/persistence acceptance.
const forecast: Forecast = {
  forecastId: 'forecast-one', status: 'invalid_prediction', generatedAt: '2026-11-06T21:00:00Z',
  cutoff: '2026-11-06T21:00:00Z', modelRef: 'Kronos-mini', modelRevision: 'pinned', horizon: 1, aggregation: 'sample',
  parameters: { historyLimit: 128, sampleCount: 1, seed: 443 },
  marketData: { symbol: 'SPY', timeframe: '1Day', feed: 'iex', fetchedAt: '2026-11-06T21:00:00Z' },
  history: [{ timestamp: '2026-11-06T05:00:00Z', open: 100, high: 105, low: 99, close: 103, volume: 1000 }],
  points: [{ timestamp: '2026-11-09T05:00:00+00:00', open: 103, high: 104, low: 102, close: 106, volume: 900, valid: false }],
  warnings: [], runtime: { device: 'cpu', seconds: 1 },
};
afterEach(() => { cleanup(); vi.resetAllMocks(); });
describe('Kronos forecast presentation', () => {
  it('does not draw invalid predictions as valid candles and does not mutate them', () => {
    const before = JSON.stringify(forecast);
    const data = forecastCandleData(forecast.points);
    expect(data).toEqual([{ time: Date.parse(forecast.points[0].timestamp) / 1000 }]);
    expect('open' in data[0]).toBe(false);
    expect(JSON.stringify(forecast)).toBe(before);
  });
  it('aligns actuals by instant even when the provider uses Z instead of +00:00', () => {
    const actual = forecastCandleData([{ ...forecast.history[0], timestamp: '2026-11-09T05:00:00Z' }]);
    expect(actual[0].time).toBe(forecastCandleData(forecast.points)[0].time);
    expect(actual[0]).toMatchObject({ open: 100, close: 103 });
  });
  it('keeps original input and appends real overlap candles by instant without shifting the forecast origin', () => {
    const original = structuredClone(forecast);
    const later = { ...forecast.history[0], timestamp: forecast.points[0].timestamp, close: 102 };
    const latest = { ...later, timestamp: '2026-11-10T05:00:00Z', close: 110 };
    const rows = forecastObservedHistory(forecast.history,
      [latest, { ...later, timestamp: '2026-11-09T05:00:00Z', close: 104 }, { ...forecast.history[0], close: 999 }], [later]);
    expect(rows.map(row => row.close)).toEqual([103, 104, 110]);
    expect(rows.at(-1)?.timestamp).toBe(latest.timestamp);
    expect(forecast).toEqual(original);
    const withPaths = { ...forecast, samplePaths: [{ sampleIndex: 1, valid: false, points: forecast.points }] };
    expect(forecastShadowPoints(withPaths)[0]).toEqual({ time: Date.parse(forecast.history[0].timestamp) / 1000, values: [103] });
  });
  it('shadows retained finite closes including flagged paths, never fabricates a band for missing paths', () => {
    expect(forecastShadowPoints(forecast)).toEqual([]);
    const withPaths = { ...forecast, samplePaths: [
      { sampleIndex: 1, valid: false, points: forecast.points },
      { sampleIndex: 2, valid: true, points: [{ ...forecast.points[0], close: 100, valid: true }] },
    ] };
    expect(forecastShadowPoints(withPaths)[1].values).toEqual([106, 100]);
    withPaths.samplePaths[1].points[0].close = null;
    expect(forecastShadowPoints(withPaths)[1].values).toEqual([]);
  });
  it('draws the sample envelope in price coordinates with gaps rather than bridging missing samples', () => {
    const points = forecastShadowPoints({ ...forecast, samplePaths: [
      { sampleIndex: 1, valid: false, points: forecast.points },
      { sampleIndex: 2, valid: true, points: [{ ...forecast.points[0], close: 100 }] },
    ] });
    const pixels = shadowPixels(points, time => Number(time), price => 200 - price);
    expect(pixels[0][1]).toMatchObject({ top: 94, bottom: 100 });
    expect(shadowPixels([points[0], { ...points[1], values: [] }, points[1]], time => Number(time), price => price)).toHaveLength(2);
  });
  it('counts only real candles when forecast timestamps fill a gap in market data', () => {
    const one = { ...forecast.history[0], availableAfter: 'first-complete' };
    const two = { ...one, timestamp: '2026-11-10T05:00:00Z', availableAfter: 'last-complete' };
    const timeline = [one.timestamp, forecast.points[0].timestamp, two.timestamp, '2026-11-11T05:00:00Z'].map(time => Date.parse(time) / 1000);
    expect(forecastInputWindow([one, two], 0, 3, timeline)).toEqual({ count: 2, end: 'last-complete' });
    expect(forecastInputWindow([one, two], 1, 1, timeline)).toBeNull();
    expect(forecastInputWindow([one, two], 2, 3, timeline)).toEqual({ count: 1, end: 'last-complete' });
  });

  it('excludes later actuals from the reforecast input when a retained cutoff is selected', () => {
    const original = { ...forecast.history[0], availableAfter: '2026-11-07T01:00:00Z' };
    const later = { ...original, timestamp: '2026-11-09T05:00:00Z', availableAfter: '2026-11-10T01:00:00Z' };
    const timeline = [original, later].map(bar => Date.parse(bar.timestamp) / 1000);
    expect(forecastInputWindow([original, later], 0, 2, timeline, original.availableAfter))
      .toEqual({ count: 1, end: original.availableAfter });
    expect(forecastInputWindow([original, later], 0, 2, timeline))
      .toEqual({ count: 2, end: later.availableAfter });
  });

  it('reloads the retained study settings without changing the saved result or generating on open', async () => {
    const retained = { ...forecast, horizon: 10, parameters: {
      historyLimit: 48, sampleCount: 16, seed: 444, temperature: .6, topP: .75, topK: 0, includeVolatility: true,
    } };
    const before = structuredClone(retained);
    vi.mocked(applicationFetch).mockImplementation(async url => new Response(JSON.stringify(String(url).includes('forecastId=')
      ? retained : String(url).includes('/history?') ? { history: [], status: 'available' } : { forecasts: [retained] })));
    render(<KronosForecastPanel projectId="project-1" deckId="deck_builder" cardId="trader" symbol="SPY" timeframe="1Day" />);
    await screen.findByRole('option', { name: /SPY/ });
    fireEvent.change(screen.getByLabelText('Saved forecast'), { target: { value: retained.forecastId } });
    await waitFor(() => expect((screen.getByLabelText('Saved forecast') as HTMLSelectElement).value).toBe(retained.forecastId));
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    for (const [label, value] of [['Forecast horizon', '10'], ['Forecast samples', '16'], ['Forecast seed', '444'],
      ['Forecast temperature', '0.6'], ['Forecast top-p', '0.75'], ['Forecast top-k', '0']]) {
      expect((screen.getByLabelText(label) as HTMLInputElement).value).toBe(value);
    }
    expect((screen.getByLabelText('GARCH volatility comparison') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText('Forecast cutoff UTC') as HTMLInputElement).value).toBe('2026-11-06T21:00');
    expect(retained).toEqual(before);
    expect(vi.mocked(applicationFetch).mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true);
  });
  it('reads saved results and candles but cannot generate without a valid chart selection', async () => {
    vi.mocked(applicationFetch).mockImplementation(async url => new Response(JSON.stringify(String(url).includes('/history?') ? { history: [], status: 'provider_unconfigured', diagnostics: 'alpaca paper credentials not configured' } : { forecasts: [] })));
    render(<KronosForecastPanel projectId="project-1" deckId="deck_builder" cardId="trader" symbol="SPY" timeframe="1Day" />);
    await waitFor(() => expect(applicationFetch).toHaveBeenCalledTimes(2));
    expect(vi.mocked(applicationFetch).mock.calls[0][1]?.method).toBeUndefined();
    const generate = screen.getByRole('button', { name: 'Forecast' });
    expect(generate.hasAttribute('disabled')).toBe(true);
    fireEvent.submit(generate.closest('form')!);
    await screen.findByRole('alert');
    expect(screen.getByRole('alert').textContent).toContain('credentials not configured');
    const writes = vi.mocked(applicationFetch).mock.calls.filter(call => call[1]?.method === 'POST');
    expect(writes).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Compare later actuals' })).toBeNull();
  });

  it.each(['Kronos-mini', 'Kronos-small'])('opens the original saved %s identity when controls change without regenerating it', async modelRef => {
    const onOpenForecast = vi.fn();
    const retained = { ...forecast, modelRef };
    vi.mocked(applicationFetch).mockImplementation(async url => new Response(JSON.stringify(String(url).includes('forecastId=') ? retained : String(url).includes('/history?') ? { history: [], status: 'available' } : { forecasts: [retained] })));
    const { rerender } = render(<KronosForecastPanel projectId="project-1" deckId="deck_builder" cardId="trader" symbol="RDW" timeframe="5Min" onOpenForecast={onOpenForecast} />);
    fireEvent.change(await screen.findByLabelText('Saved forecast'), { target: { value: 'forecast-one' } });
    await waitFor(() => expect(onOpenForecast).toHaveBeenCalledWith(forecast.marketData));
    expect(screen.queryByText(/Raw IEX feed · seed/)).toBeNull();
    expect(screen.queryByTestId('average-only-notice')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Data' }));
    expect(screen.getByText(modelRef)).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('Saved: SPY · 1Day');
    rerender(<KronosForecastPanel projectId="project-1" deckId="deck_builder" cardId="trader" symbol="SPY" timeframe="1Day" onOpenForecast={onOpenForecast} />);
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByLabelText('Saved forecast').getAttribute('disabled')).toBeNull();
    expect(screen.getByTestId('average-only-notice')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close forecast details' }));
    expect(screen.queryByRole('complementary', { name: 'Forecast data' })).toBeNull();
    expect(vi.mocked(applicationFetch).mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true);
  });

  it('keeps model settings out of the chart until explicitly opened', async () => {
    vi.mocked(applicationFetch).mockImplementation(async url => new Response(JSON.stringify(String(url).includes('/history?') ? { history: [], status: 'available' } : { forecasts: [] })));
    render(<KronosForecastPanel projectId="project-1" deckId="deck_builder" cardId="trader" symbol="SPY" timeframe="1Day" />);
    await waitFor(() => expect(applicationFetch).toHaveBeenCalledTimes(2));
    expect(screen.queryByLabelText('Forecast model')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    const model = screen.getByLabelText('Forecast model') as HTMLSelectElement;
    expect(model.disabled).toBe(false);
    expect(Array.from(model.options, option => option.value)).toEqual(['mini']);
    fireEvent.change(screen.getByLabelText('Forecast samples'), { target: { value: '8' } });
    fireEvent.change(screen.getByLabelText('Forecast temperature'), { target: { value: '0.6' } });
    fireEvent.change(screen.getByLabelText('Forecast top-p'), { target: { value: '0.95' } });
    fireEvent.change(screen.getByLabelText('Forecast top-k'), { target: { value: '10' } });
    expect(screen.getByLabelText('Forecast top-p').hasAttribute('disabled')).toBe(true);
    fireEvent.change(screen.getByLabelText('Forecast seed'), { target: { value: '444' } });
    fireEvent.click(screen.getByRole('button', { name: 'Close forecast details' }));
    expect(screen.queryByLabelText('Forecast model')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect((screen.getByLabelText('Forecast temperature') as HTMLInputElement).value).toBe('0.6');
    expect((screen.getByLabelText('Forecast seed') as HTMLInputElement).value).toBe('444');
    fireEvent.change(screen.getByLabelText('Forecast top-k'), { target: { value: '0' } });
    expect(screen.getByLabelText('Forecast top-p').hasAttribute('disabled')).toBe(false);
    expect((screen.getByLabelText('Forecast top-p') as HTMLInputElement).value).toBe('0.95');
    expect(vi.mocked(applicationFetch).mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true);
  });

  it('does not overlay another ticker while opening saved history or waiting for its current bars', async () => {
    let release: (response: Response) => void;
    const pending = new Promise<Response>(resolve => { release = resolve; });
    const rdw = { ...forecast.history[0], timestamp: '2026-11-10T05:00:00Z' };
    const spy = { ...forecast.history[0], timestamp: '2026-11-09T05:00:00Z' };
    vi.mocked(applicationFetch).mockImplementation(async url => {
      const text = String(url);
      if (text.includes('/history?') && text.includes('symbol=SPY')) return pending;
      return new Response(JSON.stringify(text.includes('forecastId=') ? forecast
        : text.includes('/history?') ? { history: [rdw], status: 'available' } : { forecasts: [forecast] }));
    });
    const { rerender } = render(<KronosForecastPanel projectId="project-1" deckId="deck_builder" cardId="trader" symbol="RDW" timeframe="1Day" />);
    const chart = screen.getByRole('region', { name: 'Interactive forecast candle chart' });
    await waitFor(() => expect(chart.getAttribute('aria-description')).toContain(rdw.timestamp));
    fireEvent.change(screen.getByLabelText('Saved forecast'), { target: { value: 'forecast-one' } });
    await waitFor(() => expect(chart.getAttribute('aria-description')).toContain('no Now marker'));
    rerender(<KronosForecastPanel projectId="project-1" deckId="deck_builder" cardId="trader" symbol="SPY" timeframe="1Day" />);
    expect(chart.getAttribute('aria-description')).not.toContain(rdw.timestamp);
    release!(new Response(JSON.stringify({ history: [spy], status: 'available' })));
    await waitFor(() => expect(chart.getAttribute('aria-description')).toContain(spy.timestamp));
    expect(vi.mocked(applicationFetch).mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true);
  });

  it('derives the exact visible input count and completion cutoff without counting future bars', () => {
    const bars = Array.from({ length: 20 }, (_, index) => ({ ...forecast.history[0], availableAfter: `cutoff-${index}` }));
    expect(forecastInputWindow(bars, 2.2, 30)).toEqual({ count: 17, end: 'cutoff-19' });
    expect(forecastInputWindow(bars, -3, 12.9)).toEqual({ count: 13, end: 'cutoff-12' });
    expect(forecastInputWindow(bars, 21, 30)).toBeNull();
    expect(forecastInputWindow(forecast.history, 0, 1)).toBeNull(); // Old records cannot invent a cutoff.
  });
});
