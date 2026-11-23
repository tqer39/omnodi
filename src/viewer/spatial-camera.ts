export type Camera = { x: number; y: number; zoom: number };
export type CameraBounds = { left: number; right: number; top: number; bottom: number };
export type ViewportSize = { width: number; height: number };

/** 全体表示で拡大しすぎず、小さな図でも立体と名札の比率を保つ上限。 */
export const maxFitZoom = 1.2;
/**
 * 初期表示で名札の文字を読める下限の倍率。名前 13px が約 12px、
 * アカウントID・リージョン・CIDR などの補足 10px が約 9px になる。
 */
export const readableZoom = 0.9;

/** 範囲全体を画面の割合（ratio）に収める。 */
export function fitCamera(
  bounds: CameraBounds,
  size: ViewportSize,
  ratio: { x: number; y: number },
): Camera {
  const zoom = Math.min(
    (size.width * ratio.x) / Math.max(1, bounds.right - bounds.left),
    (size.height * ratio.y) / Math.max(1, bounds.bottom - bounds.top),
    maxFitZoom,
  );
  return center(bounds, size, zoom);
}

function center(bounds: CameraBounds, size: ViewportSize, zoom: number): Camera {
  return {
    x: (size.width - (bounds.left + bounds.right) * zoom) / 2,
    y: (size.height - (bounds.top + bounds.bottom) * zoom) / 2,
    zoom,
  };
}

/**
 * 主要な通信経路を収めるときの下限。読める倍率より小さくても、経路の両端と
 * 名札を同時に見せる方が構成を理解しやすい。名前 13px が約 8px になる値で止める。
 */
export const focusMinZoom = 0.6;

const fullRatio = { x: 0.9, y: 0.88 };
const structureRatio = { x: 0.94, y: 0.92 };
// 左下の操作ボタンと右下の凡例に主要部分が隠れないよう、余白を広めに取る。
const focusRatio = { x: 0.8, y: 0.74 };

const union = (items: CameraBounds[]): CameraBounds => ({
  left: Math.min(...items.map((item) => item.left)),
  right: Math.max(...items.map((item) => item.right)),
  top: Math.min(...items.map((item) => item.top)),
  bottom: Math.max(...items.map((item) => item.bottom)),
});
const nearest = (items: CameraBounds[], at: (item: CameraBounds) => number) =>
  items.reduce((best, item) => (at(item) < at(best) ? item : best));

/** 「全体」ボタンの表示。配管・接続ラベル・囲み・注記まで含めて収める。 */
export function overviewCamera(all: CameraBounds, size: ViewportSize): Camera {
  return fitCamera(all, size, fullRatio);
}

/**
 * 図を開いたときの表示。全体が読める大きさで収まればその全体表示を使い、
 * 次に境界・立体・名札（structure）が読める大きさで収まればそれを使う。
 * どちらも小さくなる大きな図では、主要な通信経路でつながる立体（focus。
 * 例: ALB・ECS・RDS）を画面の中央に大きく収める。遠くにある配備経路などは
 * 「全体」ボタンで確認する。focus がない図だけ、読める倍率で左上の要素から表示する。
 *
 * focus と items は個々の要素（立体と名札、境界の見出し）の範囲。投影した図の
 * 外接矩形は角や中央が空白になりやすいため、寄せる先は必ず実際の要素にする。
 */
export function initialCamera(
  all: CameraBounds,
  structure: CameraBounds,
  size: ViewportSize,
  focus: CameraBounds[] = [],
  items: CameraBounds[] = [],
): Camera {
  const overview = overviewCamera(all, size);
  if (overview.zoom >= readableZoom) return overview;
  const fitted = fitCamera(structure, size, structureRatio);
  if (fitted.zoom >= readableZoom) return fitted;
  if (focus.length) {
    const area = union(focus);
    const camera = fitCamera(area, size, focusRatio);
    if (camera.zoom >= focusMinZoom) return camera;
    // 端点が広く離れると外接矩形の中央は空白になる。文字が潰れない倍率を保ち、
    // 主要部分の中央に最も近い端点を画面の中央に置く。
    const middle = { x: (area.left + area.right) / 2, y: (area.top + area.bottom) / 2 };
    const target = nearest(focus, (item) =>
      Math.hypot((item.left + item.right) / 2 - middle.x, (item.top + item.bottom) / 2 - middle.y),
    );
    return center(target, size, focusMinZoom);
  }
  const zoom = readableZoom;
  const camera = center(structure, size, zoom);
  const marginX = (size.width * (1 - structureRatio.x)) / 2;
  const marginY = (size.height * (1 - structureRatio.y)) / 2;
  const visibleWidth = (size.width - marginX * 2) / zoom;
  const visibleHeight = (size.height - marginY * 2) / zoom;
  // 外接矩形の左上は空白になりやすいので、左上に最も近い要素の角を起点にする。
  // 図の右端・下端より先の空白までは寄せない。
  const start = items.length
    ? nearest(items, (item) => Math.hypot(item.left - structure.left, item.top - structure.top))
    : structure;
  if (structure.right - structure.left > visibleWidth)
    camera.x =
      marginX -
      Math.max(structure.left, Math.min(start.left, structure.right - visibleWidth)) * zoom;
  if (structure.bottom - structure.top > visibleHeight)
    camera.y =
      marginY -
      Math.max(structure.top, Math.min(start.top, structure.bottom - visibleHeight)) * zoom;
  return camera;
}
