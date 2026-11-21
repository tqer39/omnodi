/** 3D ビューの座標系。x・y は ELK の配置平面、z は床からの高さ（上が正）。 */
export type V3 = readonly [number, number, number];
export type Point = { x: number; y: number };
export type ScreenPoint = Point & { depth: number };
export type Orientation = { yaw: number; pitch: number };

/** 入口側（2D の左側）が手前に来るよう、右上がりの向きを既定にする。 */
export const defaultOrientation: Orientation = { yaw: -32, pitch: 36 };
export const pitchRange = { min: 16, max: 74 } as const;

export function clampOrientation({ yaw, pitch }: Orientation): Orientation {
  return {
    yaw: ((((yaw + 180) % 360) + 360) % 360) - 180,
    pitch: Math.min(pitchRange.max, Math.max(pitchRange.min, pitch)),
  };
}

export interface Projector {
  orientation: Orientation;
  project(point: V3): ScreenPoint;
  /** 面の外向き法線が視点側を向くか。 */
  faces(normal: V3): boolean;
  /** 視点に固定した光源での明るさ（0.5〜1.12）。回転しても上面・正面・側面の明暗を保つ。 */
  light(normal: V3): number;
}

const radians = (degrees: number) => (degrees * Math.PI) / 180;
// 左手前上からの光。上面を最も明るく、右奥を最も暗くする。
const lightDirection = (() => {
  const vector = [-0.42, 0.52, 0.74];
  const length = Math.hypot(...vector);
  return vector.map((value) => value / length) as [number, number, number];
})();

/** 中心を回転の軸にした正射影。回転しても中心が画面上で動かないようにする。 */
export function createProjector(
  orientation: Orientation,
  center: Point = { x: 0, y: 0 },
): Projector {
  const { yaw, pitch } = clampOrientation(orientation);
  const cosYaw = Math.cos(radians(yaw));
  const sinYaw = Math.sin(radians(yaw));
  const cosPitch = Math.cos(radians(pitch));
  const sinPitch = Math.sin(radians(pitch));
  const rotate = (x: number, y: number) => [x * cosYaw - y * sinYaw, x * sinYaw + y * cosYaw];
  return {
    orientation: { yaw, pitch },
    project([x, y, z]) {
      const [across, toward] = rotate(x - center.x, y - center.y);
      return {
        x: across!,
        y: toward! * sinPitch - z * cosPitch,
        depth: toward! * cosPitch + z * sinPitch,
      };
    },
    faces([x, y, z]) {
      const [, toward] = rotate(x, y);
      return toward! * cosPitch + z * sinPitch > 1e-6;
    },
    light([x, y, z]) {
      const [across, toward] = rotate(x, y);
      const length = Math.hypot(x, y, z) || 1;
      const dot =
        (across! * lightDirection[0] + toward! * lightDirection[1] + z * lightDirection[2]) /
        length;
      return 0.5 + 0.62 * Math.max(0, dot);
    },
  };
}

