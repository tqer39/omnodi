import {
  isTelemetrySignals,
  telemetrySignalLabels,
  type Connection,
  type Diagram,
  type EdgeKind,
} from './model.js';

/** 説明モードの1ステップ。元の接続 ID を持ち、表示上の集約とは独立させる。 */
export interface WalkthroughStep {
  connectionId: string;
  source: string;
  target: string;
  kind: EdgeKind;
  title: string;
  description: string;
  /** route・step で明示した順序か、接続の意味から並べた順序か。 */
  basis: 'explicit' | 'inferred';
  route?: { name: string; direction: 'forward' | 'return'; step: number };
}

// 利用者の操作から始まる処理を先に、運用・構造の関係を後に並べる。
const kindOrder: EdgeKind[] = [
  'traffic',
  'flow',
  'cause',
  'replication',
  'failover',
  'dependency',
  'association',
  'auth',
  'deploy',
  'inheritance',
  'realization',
  'aggregation',
  'composition',
];

const isTelemetry = (edge: Connection) => isTelemetrySignals(edge.attributes.signals);
const group = (edge: Connection) =>
  isTelemetry(edge) ? kindOrder.length : kindOrder.indexOf(edge.kind);

function sentence(edge: Connection, source: string, target: string): string {
  const explicit = edge.attributes.description;
  if (typeof explicit === 'string' && explicit.trim()) return explicit;
  const protocol = [
    typeof edge.attributes.protocol === 'string' ? edge.attributes.protocol.toUpperCase() : '',
    typeof edge.attributes.port === 'number' ? `${edge.attributes.port} 番` : '',
  ]
    .filter(Boolean)
    .join('・');
  const via = protocol ? `（${protocol}）` : '';
  if (isTelemetry(edge)) {
    const signals = (edge.attributes.signals as string[])
      .map((signal) => telemetrySignalLabels[signal] ?? signal)
      .join('・');
    return `${source} が ${target} へ ${signals} を送ります${via}。`;
  }
  switch (edge.kind) {
    case 'traffic':
      return `${source} から ${target} へ通信します${via}。`;
    case 'dependency':
      return `${source} は ${target} に依存します。構成上の依存で、通信の証拠ではありません。`;
    case 'auth':
      return `${source} が ${target} を使って認証・認可を受けます${via}。権限の成立は未確認です。`;
    case 'deploy':
      return `${source} から ${target} へ配備します。`;
    case 'association':
      return `${source} と ${target} は関連しています。通信や権限の成立を示すものではありません。`;
    case 'replication':
      return `${source} のデータを ${target} へ複製します。複製の成立は未確認です。`;
    case 'failover':
      return `障害時に ${source} から ${target} へ切り替えます。切り替えの成立は未確認です。`;
    case 'flow':
      return `${source} の次に ${target} へ進みます。`;
    case 'cause':
      return `${source} が ${target} に影響します。`;
    case 'inheritance':
      return `${source} は ${target} を継承します。`;
    case 'realization':
      return `${source} は ${target} を実現します。`;
    case 'aggregation':
      return `${source} は ${target} を集約します。`;
    case 'composition':
      return `${source} は ${target} で構成されます。`;
  }
}

/**
 * 図の接続を説明の順序に並べる。
 * route・step を明示した経路を優先し、残りは接続の種類と起点からのつながりで並べる。
 * 並べた順序は図の意味に沿った説明であり、観測した実行順や通信の成立を表さない。
 */
export function buildWalkthrough(diagram: Diagram): WalkthroughStep[] {
  const labels = new Map(diagram.resources.map((resource) => [resource.id, resource.label]));
  const types = new Map(diagram.resources.map((resource) => [resource.id, resource.type]));
  const step = (edge: Connection, basis: WalkthroughStep['basis']): WalkthroughStep => {
    const source = labels.get(edge.source) ?? edge.source;
    const target = labels.get(edge.target) ?? edge.target;
    const route =
      typeof edge.attributes.route === 'string' && typeof edge.attributes.step === 'number'
        ? {
            name: edge.attributes.route,
            direction:
              edge.attributes.routeDirection === 'return'
                ? ('return' as const)
                : ('forward' as const),
            step: edge.attributes.step,
          }
        : undefined;
    return {
      connectionId: edge.id,
      source: edge.source,
      target: edge.target,
      kind: edge.kind,
      title: `${source} → ${target}`,
      description: sentence(edge, source, target),
      basis: basis === 'explicit' && route ? 'explicit' : 'inferred',
      route,
    };
  };

  // 明示した経路は図に現れた順に、往路・復路の順で通過順に並べる。
  const routes = new Map<string, Connection[]>();
  for (const edge of diagram.connections) {
    if (typeof edge.attributes.route !== 'string' || typeof edge.attributes.step !== 'number')
      continue;
    const key = JSON.stringify([
      edge.attributes.route,
      edge.attributes.routeDirection === 'return' ? 1 : 0,
    ]);
    routes.set(key, [...(routes.get(key) ?? []), edge]);
  }
  const routeOrder = [...routes.entries()].sort(([a, edgesA], [b, edgesB]) => {
    const [nameA, directionA] = JSON.parse(a) as [string, number];
    const [nameB, directionB] = JSON.parse(b) as [string, number];
    const firstA = Math.min(...edgesA.map((edge) => diagram.connections.indexOf(edge)));
    const firstB = Math.min(...edgesB.map((edge) => diagram.connections.indexOf(edge)));
    if (nameA === nameB) return directionA - directionB;
    return firstA - firstB;
  });
  // 同じ経路名の復路は往路の直後に置く。
  const ordered: Connection[] = [];
  const placed = new Set<string>();
  for (const [key] of routeOrder) {
    const [name] = JSON.parse(key) as [string, number];
    if (placed.has(name)) continue;
    placed.add(name);
    for (const direction of [0, 1]) {
      const edges = routes.get(JSON.stringify([name, direction])) ?? [];
      ordered.push(
        ...[...edges].sort((a, b) => Number(a.attributes.step) - Number(b.attributes.step)),
      );
    }
  }
  const explicit = new Set(ordered.map((edge) => edge.id));

  // 残りは種類ごとに、外部の利用者・入力のない要素から辿れる順に並べる。
  const remaining = diagram.connections.filter((edge) => !explicit.has(edge.id));
  const inferred: Connection[] = [];
  const groups = [...new Set(remaining.map(group))].sort((a, b) => a - b);
  for (const current of groups) {
    const edges = remaining.filter((edge) => group(edge) === current);
    const incoming = new Set(edges.map((edge) => edge.target));
    const starts = [
      ...new Set(edges.map((edge) => edge.source).filter((id) => !incoming.has(id))),
    ].sort(
      (a, b) =>
        Number(!String(types.get(a)).startsWith('external.')) -
        Number(!String(types.get(b)).startsWith('external.')),
    );
    const used = new Set<string>();
    const queue = [...starts];
    const visited = new Set<string>();
    while (queue.length || used.size < edges.length) {
      if (!queue.length) {
        // 循環だけが残った場合は、図に現れた順の最初の接続から再開する。
        const next = edges.find((edge) => !used.has(edge.id))!;
        queue.push(next.source);
      }
      const id = queue.shift()!;
      if (visited.has(id)) continue;
      visited.add(id);
      for (const edge of edges) {
        if (edge.source !== id || used.has(edge.id)) continue;
        used.add(edge.id);
        inferred.push(edge);
        queue.push(edge.target);
      }
    }
  }
  return [
    ...ordered.map((edge) => step(edge, 'explicit')),
    ...inferred.map((edge) => step(edge, 'inferred')),
  ];
}
