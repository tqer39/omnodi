import {
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from 'react';

type Point = { x: number; y: number };
type Camera = Point & { zoom: number };
export type SpatialBounds = { left: number; right: number; top: number; bottom: number };
export type SpatialViewControls = { fit: (ids?: string[]) => void };
export type SpatialViewportControls = SpatialViewControls & {
  /** 投影の回転で動いた分だけカメラを戻し、注目点を画面上に留める。 */
  shift: (dx: number, dy: number) => void;
};

export function SpatialViewport({
  active,
  ready,
  getBounds,
  onClear,
  onRotate,
  controls,
  aside,
  children,
  ref,
}: {
  aside?: ReactNode;
  active: boolean;
  ready: boolean;
  getBounds: (ids?: string[]) => SpatialBounds | undefined;
  onClear: () => void;
  /** Shift キーか右ボタンでのドラッグ量（画面ピクセル）。 */
  onRotate: (dx: number, dy: number) => void;
  controls?: ReactNode;
  children: ReactNode;
  ref: Ref<SpatialViewportControls>;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const [camera, setCamera] = useState<Camera>({ x: 0, y: 0, zoom: 1 });
  const pendingFit = useRef<{ ids?: string[] } | undefined>({});
  const drag = useRef<{
    id: number;
    start: Point;
    last: Point;
    moved: boolean;
    rotate: boolean;
  }>(undefined);
  const ignoreClick = useRef(false);
  const rotationFrame = useRef<number | undefined>(undefined);
  const rotationDelta = useRef({ x: 0, y: 0 });
  const rotateRef = useRef(onRotate);
  rotateRef.current = onRotate;
  const flushRotation = () => {
    if (rotationFrame.current === undefined) return;
    cancelAnimationFrame(rotationFrame.current);
    rotationFrame.current = undefined;
    const delta = rotationDelta.current;
    rotationDelta.current = { x: 0, y: 0 };
    rotateRef.current(delta.x, delta.y);
  };
  useEffect(
    () => () => {
      if (rotationFrame.current !== undefined) cancelAnimationFrame(rotationFrame.current);
      rotationFrame.current = undefined;
      rotationDelta.current = { x: 0, y: 0 };
    },
    [active],
  );
  const fit = (ids?: string[]) => {
    const element = viewport.current;
    if (!element?.clientWidth || !element.clientHeight || !ready) {
      pendingFit.current = { ids };
      return;
    }
    pendingFit.current = undefined;
    const bounds = getBounds(ids);
    if (!bounds) return;
    const { left, right, top, bottom } = bounds;
    const width = element.clientWidth;
    const height = element.clientHeight;
    const zoom = Math.min(
      (width * (ids ? 0.7 : 0.9)) / Math.max(1, right - left),
      (height * (ids ? 0.7 : 0.88)) / Math.max(1, bottom - top),
      1.2,
    );
    setCamera({
      x: (width - (left + right) * zoom) / 2,
      y: (height - (top + bottom) * zoom) / 2,
      zoom,
    });
  };
  useImperativeHandle(ref, () => ({
    fit,
    shift: (dx, dy) =>
      setCamera((current) => ({
        ...current,
        x: current.x + dx * current.zoom,
        y: current.y + dy * current.zoom,
      })),
  }));
  useLayoutEffect(() => {
    if (!active || !pendingFit.current) return;
    fit(pendingFit.current.ids);
  });

  const changeZoom = (factor: number, point: Point) => {
    setCamera((current) => {
      const zoom = Math.max(Math.min(0.05, current.zoom), Math.min(2.5, current.zoom * factor));
      const ratio = zoom / current.zoom;
      return {
        x: point.x + (current.x - point.x) * ratio,
        y: point.y + (current.y - point.y) * ratio,
        zoom,
      };
    });
  };
  useEffect(() => {
    const element = viewport.current;
    if (!active || !element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1;
      const horizontal = event.shiftKey
        ? event.deltaX || event.deltaY
        : Math.abs(event.deltaX) > Math.abs(event.deltaY)
          ? event.deltaX
          : 0;
      if (horizontal && !event.ctrlKey && !event.metaKey) {
        setCamera((current) => ({ ...current, x: current.x - horizontal * unit }));
        return;
      }
      const bounds = element.getBoundingClientRect();
      changeZoom(Math.exp(-event.deltaY * unit * 0.002), {
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
      });
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [active]);

  if (!active) return null;
  const zoomAtCenter = (factor: number) => {
    const element = viewport.current;
    if (element) changeZoom(factor, { x: element.clientWidth / 2, y: element.clientHeight / 2 });
  };
  return (
    <section
      className="spatial-view"
      aria-label="3D 構成図"
      ref={viewport}
      // ドラッグの直後に、立体や台座のクリック処理が選択を変えないよう捕捉段階で止める。
      onClickCapture={(event) => {
        if (event.detail === 0) {
          ignoreClick.current = false;
          return;
        }
        if (!ignoreClick.current) return;
        ignoreClick.current = false;
        event.stopPropagation();
      }}
      onClick={(event) => {
        if (
          event.target instanceof Element &&
          !event.target.closest('button, a, .resource-card, .annotation-card, .spatial-hit')
        ) {
          onClear();
        }
      }}
      // 右ドラッグを回転に使うため、リンク以外ではブラウザーのメニューを出さない。
      onContextMenu={(event) => {
        if (!(event.target instanceof Element && event.target.closest('a'))) event.preventDefault();
      }}
      onPointerDown={(event) => {
        ignoreClick.current = false;
        const rotate = event.button === 2 || (event.button === 0 && event.shiftKey);
        if (
          !event.isPrimary ||
          (event.button !== 0 && !rotate) ||
          (event.target instanceof Element && event.target.closest('.spatial-controls'))
        )
          return;
        if (rotate) event.preventDefault();
        const start = { x: event.clientX, y: event.clientY };
        drag.current = { id: event.pointerId, start, last: start, moved: false, rotate };
      }}
      onPointerMove={(event) => {
        const current = drag.current;
        if (
          !current ||
          current.id !== event.pointerId ||
          !(event.buttons & (current.rotate ? 3 : 1))
        )
          return;
        const point = { x: event.clientX, y: event.clientY };
        if (!current.moved && Math.hypot(point.x - current.start.x, point.y - current.start.y) < 5)
          return;
        if (!current.moved) {
          current.moved = true;
          event.currentTarget.setPointerCapture(event.pointerId);
        }
        const dx = point.x - current.last.x;
        const dy = point.y - current.last.y;
        current.last = point;
        if (current.rotate) {
          rotationDelta.current.x += dx;
          rotationDelta.current.y += dy;
          if (rotationFrame.current === undefined)
            rotationFrame.current = requestAnimationFrame(flushRotation);
        } else setCamera((previous) => ({ ...previous, x: previous.x + dx, y: previous.y + dy }));
      }}
      onPointerUp={(event) => {
        if (drag.current?.id !== event.pointerId) return;
        flushRotation();
        ignoreClick.current = event.button === 0 && drag.current.moved;
        drag.current = undefined;
      }}
      onLostPointerCapture={(event) => {
        if (drag.current?.id !== event.pointerId) return;
        drag.current = undefined;
        if (rotationFrame.current !== undefined) cancelAnimationFrame(rotationFrame.current);
        rotationFrame.current = undefined;
        rotationDelta.current = { x: 0, y: 0 };
      }}
      onPointerCancel={(event) => {
        if (drag.current?.id !== event.pointerId) return;
        drag.current = undefined;
        if (rotationFrame.current !== undefined) cancelAnimationFrame(rotationFrame.current);
        rotationFrame.current = undefined;
        rotationDelta.current = { x: 0, y: 0 };
      }}
    >
      <div
        className="spatial-world"
        style={{ transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})` }}
      >
        {children}
      </div>
      <div className="spatial-controls" role="group" aria-label="3D マップの操作">
        <button type="button" aria-label="3D マップを拡大" onClick={() => zoomAtCenter(1.25)}>
          +
        </button>
        <button type="button" aria-label="3D マップを縮小" onClick={() => zoomAtCenter(0.8)}>
          −
        </button>
        <button type="button" aria-label="3D マップを全体表示" onClick={() => fit()}>
          全体
        </button>
        {controls}
      </div>
      {aside}
    </section>
  );
}
