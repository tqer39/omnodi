import { absolutePlacements } from '../core/geometry';
import {
  isBoundary,
  type EdgeKind,
  type EdgeRoute,
  type LayoutResult,
  type Placement,
  type Resource,
} from '../core/model';
import { resourceAppearance } from '../core/presentation';
import { buildSolid, solidColors, solidKind, type Solid, type SolidKind } from './spatial-solids';
import { mix, type Point, type V3 } from './spatial-math';

export type RouteTier = 'under' | 'surface' | 'air';
export interface SceneNodeInput {
  id: string;
  resource: Resource;
  collapsed: boolean;
  iconType?: string;
}
export interface SceneEdgeInput {
  id: string;
  source: string;
  target: string;
  kind: EdgeKind;
  signals?: unknown;
  /** 同じ端点を結ぶ接続を離す量。2D の平行移動量（64 単位）と同じ尺度。 */
  parallelOffset?: number;
}
export interface SceneSlab {
  id: string;
  resource: Resource;
  box: Placement;
  level: number;
  bottom: number;
  top: number;
  accent: string;
}
export interface SceneSolid {
  id: string;
  resource: Resource;
  box: Placement;
  kind: SolidKind;
  center: Point;
  base: number;
  top: number;
  size: number;
  solid: Solid;
}
export interface SceneRoute {
  id: string;
  kind: EdgeKind;
  tier: RouteTier;
  telemetry: boolean;
  points: V3[];
  /** 空中の経路が床へ落とす影。 */
  shadow?: V3[];
  /** 床下の経路が床を貫く位置。 */
  ports: V3[];
  label: V3;
}
export interface SceneFence {
  id: string;
  box: Placement;
  z: number;
}
export interface Scene {
  slabs: SceneSlab[];
  solids: SceneSolid[];
  routes: SceneRoute[];
  fences: SceneFence[];
  center: Point;
  extent: { left: number; right: number; top: number; bottom: number };
  surfaceAt: (point: Point) => number;
}

// 境界は入れ子ごとに一段ずつ持ち上げ、所属の深さを高さで読めるようにする。
export const slabThickness = { root: 12, nested: 9 } as const;
/** 通信の配管は床（z=0）より下、操作の経路は立体の上空を通す。 */
export const tierDepths = { traffic: -26, telemetry: -13, replication: -40 } as const;
export const airClearance = 120;
const airOffsets: Partial<Record<EdgeKind, number>> = { dependency: 0, auth: 30, deploy: 60 };

export function routeTier(kind: EdgeKind): RouteTier {
  if (kind === 'traffic' || kind === 'replication' || kind === 'failover') return 'under';
  if (kind === 'dependency' || kind === 'auth' || kind === 'deploy') return 'air';
  return 'surface';
}
const isTelemetry = (signals: unknown) => Array.isArray(signals) && signals.length > 0;

const boundaryAccents: Record<string, string> = {
  account: '#c4692c',
  project: '#3d7bd2',
  subscription: '#2a76bf',
  region: '#23869a',
  vpc: '#6a50b6',
  network: '#6a50b6',
  subnet: '#3c8c6a',
  zone: '#3f87ad',
  cluster: '#d0782a',
  namespace: '#3b6fd4',
  'k8s.namespace': '#3b6fd4',
  'k8s.deployment': '#2b8fb0',
  'aws.eks': '#d0782a',
  'aws.eks-cluster': '#d0782a',
  'aws.eks-node-group': '#b8652b',
  'aws.ecs-cluster': '#1f8ea3',
  'aws.ecs-service': '#1f9bb0',
  site: '#8a6d4a',
  rack: '#55606e',
  'business.lane': '#a0793d',
  'aws.organization': '#b8433b',
  'aws.organization-root': '#b8433b',
  'aws.organizational-unit': '#a64f7e',
  'aws.organization-account': '#c4692c',
};
const levelAccents = ['#5f8f86', '#4d7fa0', '#6c6fae', '#5c8f68'];

export function boundaryAccent(resource: Resource, level: number): string {
  return (
    resourceAppearance(resource).borderColor ??
    boundaryAccents[resource.type] ??
    levelAccents[level % levelAccents.length]!
  );
}

const contains = (box: Placement, { x, y }: Point) =>
  x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height;
