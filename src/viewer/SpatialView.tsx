import {
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type Ref,
} from 'react';
import type { Edge, Node } from '@xyflow/react';
import { contentDimensions, resourceContent } from '../core/content';
import { metadataHeight, resourceMetadata } from '../core/resource-metadata';
import { connectionMarker } from '../core/notation';
import { resourceAppearance } from '../core/presentation';
import type { Connection, LayoutResult, Resource } from '../core/model';
import {
  SpatialViewport,
  type SpatialBounds,
  type SpatialViewControls,
  type SpatialViewportControls,
} from './SpatialViewport';
import { placeSpatialLabel, type LabelBox } from './spatial-labels';
import {
  clampOrientation,
  createProjector,
  defaultOrientation,
  mix,
  polygonPoints,
  round,
  samplesAlong,
  shade,
  tubePath,
  type Orientation,
  type Point,
  type Projector,
  type V3,
} from './spatial-math';
import {
  buildScene,
  retargetAirRoute,
  type RouteTier,
  type Scene,
  type SceneRoute,
} from './spatial-scene';
import {
  arrowCone,
  diamondTip,
  logoPlaque,
  slabPart,
  solidKindLabels,
  type SolidPart,
} from './spatial-solids';
import { resolveEmblem } from './spatial-emblems';
import { getIcon } from '../assets/icons';
import { FlowParticles, usePrefersReducedMotion } from './FlowParticles';
import './spatial-view.css';

type SpatialNode = Node<{
  resource: Resource;
  collapsed: boolean;
  related: boolean;
  muted: boolean;
  iconType?: string;
}>;
type Polygon = { points: string; fill: string; stroke: string; lines: string[]; lineColor: string };
type Bounds = { left: number; right: number; top: number; bottom: number };

const emptyBounds = (): Bounds => ({
  left: Infinity,
  right: -Infinity,
  top: Infinity,
  bottom: -Infinity,
});
const include = (bounds: Bounds, { x, y }: Point) => {
  bounds.left = Math.min(bounds.left, x);
  bounds.right = Math.max(bounds.right, x);
  bounds.top = Math.min(bounds.top, y);
  bounds.bottom = Math.max(bounds.bottom, y);
};
const includeBox = (bounds: Bounds, box: LabelBox) => {
  include(bounds, box);
  include(bounds, { x: box.x + box.width, y: box.y + box.height });
};
const boundsBox = (bounds: Bounds): LabelBox => ({
  x: bounds.left,
  y: bounds.top,
  width: bounds.right - bounds.left,
  height: bounds.bottom - bounds.top,
});
const labelWidth = (label: unknown) =>
  18 +
  [...String(label ?? '')].reduce(
    (width, char) => width + (char.codePointAt(0)! > 255 ? 12 : 7),
    0,
  );
const centerOf = (box: LabelBox): Point => ({
  x: box.x + box.width / 2,
  y: box.y + box.height / 2,
});

/** 部品を奥から順に面へ分解し、視点側を向く面だけを陰影付きで返す。 */
function drawParts(parts: SolidPart[], projector: Projector, bounds?: Bounds): Polygon[] {
  const depthOf = (part: SolidPart) => {
    let sum = 0,
      count = 0;
    for (const face of part.faces)
      for (const point of face.points) {
        sum += projector.project(point).depth;
        count++;
      }
    return count ? sum / count : 0;
  };
  const ordered = [...parts]
    .map((part) => ({ part, depth: part.ground ? -Infinity : depthOf(part) }))
    .sort((a, b) => a.depth - b.depth);
  const result: Polygon[] = [];
  for (const { part } of ordered) {
    const faces = part.faces
      .filter((face) => projector.faces(face.normal))
      .map((face) => {
        const projected = face.points.map((point) => projector.project(point));
        if (bounds) projected.forEach((point) => include(bounds, point));
        return {
          face,
          projected,
          depth: projected.reduce((sum, point) => sum + point.depth, 0) / projected.length,
        };
      })
      .sort((a, b) => a.depth - b.depth);
    for (const { face, projected } of faces) {
      const light = projector.light(face.normal);
      result.push({
        points: polygonPoints(projected),
        fill: shade(face.color, light),
        stroke: shade(face.color, light * 0.78),
        lines: (face.lines ?? []).map((line) =>
          polygonPoints(line.map((point) => projector.project(point))),
        ),
        lineColor: face.lineColor ?? '#ffffff',
      });
    }
  }
  return result;
}

function Polygons({ polygons }: { polygons: Polygon[] }) {
  return polygons.map((polygon, index) => (
    <g key={index}>
      <polygon
        points={polygon.points}
        fill={polygon.fill}
        stroke={polygon.stroke}
        strokeWidth={0.7}
        strokeLinejoin="round"
      />
      {polygon.lines.map((line, lineIndex) => (
        <polyline
          key={lineIndex}
          points={line}
          fill="none"
          stroke={polygon.lineColor}
          strokeWidth={1.1}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={0.85}
        />
      ))}
    </g>
  ));
}

