import { useEffect, useLayoutEffect, useRef, useState } from 'react';

const query = '(prefers-reduced-motion: reduce)';

/** OS の「視差効果を減らす」設定を追従する。 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof matchMedia === 'function' && matchMedia(query).matches,
  );
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const media = matchMedia(query);
    const update = () => setReduced(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return reduced;
}

const count = 3;
// 経路の長さによらず同じ速さで流し、長い接続ほど時間をかけて進む。
const speed = 0.12;

/**
 * 描画済みの経路 d に沿って、始点から終点へ粒子を流す。
 * 2D の矢印と 3D の投影後の配管で同じ経路文字列を使うため、曲線・床下・上空にも沿う。
 * 視差効果を減らす設定では動かさず、経路上に向きの分かる粒子を並べて止める。
 */
export function FlowParticles({
  d,
  color,
  playing,
  radius = 4,
}: {
  d: string;
  color: string;
  playing: boolean;
  radius?: number;
}) {
  const path = useRef<SVGPathElement>(null);
  const dots = useRef<(SVGCircleElement | null)[]>([]);
  const progress = useRef(0);
  const reduced = usePrefersReducedMotion();
  // 描画前に位置を決め、粒子が原点に一瞬表示されないようにする。
  useLayoutEffect(() => {
    const element = path.current;
    if (!element || !d) return;
    let length = 0;
    try {
      length = element.getTotalLength();
    } catch {
      return;
    }
    if (!length) return;
    const place = () =>
      dots.current.forEach((dot, index) => {
        if (!dot) return;
        // 先頭の粒子を最も進んだ位置に置き、進行方向を読み取れるようにする。
        const ratio = (progress.current + (count - 1 - index) / count) % 1;
        const point = element.getPointAtLength(ratio * length);
        dot.setAttribute('cx', String(point.x));
        dot.setAttribute('cy', String(point.y));
      });
    if (reduced) {
      progress.current = 0.5 / count;
      place();
      return;
    }
    place();
    if (!playing) return;
    let frame = 0;
    let last: number | undefined;
    const tick = (now: number) => {
      if (last !== undefined)
        progress.current = (progress.current + (Math.min(100, now - last) * speed) / length) % 1;
      last = now;
      place();
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [d, playing, reduced]);
  return (
    <g
      className="flow-particles"
      aria-hidden="true"
      data-playing={playing && !reduced ? 'true' : 'false'}
      data-reduced={reduced ? 'true' : undefined}
      style={{ color }}
    >
      <path ref={path} d={d} fill="none" stroke="none" />
      {Array.from({ length: count }, (_, index) => (
        <circle
          key={index}
          ref={(element) => {
            dots.current[index] = element;
          }}
          r={index === 0 ? radius * 1.3 : radius}
          opacity={1 - index * 0.22}
        />
      ))}
    </g>
  );
}
