import { useCallback, useRef } from 'react';

/**
 * useCursorGlow — track pointer over an element and expose --x / --y CSS
 * variables (in px, relative to the element's top-left). Pair with the
 * `.cursor-glow` class in App.css for a soft spotlight that follows the cursor.
 *
 *   const { ref, onPointerMove } = useCursorGlow<HTMLDivElement>();
 *   <div ref={ref} onPointerMove={onPointerMove} className="cursor-glow ..." />
 */
export function useCursorGlow<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const onPointerMove = useCallback((e: React.PointerEvent<T>) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    el.style.setProperty('--x', `${e.clientX - rect.left}px`);
    el.style.setProperty('--y', `${e.clientY - rect.top}px`);
  }, []);
  return { ref, onPointerMove };
}
