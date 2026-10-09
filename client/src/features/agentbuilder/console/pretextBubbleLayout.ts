import {
  layout,
  prepareWithSegments,
  walkLineRanges,
  type PreparedTextWithSegments,
} from '@chenglou/pretext';

export const CHAT_MESSAGE_FONT = '13.5px "Inter", "Segoe UI", Arial, sans-serif';
export const CHAT_MESSAGE_LINE_HEIGHT = 20.925;

export function prepareChatBubbleText(text: string): PreparedTextWithSegments | null {
  try {
    return prepareWithSegments(text, CHAT_MESSAGE_FONT, { whiteSpace: 'pre-wrap' });
  } catch {
    return null;
  }
}

/**
 * Pretext's chat-bubble algorithm: find the narrowest content width that keeps
 * the same line count as the current available width, then shrink-wrap to the
 * widest resulting line. Resizing only repeats cached arithmetic; it does not
 * measure every message through DOM layout.
 */
export function tightChatBubbleTextWidth(
  prepared: PreparedTextWithSegments | null,
  availableWidth: number,
): number | null {
  if (!prepared || !Number.isFinite(availableWidth) || availableWidth <= 0) return null;
  try {
    const maximum = Math.max(1, Math.floor(availableWidth));
    const initialLineCount = layout(prepared, maximum, CHAT_MESSAGE_LINE_HEIGHT).lineCount;
    let low = 1;
    let high = maximum;

    while (low < high) {
      const candidate = Math.floor((low + high) / 2);
      const candidateLineCount = layout(
        prepared,
        candidate,
        CHAT_MESSAGE_LINE_HEIGHT,
      ).lineCount;
      if (candidateLineCount <= initialLineCount) {
        high = candidate;
      } else {
        low = candidate + 1;
      }
    }

    let widestLine = 0;
    walkLineRanges(prepared, low, (line) => {
      widestLine = Math.max(widestLine, line.width);
    });
    return Math.min(maximum, Math.max(1, Math.ceil(widestLine)));
  } catch {
    return null;
  }
}
