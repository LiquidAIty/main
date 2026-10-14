// @vitest-environment jsdom

import { layout } from '@chenglou/pretext';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  CHAT_MESSAGE_LINE_HEIGHT,
  prepareChatBubbleText,
  tightChatBubbleTextWidth,
} from './pretextBubbleLayout';

const measureText = vi.fn((text: string) => ({ width: Array.from(text).length * 7.5 }));

beforeAll(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    font: '',
    measureText,
  } as unknown as CanvasRenderingContext2D);
});

describe('Pretext chat bubble layout', () => {
  it('shrink-wraps to the tightest width without exceeding the current lane', () => {
    const prepared = prepareChatBubbleText(
      'Pretext keeps this message compact while the Main panel changes width.',
    );

    const wide = tightChatBubbleTextWidth(prepared, 420);
    const narrow = tightChatBubbleTextWidth(prepared, 180);

    expect(prepared).not.toBeNull();
    expect(wide).not.toBeNull();
    expect(narrow).not.toBeNull();
    expect(wide!).toBeLessThanOrEqual(420);
    expect(narrow!).toBeLessThanOrEqual(180);
    expect(narrow!).toBeLessThan(wide!);
  });

  it('keeps short messages compact and lets long messages gain lines as Main narrows', () => {
    const short = prepareChatBubbleText('Compact status.');
    const long = prepareChatBubbleText(
      'A variable-height Trading answer keeps its full text while the continuously resizable Main panel narrows.',
    );

    const shortWidth = tightChatBubbleTextWidth(short, 500);
    const wideWidth = tightChatBubbleTextWidth(long, 500);
    const narrowWidth = tightChatBubbleTextWidth(long, 170);
    const wideLines = layout(long!, wideWidth!, CHAT_MESSAGE_LINE_HEIGHT).lineCount;
    const narrowLines = layout(long!, narrowWidth!, CHAT_MESSAGE_LINE_HEIGHT).lineCount;

    expect(shortWidth).toBeLessThan(180);
    expect(wideWidth).toBeLessThanOrEqual(500);
    expect(narrowWidth).toBeLessThanOrEqual(170);
    expect(narrowLines).toBeGreaterThan(wideLines);
  });

  it('reuses Pretext cached measurements across repeated width-only reflow', () => {
    const prepared = prepareChatBubbleText(
      'Unique cache sentinel 9f6b8d keeps resize work in Pretext cached arithmetic.',
    );
    const callsAfterPrepare = measureText.mock.calls.length;

    tightChatBubbleTextWidth(prepared, 420);
    tightChatBubbleTextWidth(prepared, 300);
    tightChatBubbleTextWidth(prepared, 180);

    expect(callsAfterPrepare).toBeGreaterThan(0);
    expect(measureText).toHaveBeenCalledTimes(callsAfterPrepare);
  });
});
