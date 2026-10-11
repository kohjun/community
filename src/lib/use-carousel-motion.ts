"use client";
import { useEffect, useRef, useState, type FocusEvent } from "react";
import { shouldAdvanceCarousel } from "./carousel";
export function useCarouselMotion(callback: () => void, delay: number, paused: boolean) {
  const latest = useRef(callback),
    [hovered, setHovered] = useState(false),
    [focused, setFocused] = useState(false);
  useEffect(() => {
    latest.current = callback;
  }, [callback]);
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const timer = setInterval(() => {
      if (
        shouldAdvanceCarousel({
          paused,
          hovered,
          focused,
          hidden: document.hidden,
          reducedMotion: reduce.matches,
        })
      )
        latest.current();
    }, delay);
    return () => clearInterval(timer);
  }, [delay, paused, hovered, focused]);
  return {
    onMouseEnter: () => setHovered(true),
    onMouseLeave: () => setHovered(false),
    onFocusCapture: () => setFocused(true),
    onBlurCapture: (event: FocusEvent<HTMLElement>) => {
      if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
    },
  };
}