const toward = (from: Point, to: Point, distance: number): Point => {
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  if (length <= distance || !length) return to;
  return {
    x: from.x + ((to.x - from.x) / length) * distance,
    y: from.y + ((to.y - from.y) / length) * distance,
  };
};
const dedupe3 = (points: V3[]) =>
  points.filter(
    (point, index) =>
      index === 0 ||
      Math.hypot(
        point[0] - points[index - 1]![0],
        point[1] - points[index - 1]![1],
        point[2] - points[index - 1]![2],
      ) > 0.5,
  );

/** 立体の大きさ。2D のカード枠に収め、極端に小さい・大きい形を避ける。 */
export const solidSize = (box: Placement) =>
  Math.round(Math.min(104, Math.max(44, Math.min(box.width * 0.5, box.height * 1.3))));

export function buildScene(
  layout: LayoutResult,
  nodes: SceneNodeInput[],
  edges: SceneEdgeInput[],
  overlays: NonNullable<LayoutResult['overlays']> = [],
): Scene {
  const placements = absolutePlacements(layout.nodes);
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const slabs: SceneSlab[] = [];
  const slabById = new Map<string, SceneSlab>();
  const levelOf = (placement: Placement): number => {
    let level = 0;
    let parent = placement.parentId;
    const seen = new Set<string>();
    while (parent && !seen.has(parent)) {
      seen.add(parent);
      if (slabById.has(parent) || byId.has(parent)) level++;
      parent = placements.get(parent)?.parentId;
    }
    return level;
  };
  // 親を先に処理し、子の台座を親の上面に載せる。
  const ordered = [...nodes]
    .filter((node) => placements.has(node.id))
    .sort((a, b) => levelOf(placements.get(a.id)!) - levelOf(placements.get(b.id)!));
  for (const node of ordered) {
    if (!isBoundary(node.resource) || node.collapsed) continue;
    const box = placements.get(node.id)!;
    const parent = box.parentId ? slabById.get(box.parentId) : undefined;
    const level = parent ? parent.level + 1 : 0;
    const bottom = parent?.top ?? 0;
    const top = bottom + (parent ? slabThickness.nested : slabThickness.root);
    const slab = {
      id: node.id,
      resource: node.resource,
      box,
      level,
      bottom,
      top,
      accent: boundaryAccent(node.resource, level),
    };
    slabs.push(slab);
    slabById.set(node.id, slab);
  }
  const surfaceAt = (point: Point) =>
    slabs.reduce(
      (height, slab) => (contains(slab.box, point) ? Math.max(height, slab.top) : height),
      0,
    );

  const solids: SceneSolid[] = [];
  const solidById = new Map<string, SceneSolid>();
  for (const node of ordered) {
    if (slabById.has(node.id)) continue;
    const box = placements.get(node.id)!;
    const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const parent = box.parentId ? slabById.get(box.parentId) : undefined;
    const base = parent?.top ?? surfaceAt(center);
    const size = solidSize(box);
    const kind = solidKind(node.resource, node.iconType, node.collapsed);
    const appearance = resourceAppearance(node.resource);
    const color =
      kind === 'collapsed'
        ? boundaryAccent(node.resource, levelOf(box))
        : appearance.borderColor && node.resource.attributes.change
          ? mix(solidColors[kind], appearance.borderColor, 0.45)
          : solidColors[kind];
    const solid = buildSolid(kind, center.x, center.y, base, size, color);
    const item = {
      id: node.id,
      resource: node.resource,
      box,
      kind,
      center,
      base,
      top: base + solid.height,
      size,
      solid,
    };
    solids.push(item);
    solidById.set(node.id, item);
  }

  const endpoint = (id: string, point: Point) => {
    const solid = solidById.get(id);
    if (solid)
      return { center: solid.center, base: solid.base, top: solid.top, radius: solid.size * 0.36 };
    // 展開した境界や表示されない端点は、経路の端を境界の縁として扱う。
    const height = slabById.get(id)?.top ?? surfaceAt(point);
    return { center: point, base: height, top: height, radius: 0 };
  };
  const routes: SceneRoute[] = [];
  const routeById = new Map((layout.edges ?? []).map((route) => [route.id, route]));
  for (const edge of edges) {
    let route: EdgeRoute | undefined = routeById.get(edge.id);
    if (!route || route.points.length < 2) {
      const source = placements.get(edge.source);
      const target = placements.get(edge.target);
      if (!source || !target) continue;
      const start = { x: source.x + source.width, y: source.y + source.height / 2 };
      const end = { x: target.x, y: target.y + target.height / 2 };
      route = { id: edge.id, points: [start, end] };
    }
    const first = route.points[0]!;
    const last = route.points.at(-1)!;
    const middle = route.points.slice(1, -1);
    const source = endpoint(edge.source, first);
    const target = endpoint(edge.target, last);
    const tier = routeTier(edge.kind);
    const telemetry = tier === 'under' && edge.kind === 'traffic' && isTelemetry(edge.signals);
    const lane = (edge.parallelOffset ?? 0) / 64;
    const labelPoint = route.label ?? route.points[Math.floor(route.points.length / 2)]!;
    const start = toward(source.center, first, source.radius);
    const end = toward(target.center, last, target.radius);
    let points: V3[];
    let shadow: V3[] | undefined;
    let ports: V3[] = [];
    let labelZ: number;
    if (tier === 'under') {
      const depth =
        (telemetry
          ? tierDepths.telemetry
          : edge.kind === 'traffic'
            ? tierDepths.traffic
            : tierDepths.replication) -
        lane * 6;
      const out = source.base + 6;
      const into = target.base + 6;
      // 立体の脇から床へ潜り、床下を通って接続先の脇で立ち上がる。
      points = [
        [start.x, start.y, out],
        [first.x, first.y, out],
        [first.x, first.y, depth],
        ...middle.map(({ x, y }): V3 => [x, y, depth]),
        [last.x, last.y, depth],
        [last.x, last.y, into],
        [end.x, end.y, into],
      ];
      ports = [
        [first.x, first.y, source.base],
        [last.x, last.y, target.base],
      ];
      labelZ = depth;
    } else if (tier === 'air') {
      const ground = Math.max(...route.points.map(surfaceAt), source.base, target.base);
      const height =
        Math.max(source.top, target.top, ground + airClearance) +
        (airOffsets[edge.kind] ?? 0) +
        lane * 14;
      // 立体の上面から真上へ上がり、上空を渡って接続先へ降りる。
      points = [
        [source.center.x, source.center.y, source.top],
        [source.center.x, source.center.y, height],
        [first.x, first.y, height],
        ...middle.map(({ x, y }): V3 => [x, y, height]),
        [last.x, last.y, height],
        [target.center.x, target.center.y, height],
        [target.center.x, target.center.y, target.top + 1],
      ];
      shadow = points.slice(1, -1).map(([x, y]): V3 => [x, y, surfaceAt({ x, y }) + 0.6]);
      labelZ = height;
    } else {
      const height =
        Math.max(source.base, target.base, ...route.points.map(surfaceAt)) + 5 + lane * 3;
      points = [
        [start.x, start.y, height],
        [first.x, first.y, height],
        ...middle.map(({ x, y }): V3 => [x, y, height]),
        [last.x, last.y, height],
        [end.x, end.y, height],
      ];
      labelZ = height;
    }
    routes.push({
      id: edge.id,
      kind: edge.kind,
      tier,
      telemetry,
      points: dedupe3(points),
      shadow,
      ports,
      label: [labelPoint.x, labelPoint.y, labelZ],
    });
  }

  const fences = overlays.map((box) => {
    const members = box.members.map((id) => solidById.get(id)).filter((item) => item !== undefined);
    const z = members.length
      ? Math.max(...members.map((item) => item.base))
      : surfaceAt({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
    return { id: box.id, box, z };
  });

  const boxes = [...placements.values(), ...(layout.annotations ?? []), ...overlays];
  const extent = boxes.length
    ? {
        left: Math.min(...boxes.map((box) => box.x)),
        right: Math.max(...boxes.map((box) => box.x + box.width)),
        top: Math.min(...boxes.map((box) => box.y)),
        bottom: Math.max(...boxes.map((box) => box.y + box.height)),
      }
    : { left: 0, right: 0, top: 0, bottom: 0 };
  return {
    slabs,
    solids,
    routes,
    fences,
    center: { x: (extent.left + extent.right) / 2, y: (extent.top + extent.bottom) / 2 },
    extent,
    surfaceAt,
  };
}
