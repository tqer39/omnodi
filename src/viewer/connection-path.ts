import { bridgePath, curvedRoutePath, nearestPathPoint } from '../core/geometry';
import type { EdgeRoute, Placement } from '../core/model';

export function connectionPath(
  route: EdgeRoute,
  data: Record<string, unknown> | undefined,
): string {
  return data?.edgeShape === 'bezier'
    ? curvedRoutePath(
        route.points,
        (data.curveObstacles ?? []) as Placement[],
        Number(data.parallelOffset ?? 0),
      )
    : String(data?.routedPath ?? bridgePath(route.points, []));
}

type Point = EdgeRoute['points'][number];

export function connectionLabelAnchor(
  path: string,
  label: Point,
  curved: boolean,
  anchor?: Point,
): Point | undefined {
  if (!curved) return anchor;
  const point = nearestPathPoint(path, label);
  return point && Math.hypot(point.x - label.x, point.y - label.y) > 16 ? point : undefined;
}
