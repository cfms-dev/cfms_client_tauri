export interface MarqueePoint {
  x: number;
  y: number;
}

export interface MarqueeRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export function createMarqueeRect(start: MarqueePoint, end: MarqueePoint): MarqueeRect {
  const left = Math.min(start.x, end.x);
  const top = Math.min(start.y, end.y);
  const right = Math.max(start.x, end.x);
  const bottom = Math.max(start.y, end.y);
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

export function marqueeRowRange(
  rect: Pick<MarqueeRect, 'top' | 'bottom'>,
  listTop: number,
  rowHeight: number,
  rowCount: number,
): { start: number; end: number } | null {
  if (rowHeight <= 0 || rowCount <= 0 || rect.bottom < listTop) return null;
  const start = Math.max(0, Math.ceil((rect.top - listTop) / rowHeight) - 1);
  const end = Math.min(rowCount - 1, Math.floor((rect.bottom - listTop) / rowHeight));
  return start <= end ? { start, end } : null;
}

export function marqueeAutoScrollDelta(
  pointerPosition: number,
  viewportStart: number,
  viewportEnd: number,
  threshold = 40,
  maximumDelta = 18,
): number {
  if (pointerPosition < viewportStart + threshold) {
    const intensity = Math.min(1, (viewportStart + threshold - pointerPosition) / threshold);
    return -Math.ceil(maximumDelta * intensity);
  }
  if (pointerPosition > viewportEnd - threshold) {
    const intensity = Math.min(1, (pointerPosition - (viewportEnd - threshold)) / threshold);
    return Math.ceil(maximumDelta * intensity);
  }
  return 0;
}