const hex = (value: string): [number, number, number] | undefined => {
  const match = /^#?([0-9a-f]{6})$/i.exec(value.trim());
  if (!match) return undefined;
  const number = Number.parseInt(match[1]!, 16);
  return [(number >> 16) & 255, (number >> 8) & 255, number & 255];
};
const toHex = (rgb: number[]) =>
  `#${rgb
    .map((value) =>
      Math.round(Math.min(255, Math.max(0, value)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;

/** 2 色を割合で混ぜる。解釈できない色は元の色を返す。 */
export function mix(color: string, other: string, amount: number): string {
  const a = hex(color);
  const b = hex(other);
  if (!a || !b) return color;
  return toHex(a.map((value, index) => value + (b[index]! - value) * amount));
}

/** 1 未満は青みのある影色、1 超は白へ寄せ、平板な黒ずみを避ける。 */
export function shade(color: string, factor: number): string {
  return factor >= 1
    ? mix(color, '#ffffff', Math.min(1, (factor - 1) * 2.2))
    : mix(color, '#14212c', 1 - factor);
}

export function polygonPoints(points: Point[]): string {
  return points.map(({ x, y }) => `${round(x)},${round(y)}`).join(' ');
}
export const round = (value: number) => Math.round(value * 10) / 10;

/** 投影後の折れ線を、角を丸めた配管または滑らかな曲線の SVG パスにする。 */
export function tubePath(points: Point[], curved: boolean, radius = 14): string {
  const path = dedupe(points);
  if (path.length < 2) return '';
  const start = `M ${round(path[0]!.x)} ${round(path[0]!.y)}`;
  if (path.length === 2) return `${start} L ${round(path[1]!.x)} ${round(path[1]!.y)}`;
  if (curved) {
    // Catmull-Rom を 3 次ベジェへ変換し、全経由点を通る滑らかな配管にする。
    let d = start;
    for (let index = 0; index < path.length - 1; index++) {
      const p0 = path[Math.max(0, index - 1)]!;
      const p1 = path[index]!;
      const p2 = path[index + 1]!;
      const p3 = path[Math.min(path.length - 1, index + 2)]!;
      const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
      const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
      d += ` C ${round(c1.x)} ${round(c1.y)} ${round(c2.x)} ${round(c2.y)} ${round(p2.x)} ${round(p2.y)}`;
    }
    return d;
  }
  let d = start;
  for (let index = 1; index < path.length - 1; index++) {
    const previous = path[index - 1]!;
    const corner = path[index]!;
    const next = path[index + 1]!;
    const before = Math.hypot(corner.x - previous.x, corner.y - previous.y);
    const after = Math.hypot(next.x - corner.x, next.y - corner.y);
    const r = Math.min(radius, before / 2, after / 2);
    const entry = {
      x: corner.x + ((previous.x - corner.x) / before) * r,
      y: corner.y + ((previous.y - corner.y) / before) * r,
    };
    const exit = {
      x: corner.x + ((next.x - corner.x) / after) * r,
      y: corner.y + ((next.y - corner.y) / after) * r,
    };
    d += ` L ${round(entry.x)} ${round(entry.y)} Q ${round(corner.x)} ${round(corner.y)} ${round(exit.x)} ${round(exit.y)}`;
  }
  const last = path.at(-1)!;
  return `${d} L ${round(last.x)} ${round(last.y)}`;
}

export function dedupe<T extends Point>(points: T[]): T[] {
  return points.filter(
    (point, index) =>
      index === 0 ||
      Math.hypot(point.x - points[index - 1]!.x, point.y - points[index - 1]!.y) > 0.5,
  );
}

/** 折れ線上に一定間隔で向き付きの目印を置く。 */
export function samplesAlong(
  points: Point[],
  spacing: number,
  margin: number,
): (Point & { angle: number })[] {
  const path = dedupe(points);
  const lengths = path
    .slice(1)
    .map((point, index) => Math.hypot(point.x - path[index]!.x, point.y - path[index]!.y));
  const total = lengths.reduce((sum, value) => sum + value, 0);
  if (total < margin * 2 + 4) return [];
  const count = Math.max(1, Math.floor((total - margin * 2) / spacing));
  const step = (total - margin * 2) / count;
  const result: (Point & { angle: number })[] = [];
  for (let sample = 0; sample <= count; sample++) {
    let distance = margin + sample * step;
    for (let index = 0; index < lengths.length; index++) {
      const length = lengths[index]!;
      if (distance <= length || index === lengths.length - 1) {
        const from = path[index]!;
        const to = path[index + 1]!;
        const ratio = length ? Math.min(1, distance / length) : 0;
        result.push({
          x: from.x + (to.x - from.x) * ratio,
          y: from.y + (to.y - from.y) * ratio,
          angle: (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI,
        });
        break;
      }
      distance -= length;
    }
  }
  return result;
}