const circlePoints = (projector: Projector, center: Point, z: number, radius: number, steps = 20) =>
  Array.from({ length: steps }, (_, index) => {
    const angle = (index / steps) * Math.PI * 2;
    return projector.project([
      center.x + Math.cos(angle) * radius,
      center.y + Math.sin(angle) * radius,
      z,
    ]);
  });

const tubeWidths: Record<RouteTier, number> = { under: 6.4, surface: 3.8, air: 5.4 };

interface DrawnRoute {
  route: SceneRoute;
  screen: Point[];
  path: string;
  shadow?: string;
  hangers: string[];
  ports: string[];
  heads: Polygon[];
  chevrons: (Point & { angle: number })[];
  label: Point;
  bounds: Bounds;
}

function drawRoute(
  route: SceneRoute,
  projector: Projector,
  color: string,
  curved: boolean,
): DrawnRoute {
  const bounds = emptyBounds();
  const marker = connectionMarker({ kind: route.kind as Connection['kind'] });
  const points = [...route.points];
  const heads: SolidPart[] = [];
  const width = route.telemetry ? 3.4 : tubeWidths[route.tier];
  const length = width * 2.6;
  const radius = width * 1.15;
  const direction = (from: V3, to: V3): V3 => [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
  const trim = (point: V3, toward: V3, distance: number): V3 => {
    const d = direction(point, toward);
    const norm = Math.hypot(...d) || 1;
    const amount = Math.min(distance, norm);
    return [
      point[0] + (d[0] / norm) * amount,
      point[1] + (d[1] / norm) * amount,
      point[2] + (d[2] / norm) * amount,
    ];
  };
  if (points.length >= 2) {
    if (marker === 'diamond' || marker === 'filled-diamond') {
      const [first, second] = [points[0]!, points[1]!];
      heads.push(
        diamondTip(
          first,
          direction(first, second),
          length * 1.3,
          radius,
          marker === 'diamond' ? '#ffffff' : color,
        ),
      );
      points[0] = trim(first, second, length * 1.1);
    } else {
      const last = points.at(-1)!;
      const previous = points.at(-2)!;
      heads.push(
        arrowCone(
          last,
          direction(previous, last),
          length,
          radius,
          marker === 'triangle' ? '#ffffff' : color,
        ),
      );
      points[points.length - 1] = trim(last, previous, length * 0.85);
    }
  }
  const screen = points.map((point) => projector.project(point));
  screen.forEach((point) => include(bounds, point));
  const headPolygons = drawParts(heads, projector, bounds).map((polygon) =>
    marker === 'triangle' || marker === 'diamond' ? { ...polygon, stroke: color } : polygon,
  );
  const shadowPoints = route.shadow?.map((point) => projector.project(point));
  return {
    route,
    screen,
    path: tubePath(screen, curved, route.tier === 'surface' ? 10 : 16),
    shadow: shadowPoints && tubePath(shadowPoints, curved, 16),
    // 空中の折れ点から床の影へ細い吊り線を下ろし、高さを読み取れるようにする。
    hangers: (route.shadow ?? []).map(([x, y, z]) =>
      polygonPoints([projector.project([x, y, route.label[2]]), projector.project([x, y, z])]),
    ),
    ports: route.ports.map((port) =>
      polygonPoints(
        circlePoints(projector, { x: port[0], y: port[1] }, port[2] + 0.4, width * 1.25, 14),
      ),
    ),
    heads: headPolygons,
    chevrons: route.tier === 'surface' ? [] : samplesAlong(screen, 120, 34),
    label: projector.project(route.label),
    bounds,
  };
}

function Tube({
  drawn,
  edge,
  onSelect,
}: {
  drawn: DrawnRoute;
  edge: Edge;
  onSelect: (id: string) => void;
}) {
  const color = String(edge.style?.stroke ?? '#596579');
  const base = drawn.route.telemetry ? 3.4 : tubeWidths[drawn.route.tier];
  const flow = edge.data?.flow as 'playing' | 'paused' | undefined;
  const width = edge.selected || flow ? base + 1.8 : base;
  const dash = edge.style?.strokeDasharray;
  return (
    <g
      className={`spatial-route spatial-hit${edge.selected ? ' selected' : ''}${flow ? ' flowing' : ''}`}
      data-connection-id={edge.id}
      data-tier={drawn.route.tier}
      data-kind={drawn.route.kind}
      data-telemetry={drawn.route.telemetry ? 'true' : undefined}
      opacity={edge.style?.opacity}
      onClick={() => onSelect(edge.id)}
    >
      <path
        d={drawn.path}
        className="spatial-tube-casing"
        stroke={shade(color, 0.62)}
        strokeWidth={width + 3.2}
        // 床下の配管は製図の隠れ線と同じく縁を破線にし、床の上の経路と区別する。
        strokeDasharray={drawn.route.tier === 'under' ? '7 4' : undefined}
      />
      <path
        d={drawn.path}
        className="spatial-tube-body"
        stroke={color}
        strokeWidth={width}
        opacity={drawn.route.tier === 'under' ? 0.78 : undefined}
      />
      <path
        d={drawn.path}
        className="spatial-tube-shine"
        stroke={mix(color, '#ffffff', 0.62)}
        strokeWidth={Math.max(1, width * 0.28)}
        transform="translate(-0.5 -1.1)"
      />
      {dash && (
        <path
          d={drawn.path}
          className="spatial-tube-pattern"
          stroke="#ffffff"
          strokeWidth={Math.max(1.2, width * 0.42)}
          strokeDasharray={String(dash)}
        />
      )}
      {(edge.selected || flow) && (
        <path d={drawn.path} className="spatial-tube-glow" strokeWidth={width + 9} />
      )}
      {drawn.chevrons.map((chevron, index) => (
        <path
          key={index}
          className="spatial-tube-chevron"
          d="M -2.6 -2.8 L 1.4 0 L -2.6 2.8"
          transform={`translate(${round(chevron.x)} ${round(chevron.y)}) rotate(${round(chevron.angle)})`}
        />
      ))}
      <Polygons polygons={drawn.heads} />
      {flow && (
        <FlowParticles
          d={drawn.path}
          color={color}
          playing={flow === 'playing'}
          radius={Math.max(3.4, width * 0.72)}
        />
      )}
    </g>
  );
}

function Leader({ from, to }: { from: Point; to: Point }) {
  if (Math.hypot(from.x - to.x, from.y - to.y) < 6) return null;
  return (
    <line
      className="spatial-leader"
      x1={round(from.x)}
      y1={round(from.y)}
      x2={round(to.x)}
      y2={round(to.y)}
    />
  );
}

export function SpatialView<T extends SpatialNode>({
  ref,
  active,
  layout,
  nodes,
  edges,
  overlays,
  onClear,
  onHover,
  onSelectEdge,
  onSelectNode,
  renderNode,
}: {
  ref: Ref<SpatialViewControls>;
  active: boolean;
  layout?: LayoutResult;
  nodes: T[];
  edges: Edge[];
  overlays?: Resource[];
  onClear: () => void;
  onHover: (id?: string) => void;
  onSelectEdge: (id: string) => void;
  onSelectNode: (id: string) => void;
  renderNode: (node: T) => ReactNode;
}) {
  const viewport = useRef<SpatialViewportControls>(null);
  useImperativeHandle(ref, () => ({ fit: (ids) => viewport.current?.fit(ids) }));
  const [orientation, setOrientation] = useState<Orientation>(defaultOrientation);
  const orientationRef = useRef(orientation);
  orientationRef.current = orientation;
  const shadowFilter = `spatial-shadow-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  // Octocat はポインターを向けたときと選択したときだけ反応し、常時は動かさない。
  const [pointing, setPointing] = useState<string>();
  const [hop, setHop] = useState<{ id: string; key: number }>();
  const reducedMotion = usePrefersReducedMotion();

  // 選択・ホバーでは形が変わらないので、構造が変わったときだけシーンを作り直す。
  const nodeKey = nodes.map((node) => `${node.id}:${node.data.collapsed ? 1 : 0}`).join('|');
  const edgeKey = edges
    .map(
      (edge) =>
        `${edge.id}:${String(edge.data?.parallelOffset ?? 0)}:${String(edge.style?.stroke ?? '')}`,
    )
    .join('|');
  const showOverlays = Boolean(overlays);
  const scene: Scene | undefined = useMemo(
    () =>
      active && layout
        ? buildScene(
            layout,
            nodes
              .filter((node) => node.type !== 'annotation')
              .map((node) => ({
                id: node.id,
                resource: node.data.resource,
                collapsed: node.data.collapsed,
                iconType: node.data.iconType,
                emblem: resolveEmblem(
                  node.data.resource,
                  node.data.iconType ?? node.data.resource.type,
                  node.data.collapsed,
                  getIcon,
                ),
              })),
            edges.map((edge) => ({
              id: edge.id,
              source: edge.source,
              target: edge.target,
              kind: edge.data?.kind as Connection['kind'],
              signals: edge.data?.signals,
              parallelOffset: Number(edge.data?.parallelOffset ?? 0),
            })),
            showOverlays ? (layout.overlays ?? []) : [],
          )
        : undefined,
    // nodes・edges は nodeKey・edgeKey で構造の変化を検出する。
    [active, layout, nodeKey, edgeKey, showOverlays],
  );
  const curved = edges.some((edge) => edge.data?.edgeShape === 'bezier');
  const labelSizes = useMemo(() => {
    const dimensions = (resource: Resource, width: number, base: number) => {
      const content = resourceContent(resource);
      const nameLines = Math.max(
        1,
        Math.ceil(labelWidth(resource.label) / Math.max(1, width - 62)),
      );
      const typeLines = Math.max(
        1,
        Math.ceil((labelWidth(resource.type) * 0.6) / Math.max(1, width - 62)),
      );
      const height =
        base +
        (nameLines - 1) * 18 +
        (typeLines - 1) * 12 +
        metadataHeight(resourceMetadata(resource), width) +
        (content ? contentDimensions(content, width).height : 0);
      return { width, height };
    };
    const captions = new Map(
      scene?.solids.map((item) => [
        item.id,
        dimensions(
          item.resource,
          resourceContent(item.resource)
            ? Math.min(340, Math.max(170, item.box.width))
            : Math.min(230, Math.max(128, item.box.width * 0.82)),
          40,
        ),
      ]),
    );
    const tags = new Map(
      scene?.slabs.map((slab) => [
        slab.id,
        dimensions(slab.resource, Math.min(300, Math.max(210, slab.box.width * 0.42)), 46),
      ]),
    );
    return { captions, tags };
  }, [scene]);
  const projector = useMemo(() => createProjector(orientation), [orientation]);
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const edgeColors = new Map(
    edges.map((edge) => [edge.id, String(edge.style?.stroke ?? '#596579')]),
  );

  const drawing = useMemo(() => {
    if (!scene || !layout) return undefined;
    const { extent } = scene;
    const margin = 160;
    const spacing = 80;
    const grid: string[] = [];
    for (
      let x = Math.floor((extent.left - margin) / spacing) * spacing;
      x <= extent.right + margin;
      x += spacing
    )
      grid.push(
        polygonPoints([
          projector.project([x, extent.top - margin, 0]),
          projector.project([x, extent.bottom + margin, 0]),
        ]),
      );
    for (
      let y = Math.floor((extent.top - margin) / spacing) * spacing;
      y <= extent.bottom + margin;
      y += spacing
    )
      grid.push(
        polygonPoints([
          projector.project([extent.left - margin, y, 0]),
          projector.project([extent.right + margin, y, 0]),
        ]),
      );
    const floor = polygonPoints(
      [
        [extent.left - margin, extent.top - margin],
        [extent.right + margin, extent.top - margin],
        [extent.right + margin, extent.bottom + margin],
        [extent.left - margin, extent.bottom + margin],
      ].map(([x, y]) => projector.project([x!, y!, 0])),
    );

    const slabs = [...scene.slabs]
      .map((slab) => ({
        slab,
        depth: projector.project([
          slab.box.x + slab.box.width / 2,
          slab.box.y + slab.box.height / 2,
          slab.top,
        ]).depth,
      }))
      .sort((a, b) => a.slab.level - b.slab.level || a.depth - b.depth)
      .map(({ slab }) => {
        const bounds = emptyBounds();
        const polygons = drawParts(
          [slabPart(slab.box, slab.bottom, slab.top, slab.accent)],
          projector,
          bounds,
        );
        const corners = [
          [slab.box.x, slab.box.y],
          [slab.box.x + slab.box.width, slab.box.y],
          [slab.box.x + slab.box.width, slab.box.y + slab.box.height],
          [slab.box.x, slab.box.y + slab.box.height],
        ];
        const shadow =
          slab.level === 0
            ? polygonPoints(corners.map(([x, y]) => projector.project([x! + 10, y! + 14, 0])))
            : undefined;
        const outline = polygonPoints(
          corners.map(([x, y]) => projector.project([x!, y!, slab.top])),
        );
        const header = Math.min(slab.box.contentTop ?? 56, slab.box.height);
        const tagAnchor = projector.project([slab.box.x + 18, slab.box.y + header / 2, slab.top]);
        return { slab, polygons, shadow, outline, tagAnchor, bounds };
      });

    const solidTops = new Map<string, number>();
    const solids = [...scene.solids]
      .map((item) => ({
        item,
        depth: projector.project([item.center.x, item.center.y, item.base]).depth,
      }))
      .sort((a, b) => a.depth - b.depth)
      .map(({ item }) => {
        const bounds = emptyBounds();
        let logo: { x: number; y: number; size: number; href: string } | undefined;
        let parts = item.solid.parts;
        if (item.emblem?.kind === 'aws-logo') {
          // 板は視点へ向けて作り直し、正面のロゴが画面と平行な正方形になるようにする。
          const plaque = logoPlaque(
            item.center.x,
            item.center.y,
            item.base,
            item.size,
            item.emblem.color,
            item.emblem.tile,
            projector.orientation,
          );
          parts = plaque.parts;
          solidTops.set(item.id, item.base + plaque.height);
          const [topLeft, topRight] = plaque.face.map((point) => projector.project(point));
          logo = {
            x: topLeft!.x,
            y: topLeft!.y,
            size: topRight!.x - topLeft!.x,
            href: item.emblem.href,
          };
        }
        const polygons = drawParts(parts, projector, bounds);
        const activePolygons =
          item.activeSolid && drawParts(item.activeSolid.parts, projector, bounds);
        const ring = circlePoints(projector, item.center, item.base + 0.6, item.size * 0.72, 28);
        const ground = circlePoints(projector, item.center, item.base, item.size * 0.6, 16);
        const bottom = Math.max(...ground.map((point) => point.y));
        return {
          item,
          polygons,
          activePolygons,
          logo,
          ring: polygonPoints(ring),
          shadow: polygonPoints(
            circlePoints(
              projector,
              { x: item.center.x + 6, y: item.center.y + 8 },
              item.base,
              item.size * 0.58,
              16,
            ),
          ),
          anchor: { x: projector.project([item.center.x, item.center.y, item.base]).x, y: bottom },
          bounds,
        };
      });

    const routes = new Map(
      scene.routes.map((route) => [
        route.id,
        drawRoute(
          retargetAirRoute(route, solidTops),
          projector,
          edgeColors.get(route.id) ?? '#596579',
          curved,
        ),
      ]),
    );

    const fences = scene.fences.map(({ id, box, z }) => {
      const corners = [
        [box.x, box.y],
        [box.x + box.width, box.y],
        [box.x + box.width, box.y + box.height],
        [box.x, box.y + box.height],
      ];
      const lower = corners.map(([x, y]) => projector.project([x!, y!, z + 0.5]));
      const upper = corners.map(([x, y]) => projector.project([x!, y!, z + 26]));
      const overlay = layout.overlays?.find((item) => item.id === id);
      const labelAnchor = projector.project([
        overlay?.labelX ?? box.x + 12,
        overlay?.labelY ?? box.y + 4,
        z + 26,
      ]);
      return {
        id,
        label: overlay?.label ?? id,
        lower: polygonPoints(lower),
        upper: polygonPoints(upper),
        posts: lower.map((point, index) => polygonPoints([point, upper[index]!])),
        walls: lower.map((point, index) =>
          polygonPoints([point, lower[(index + 1) % 4]!, upper[(index + 1) % 4]!, upper[index]!]),
        ),
        labelAnchor,
        bounds: [...lower, ...upper],
      };
    });

    const notes = (layout.annotations ?? []).map((note) => {
      const z = scene.surfaceAt({ x: note.x + note.width / 2, y: note.y + note.height / 2 });
      const center = projector.project([note.x + note.width / 2, note.y + note.height / 2, z + 40]);
      const anchor = note.anchor
        ? projector.project([note.anchor.x, note.anchor.y, scene.surfaceAt(note.anchor) + 10])
        : undefined;
      return { note, center, anchor };
    });
    return { grid, floor, slabs, solids, routes, fences, notes };
    // edgeColors は edgeKey に含まれる色の変化で更新する。
  }, [scene, layout, projector, curved, edgeKey]);

  const labels = useMemo(() => {
    if (!drawing || !scene) return undefined;
    const occupied: LabelBox[] = drawing.solids.map(({ bounds }) => boundsBox(bounds));
    const captions = new Map(
      [...drawing.solids]
        .sort((a, b) => b.anchor.y - a.anchor.y)
        .map(({ item, anchor }) => {
          const { width, height } = labelSizes.captions.get(item.id)!;
          const box = placeSpatialLabel(
            { x: anchor.x - width / 2, y: anchor.y + 6, width, height },
            occupied,
          );
          return [item.id, { box, anchor }] as const;
        }),
    );
    const tags = new Map(
      [...drawing.slabs].reverse().map(({ slab, tagAnchor }) => {
        const { width, height } = labelSizes.tags.get(slab.id)!;
        const box = placeSpatialLabel(
          { x: tagAnchor.x - 8, y: tagAnchor.y - height - 14, width, height },
          occupied,
        );
        return [slab.id, { box, anchor: tagAnchor }] as const;
      }),
    );
    const edgeLabels = new Map(
      edges.flatMap((edge) => {
        const drawn = drawing.routes.get(edge.id);
        if (!drawn) return [];
        const width = labelWidth(edge.label || '接続');
        const box = placeSpatialLabel(
          { x: drawn.label.x - width / 2, y: drawn.label.y - 12, width, height: 24 },
          occupied,
        );
        return [[edge.id, { box, anchor: drawn.label }] as const];
      }),
    );
    const fenceLabels = new Map(
      drawing.fences.map((fence) => {
        const width = labelWidth(fence.label);
        const box = placeSpatialLabel(
          { x: fence.labelAnchor.x, y: fence.labelAnchor.y - 26, width, height: 24 },
          occupied,
        );
        return [fence.id, { box, anchor: fence.labelAnchor }] as const;
      }),
    );
    return { captions, tags, edgeLabels, fenceLabels };
    // edges のラベル文字列は edgeKey と同じ更新契機で変わる。
  }, [drawing, scene, edgeKey, labelSizes]);

  const getBounds = (ids?: string[]): SpatialBounds | undefined => {
    if (!drawing || !labels) return undefined;
    const bounds = emptyBounds();
    const wanted = ids && new Set(ids);
    for (const { item, bounds: shape } of drawing.solids) {
      if (wanted && !wanted.has(item.id)) continue;
      includeBox(bounds, boundsBox(shape));
      const caption = labels.captions.get(item.id);
      if (caption) includeBox(bounds, caption.box);
    }
    for (const { slab, bounds: shape } of drawing.slabs) {
      if (wanted && !wanted.has(slab.id)) continue;
      includeBox(bounds, boundsBox(shape));
      const tag = labels.tags.get(slab.id);
      if (tag) includeBox(bounds, tag.box);
    }
    if (!wanted) {
      for (const drawn of drawing.routes.values()) includeBox(bounds, boundsBox(drawn.bounds));
      for (const { box } of labels.edgeLabels.values()) includeBox(bounds, box);
      for (const fence of drawing.fences) fence.bounds.forEach((point) => include(bounds, point));
      for (const { note, center } of drawing.notes)
        includeBox(bounds, {
          x: center.x - note.width / 2,
          y: center.y - note.height / 2,
          width: note.width,
          height: note.height,
        });
    }
    return Number.isFinite(bounds.left) ? bounds : undefined;
  };

  const rotate = (yaw: number, pitch: number) => {
    const current = orientationRef.current;
    const next = clampOrientation({ yaw: current.yaw + yaw, pitch: current.pitch + pitch });
    // 図の中心を軸に回し、パンとズームの位置を保つ。
    const pivot: V3 = scene ? [scene.center.x, scene.center.y, 0] : [0, 0, 0];
    const before = createProjector(current).project(pivot);
    const after = createProjector(next).project(pivot);
    viewport.current?.shift(before.x - after.x, before.y - after.y);
    orientationRef.current = next;
    setOrientation(next);
  };
  const resetOrientation = () => {
    const current = orientationRef.current;
    rotate(defaultOrientation.yaw - current.yaw, defaultOrientation.pitch - current.pitch);
  };

  const sortedEdges = [...edges].sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0));
  const tubes = (tier: RouteTier) =>
    drawing
      ? sortedEdges.map((edge) => {
          const drawn = drawing.routes.get(edge.id);
          return drawn?.route.tier === tier ? (
            <Tube key={edge.id} drawn={drawn} edge={edge} onSelect={onSelectEdge} />
          ) : null;
        })
      : null;
  const fenceColor = (id: string, index: number) => {
    const resource = overlays?.find((item) => item.id === id);
    return (
      (resource && resourceAppearance(resource).borderColor) ??
      ['#79518f', '#94651b', '#246b78'][index % 3]!
    );
  };

  return (
    <SpatialViewport
      active={active}
      ready={Boolean(drawing && labels)}
      getBounds={getBounds}
      onClear={onClear}
      onRotate={(dx, dy) => rotate(dx * 0.35, dy * 0.3)}
      ref={viewport}
      controls={
        <>
          <span className="spatial-controls-separator" aria-hidden="true" />
          <button
            type="button"
            aria-label="3D マップを左に回転"
            title="左に回転（Shift+ドラッグ・右ドラッグでも回転）"
            onClick={() => rotate(-22.5, 0)}
          >
            ⟲
          </button>
          <button
            type="button"
            aria-label="3D マップを右に回転"
            title="右に回転"
            onClick={() => rotate(22.5, 0)}
          >
            ⟳
          </button>
          <button
            type="button"
            aria-label="3D マップを見下ろす"
            title="真上に近づける"
            onClick={() => rotate(0, 10)}
          >
            ⤒
          </button>
          <button
            type="button"
            aria-label="3D マップを低い視点にする"
            title="水平に近づける"
            onClick={() => rotate(0, -10)}
          >
            ⤓
          </button>
          <button
            type="button"
            aria-label="3D マップの向きを戻す"
            title="既定の向きに戻す"
            onClick={resetOrientation}
          >
            向き
          </button>
        </>
      }
      aside={
        <aside className="spatial-legend" aria-label="3D の経路の凡例">
          <span data-tier="air">上空：依存・認証・デプロイ</span>
          <span data-tier="surface">床面：関連・業務フロー・UML</span>
          <span data-tier="under">床下：通信・複製・切替・監視信号</span>
        </aside>
      }
    >
      {drawing && labels && (
        <>
          <svg
            className="spatial-drawing"
            width="1"
            height="1"
            aria-hidden="true"
            data-yaw={round(projector.orientation.yaw)}
            data-pitch={round(projector.orientation.pitch)}
          >
            <defs>
              <filter id={shadowFilter} x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="7" />
              </filter>
            </defs>
            <g className="spatial-floor">
              <polygon points={drawing.floor} className="spatial-floor-plane" />
              {drawing.grid.map((line, index) => (
                <polyline key={index} points={line} className="spatial-floor-grid" />
              ))}
            </g>
            <g className="spatial-shadows" filter={`url(#${shadowFilter})`}>
              {drawing.slabs.map(
                ({ slab, shadow }) => shadow && <polygon key={slab.id} points={shadow} />,
              )}
            </g>
            {drawing.slabs.map(({ slab, polygons, outline }) => {
              const node = nodesById.get(slab.id);
              return (
                <g
                  key={slab.id}
                  className={`spatial-slab${node?.data.related ? ' related' : ''}`}
                  data-slab-id={slab.id}
                  data-level={slab.level}
                >
                  <Polygons polygons={polygons} />
                  <polygon
                    points={outline}
                    className="spatial-slab-rim"
                    stroke={node?.data.related ? '#1c8a7c' : slab.accent}
                    strokeDasharray={
                      resourceAppearance(slab.resource).borderStyle === 'dashed' ? '8 5' : undefined
                    }
                  />
                </g>
              );
            })}
            <g className="spatial-layer-under" data-layer="under">
              {drawing.solids.length > 0 &&
                sortedEdges.map((edge) => {
                  const drawn = drawing.routes.get(edge.id);
                  return drawn?.ports.map((port, index) => (
                    <polygon
                      key={`${edge.id}-${index}`}
                      points={port}
                      className="spatial-port"
                      opacity={edge.style?.opacity}
                    />
                  ));
                })}
              {tubes('under')}
            </g>
            <g className="spatial-layer-surface" data-layer="surface">
              {sortedEdges.map((edge) => {
                const drawn = drawing.routes.get(edge.id);
                return drawn?.shadow ? (
                  <g key={edge.id} opacity={edge.style?.opacity}>
                    <path d={drawn.shadow} className="spatial-air-shadow" />
                    {drawn.hangers.map((hanger, index) => (
                      <polyline
                        key={index}
                        points={hanger}
                        className="spatial-air-hanger"
                        stroke={String(edge.style?.stroke ?? '#596579')}
                      />
                    ))}
                  </g>
                ) : null;
              })}
              {drawing.fences.map((fence, index) => {
                const color = fenceColor(fence.id, index);
                return (
                  <g
                    key={fence.id}
                    className="spatial-fence"
                    data-fence-id={fence.id}
                    stroke={color}
                    fill={color}
                  >
                    {fence.walls.map((wall, wallIndex) => (
                      <polygon key={wallIndex} points={wall} className="spatial-fence-wall" />
                    ))}
                    <polygon points={fence.lower} className="spatial-fence-edge" />
                    <polygon points={fence.upper} className="spatial-fence-edge" />
                    {fence.posts.map((post, postIndex) => (
                      <polyline key={postIndex} points={post} className="spatial-fence-post" />
                    ))}
                  </g>
                );
              })}
              {tubes('surface')}
            </g>
            <g className="spatial-solids">
              {drawing.solids.map(({ item, polygons, activePolygons, logo, ring, shadow }) => {
                const node = nodesById.get(item.id);
                const appearance = resourceAppearance(item.resource);
                const active = Boolean(activePolygons && (node?.selected || pointing === item.id));
                return (
                  <g
                    key={item.id}
                    className={`spatial-solid spatial-hit${node?.selected ? ' selected' : ''}${node?.data.related ? ' related' : ''}${node?.data.muted ? ' muted' : ''}`}
                    data-solid-id={item.id}
                    data-solid-kind={item.kind}
                    data-emblem={item.emblem?.kind}
                    data-pose={activePolygons ? (active ? 'wave' : 'rest') : undefined}
                    opacity={node?.data.muted ? 0.32 : appearance.opacity}
                    onClick={() => {
                      if (item.emblem?.kind === 'octocat' && !reducedMotion)
                        setHop({ id: item.id, key: Date.now() });
                      onSelectNode(item.id);
                    }}
                    onPointerEnter={() => {
                      setPointing(item.id);
                      onHover(item.id);
                    }}
                    onPointerLeave={() => {
                      setPointing(undefined);
                      onHover();
                    }}
                  >
                    <title>
                      {item.emblem?.kind === 'octocat'
                        ? `${item.resource.label}（GitHub の Octocat）`
                        : item.emblem?.kind === 'aws-logo'
                          ? `${item.resource.label}（AWS 公式アイコン・${solidKindLabels[item.kind]}）`
                          : `${item.resource.label}（${solidKindLabels[item.kind]}）`}
                    </title>
                    <polygon points={shadow} className="spatial-solid-shadow" />
                    {(node?.selected ||
                      node?.data.related ||
                      appearance.borderStyle === 'dashed') && (
                      <polygon
                        points={ring}
                        className="spatial-solid-ring"
                        stroke={
                          node?.selected || node?.data.related ? undefined : appearance.borderColor
                        }
                        strokeDasharray={
                          appearance.borderStyle === 'dashed' && !node?.selected ? '6 4' : undefined
                        }
                      />
                    )}
                    <g
                      key={hop?.id === item.id ? hop.key : undefined}
                      className={hop?.id === item.id ? 'spatial-hop' : undefined}
                      onAnimationEnd={() => setHop(undefined)}
                    >
                      <Polygons polygons={active ? activePolygons! : polygons} />
                      {logo && (
                        <image
                          className="spatial-logo"
                          href={logo.href}
                          x={round(logo.x)}
                          y={round(logo.y)}
                          width={round(logo.size)}
                          height={round(logo.size)}
                          preserveAspectRatio="xMidYMid meet"
                        />
                      )}
                    </g>
                  </g>
                );
              })}
            </g>
            <g className="spatial-layer-air" data-layer="air">
              {tubes('air')}
            </g>
            <g className="spatial-leaders">
              {drawing.slabs.map(({ slab }) => {
                const tag = labels.tags.get(slab.id);
                return (
                  tag && (
                    <Leader
                      key={slab.id}
                      from={tag.anchor}
                      to={{ x: tag.box.x + 12, y: tag.box.y + tag.box.height }}
                    />
                  )
                );
              })}
              {drawing.solids.map(({ item }) => {
                const caption = labels.captions.get(item.id);
                return (
                  caption && (
                    <Leader
                      key={item.id}
                      from={caption.anchor}
                      to={{ x: centerOf(caption.box).x, y: caption.box.y }}
                    />
                  )
                );
              })}
              {sortedEdges.map((edge) => {
                const label = labels.edgeLabels.get(edge.id);
                return (
                  label && <Leader key={edge.id} from={label.anchor} to={centerOf(label.box)} />
                );
              })}
              {drawing.notes.map(
                ({ note, center, anchor }) =>
                  anchor && <Leader key={note.id} from={anchor} to={center} />,
              )}
            </g>
          </svg>
          {drawing.slabs.map(({ slab }) => {
            const node = nodesById.get(slab.id);
            const tag = labels.tags.get(slab.id);
            if (!node || !tag) return null;
            return (
              <div
                key={slab.id}
                className="spatial-item spatial-header"
                data-resource-id={slab.id}
                style={
                  {
                    left: tag.box.x,
                    top: tag.box.y,
                    width: tag.box.width,
                    '--slab-accent': slab.accent,
                  } as CSSProperties
                }
                onPointerEnter={() => onHover(slab.id)}
                onPointerLeave={() => onHover()}
              >
                {renderNode(node)}
              </div>
            );
          })}
          {drawing.solids.map(({ item }) => {
            const node = nodesById.get(item.id);
            const caption = labels.captions.get(item.id);
            if (!node || !caption) return null;
            return (
              <div
                key={item.id}
                className={`spatial-item spatial-caption${node.data.muted ? ' muted' : ''}`}
                data-resource-id={item.id}
                data-solid-kind={item.kind}
                style={{ left: caption.box.x, top: caption.box.y, width: caption.box.width }}
                onPointerEnter={() => onHover(item.id)}
                onPointerLeave={() => onHover()}
              >
                {renderNode(node)}
              </div>
            );
          })}
          {drawing.notes.map(({ note, center }) => {
            const node = nodesById.get(note.id);
            return node ? (
              <div
                key={note.id}
                className="spatial-item spatial-note"
                data-resource-id={note.id}
                style={{
                  left: center.x - note.width / 2,
                  top: center.y - note.height / 2,
                  width: note.width,
                  minHeight: note.height,
                }}
              >
                {renderNode(node)}
              </div>
            ) : null;
          })}
          {drawing.fences.map((fence, index) => {
            const label = labels.fenceLabels.get(fence.id);
            if (!label) return null;
            const color = fenceColor(fence.id, index);
            return (
              <span
                key={fence.id}
                className="spatial-overlay-label"
                style={{ left: label.box.x, top: label.box.y, color, borderColor: color }}
              >
                {fence.label}
              </span>
            );
          })}
          {sortedEdges.map((edge) => {
            const label = labels.edgeLabels.get(edge.id);
            const drawn = drawing.routes.get(edge.id);
            if (!label || !drawn) return null;
            return (
              <button
                key={edge.id}
                type="button"
                className={`connection-label spatial-edge-label${layout?.compact ? ' compact-label' : ''}`}
                data-kind={String(edge.data?.kind)}
                data-tier={drawn.route.tier}
                aria-label={String(edge.data?.accessibleLabel ?? edge.label)}
                aria-pressed={edge.selected}
                style={
                  {
                    left: centerOf(label.box).x,
                    top: centerOf(label.box).y,
                    opacity: edge.style?.opacity,
                    '--connection-color': edge.style?.stroke,
                  } as CSSProperties
                }
                onFocus={() => onSelectEdge(edge.id)}
                onClick={() => onSelectEdge(edge.id)}
              >
                {edge.label || '接続'}
              </button>
            );
          })}
        </>
      )}
    </SpatialViewport>
  );
}
