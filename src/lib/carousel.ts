export interface MotionState {
  paused: boolean;
  hovered: boolean;
  focused: boolean;
  hidden: boolean;
  reducedMotion: boolean;
}
export function shouldAdvanceCarousel(state: MotionState) {
  return !Object.values(state).some(Boolean);
}
export function carouselPosition(
  scrollLeft: number,
  scrollWidth: number,
  clientWidth: number,
  step: number,
) {
  const max = Math.max(0, scrollWidth - clientWidth);
  const pages = step > 0 && max > 1 ? Math.ceil(max / step) + 1 : 1;
  return {
    max,
    pages,
    index: Math.max(
      0,
      Math.min(
        pages - 1,
        scrollLeft >= max - 1 ? pages - 1 : Math.round(scrollLeft / Math.max(1, step)),
      ),
    ),
  };
}
export function nextCarouselPosition(
  scrollLeft: number,
  scrollWidth: number,
  clientWidth: number,
  step: number,
  direction: number,
) {
  const current = carouselPosition(scrollLeft, scrollWidth, clientWidth, step);
  const index = (current.index + direction + current.pages) % current.pages;
  return { index, offset: Math.min(current.max, index * step) };
}
