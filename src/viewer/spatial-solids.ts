import { nodeShape } from '../core/notation';
import { isBoundary, type Resource } from '../core/model';
import { mix, type V3 } from './spatial-math';

/** 機能ごとの立体形状。ベンダーの平面ロゴではなく、役割を形で区別する。 */
export const solidKinds = [
  'compute',
  'container',
  'pod',
  'function',
  'database',
  'cache',
  'storage',
  'queue',
  'loadBalancer',
  'cdn',
  'gateway',
  'router',
  'dns',
  'firewall',
  'identity',
  'secret',
  'user',
  'cicd',
  'repository',
  'monitoring',
  'ai',
  'collapsed',
  'decision',
  'terminal',
  'variable',
  'generic',
] as const;
export type SolidKind = (typeof solidKinds)[number];

export const solidKindLabels: Record<SolidKind, string> = {
  compute: '計算機',
  container: 'コンテナ',
  pod: 'Pod',
  function: '関数',
  database: 'データベース',
  cache: 'キャッシュ',
  storage: 'ストレージ',
  queue: 'キュー・イベント',
  loadBalancer: 'ロードバランサー',
  cdn: 'CDN・エッジ',
  gateway: 'ゲートウェイ',
  router: 'ルーター・ハブ',
  dns: 'DNS',
  firewall: 'ファイアウォール',
  identity: 'ID・権限',
  secret: '鍵・シークレット',
  user: 'ユーザー',
  cicd: 'CI/CD',
  repository: 'リポジトリ',
  monitoring: '監視',
  ai: 'AI・LLM',
  collapsed: '折りたたんだ境界',
  decision: '分岐',
  terminal: '開始・終了',
  variable: '変数',
  generic: '汎用',
};

export const solidColors: Record<SolidKind, string> = {
  compute: '#e07b39',
  container: '#1f9bb0',
  pod: '#3b73d9',
  function: '#ef9d1a',
  database: '#3962c8',
  cache: '#d4483f',
  storage: '#3b9a57',
  queue: '#c4527a',
  loadBalancer: '#7a55d1',
  cdn: '#2a8fdc',
  gateway: '#5d64c6',
  router: '#4558bd',
  dns: '#6e58c9',
  firewall: '#c8463d',
  identity: '#d29a1e',
  secret: '#b07a14',
  user: '#5f738a',
  cicd: '#7650c2',
  repository: '#3d4756',
  monitoring: '#22a079',
  ai: '#c45bb0',
  collapsed: '#6f8aa0',
  decision: '#df9d32',
  terminal: '#3aa17a',
  variable: '#c26a3a',
  generic: '#7d8fa6',
};

// 種別 ID の区切り単位で照合し、部分文字列の偶然一致（例: "terminate" と "nat"）を避ける。
const tokenRules: [SolidKind, string[]][] = [
  ['user', ['user', 'users', 'person', 'actor', 'customer', 'client', 'browser']],
  [
    'ai',
    [
      'claude',
      'claudecode',
      'anthropic',
      'googlegemini',
      'gemini',
      'openai',
      'gpt',
      'deepseek',
      'mistralai',
      'perplexity',
      'qwen',
      'openrouter',
      'replicate',
      'ollama',
      'lmstudio',
      'vllm',
      'dify',
      'langchain',
      'langgraph',
      'huggingface',
      'bedrock',
      'sagemaker',
      'vertex',
      'llm',
      'ai',
    ],
  ],
  [
    'cicd',
    [
      'actions',
      'ci',
      'circleci',
      'pipeline',
      'codebuild',
      'codedeploy',
      'codepipeline',
      'terraform',
      'argocd',
      'argo',
      'jenkins',
      'build',
    ],
  ],
  [
    'repository',
    ['repository', 'repo', 'github', 'gitlab', 'bitbucket', 'ecr', 'registry', 'artifact'],
  ],
  [
    'monitoring',
    [
      'datadog',
      'newrelic',
      'grafana',
      'prometheus',
      'sentry',
      'monitor',
      'cloudwatch',
      'kibana',
      'observability',
      'collector',
      'logging',
      'logs',
      'xray',
      'trace',
      'otel',
    ],
  ],
  ['secret', ['kms', 'keyvault', 'secret', 'secrets', '1password', 'acm', 'certificate', 'vault']],
  [
    'identity',
    [
      'iam',
      'identity',
      'role',
      'binding',
      'account',
      'managed',
      'entra',
      'okta',
      'auth0',
      'cognito',
      'access',
      'sso',
      'oidc',
      'policy',
      'principal',
      'ram',
    ],
  ],
  ['dns', ['route53', 'dns']],
  ['firewall', ['waf', 'firewall', 'armor', 'ddos', 'shield', 'sg', 'security', 'nacl']],
  ['cdn', ['cloudfront', 'cdn', 'cloudflare', 'vercel', 'netlify', 'fastly', 'akamai', 'edge']],
  [
    'loadBalancer',
    [
      'alb',
      'elb',
      'nlb',
      'lb',
      'balancing',
      'balancer',
      'nginx',
      'envoyproxy',
      'envoy',
      'lattice',
      'ingress',
      'apigateway',
      'frontdoor',
    ],
  ],
  ['router', ['transit', 'tgw', 'router', 'bgp', 'direct', 'peering', 'hub']],
  [
    'gateway',
    ['igw', 'nat', 'vpn', 'gateway', 'privatelink', 'endpoint', 'tunnel', 'network', 'interface'],
  ],
  ['cache', ['elasticache', 'redis', 'memcached', 'cache', 'valkey']],
  [
    'database',
    [
      'rds',
      'sql',
      'aurora',
      'dynamodb',
      'postgresql',
      'postgres',
      'mysql',
      'mongodb',
      'neon',
      'turso',
      'supabase',
      'firebase',
      'database',
      'db',
      'bigquery',
      'cosmos',
      'spanner',
      'firestore',
      'elasticsearch',
      'warehouse',
    ],
  ],
  ['storage', ['s3', 'storage', 'bucket', 'efs', 'blob', 'backup', 'disk', 'volume', 'file']],
  [
    'queue',
    [
      'queue',
      'sqs',
      'sns',
      'pubsub',
      'subscription',
      'kafka',
      'kinesis',
      'eventbridge',
      'events',
      'stream',
      'bus',
      'topic',
    ],
  ],
  ['function', ['lambda', 'functions', 'function']],
  ['pod', ['pod']],
  [
    'compute',
    [
      'ec2',
      'compute',
      'vm',
      'instance',
      'node',
      'autoscaling',
      'server',
      'host',
      'machine',
      'rack',
      'onprem',
      'floor',
    ],
  ],
  [
    'container',
    [
      'ecs',
      'container',
      'docker',
      'run',
      'fargate',
      'app',
      'beanstalk',
      'deployment',
      'service',
      'task',
      'fly',
      'render',
      'railway',
      'digitalocean',
      'heroku',
      'kubernetes',
      'eks',
    ],
  ],
];
// 区切り単位の語では役割が逆になる種別だけを明示する。
const exactKinds: Record<string, SolidKind> = {
  'k8s.service': 'loadBalancer',
  'k8s.network-policy': 'firewall',
  'external.service': 'generic',
};
const tokens = (type: string) =>
  new Set(
    type
      .toLowerCase()
      .split(/[.\-_/:]+/)
      .filter(Boolean),
  );
const tokenKind = (type: string): SolidKind | undefined => {
  const set = tokens(type);
  // 提供元の接頭辞（aws・gcp・saas など）は役割を示さないので照合から外す。
  for (const prefix of ['aws', 'gcp', 'azure', 'saas', 'external', 'software', 'k8s', 'custom'])
    set.delete(prefix);
  return tokenRules.find(([, words]) => words.some((word) => set.has(word)))?.[0];
};

/** 型・明示した見た目・記法から形を選ぶ。未知の型も汎用の立体で表示する。 */
export function solidKind(
  resource: Resource,
  iconType = resource.type,
  collapsed = false,
): SolidKind {
  if (collapsed || isBoundary(resource)) return 'collapsed';
  const appearance = resource.attributes.appearance;
  if (appearance === 'database') return 'database';
  if (appearance === 'queue') return 'queue';
  if (appearance === 'storage') return 'storage';
  if (appearance === 'rack') return 'compute';
  if (resource.type === 'causal.variable') return 'variable';
  if (resource.type === 'flow.decision') return 'decision';
  if (resource.type === 'flow.start' || resource.type === 'flow.end') return 'terminal';
  const shape = nodeShape(resource);
  if (shape === 'diamond') return 'decision';
  if (shape === 'ellipse') return 'terminal';
  const exact = Object.hasOwn(exactKinds, resource.type) ? exactKinds[resource.type] : undefined;
  if (exact) return exact;
  if (/^(uml|flow|business)\./.test(resource.type)) return 'generic';
  return (
    tokenKind(resource.type) ??
    (iconType !== resource.type
      ? ((Object.hasOwn(exactKinds, iconType) ? exactKinds[iconType] : undefined) ??
        tokenKind(iconType))
      : undefined) ??
    'generic'
  );
}

export interface SolidFace {
  points: V3[];
  normal: V3;
  color: string;
  /** 面が見えるときだけ描く溝・表示灯などの細部。 */
  lines?: V3[][];
  lineColor?: string;
}
export interface SolidPart {
  faces: SolidFace[];
  /** 台座など、常に最初に描く部品。 */
  ground?: boolean;
}
export interface Solid {
  kind: SolidKind;
  parts: SolidPart[];
  /** 台座の底から最上部までの高さ。 */
  height: number;
}

type Palette = { main: string; alt: string; light: string; dark: string };
const palette = (main: string): Palette => ({
  main,
  alt: mix(main, '#ffffff', 0.2),
  light: mix(main, '#ffffff', 0.55),
  dark: mix(main, '#10202c', 0.35),
});

type FaceLines = (corner: (u: number, v: number) => V3) => V3[][];
function quad(
  a: V3,
  b: V3,
  c: V3,
  d: V3,
  normal: V3,
  color: string,
  lines?: FaceLines,
  lineColor?: string,
): SolidFace {
  // a→b を横、a→d を縦とした面上の座標で細部を置く。
  const corner = (u: number, v: number): V3 => [
    a[0] + (b[0] - a[0]) * u + (d[0] - a[0]) * v,
    a[1] + (b[1] - a[1]) * u + (d[1] - a[1]) * v,
    a[2] + (b[2] - a[2]) * u + (d[2] - a[2]) * v,
  ];
  return { points: [a, b, c, d], normal, color, lines: lines?.(corner), lineColor };
}

function box(
  cx: number,
  cy: number,
  z: number,
  width: number,
  depth: number,
  height: number,
  color: string,
  options: { top?: string; sides?: FaceLines; topLines?: FaceLines; lineColor?: string } = {},
): SolidPart {
  const x0 = cx - width / 2,
    x1 = cx + width / 2,
    y0 = cy - depth / 2,
    y1 = cy + depth / 2,
    z1 = z + height;
  const { sides, lineColor } = options;
  return {
    faces: [
      quad(
        [x0, y0, z1],
        [x1, y0, z1],
        [x1, y1, z1],
        [x0, y1, z1],
        [0, 0, 1],
        options.top ?? color,
        options.topLines,
        lineColor,
      ),
      quad(
        [x0, y1, z],
        [x1, y1, z],
        [x1, y1, z1],
        [x0, y1, z1],
        [0, 1, 0],
        color,
        sides,
        lineColor,
      ),
      quad(
        [x1, y0, z],
        [x0, y0, z],
        [x0, y0, z1],
        [x1, y0, z1],
        [0, -1, 0],
        color,
        sides,
        lineColor,
      ),
      quad(
        [x1, y1, z],
        [x1, y0, z],
        [x1, y0, z1],
        [x1, y1, z1],
        [1, 0, 0],
        color,
        sides,
        lineColor,
      ),
      quad(
        [x0, y0, z],
        [x0, y1, z],
        [x0, y1, z1],
        [x0, y0, z1],
        [-1, 0, 0],
        color,
        sides,
        lineColor,
      ),
    ],
  };
}

function prism(
  cx: number,
  cy: number,
  z: number,
  height: number,
  bottom: number,
  top: number,
  sides: number,
  color: string,
  options: {
    top?: string;
    rotation?: number;
    band?: number;
    lineColor?: string;
    topLines?: V3[][];
  } = {},
): SolidPart {
  const ring = (radius: number, level: number) =>
    Array.from({ length: sides }, (_, index): V3 => {
      const angle = ((index + 0.5) / sides) * Math.PI * 2 + (options.rotation ?? 0);
      return [cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius, level];
    });
  const lower = ring(bottom, z);
  const upper = ring(top, z + height);
  const faces: SolidFace[] = lower.map((point, index) => {
    const next = (index + 1) % sides;
    const angle = ((index + 1) / sides) * Math.PI * 2 + (options.rotation ?? 0);
    const normal: V3 = [Math.cos(angle) * height, Math.sin(angle) * height, bottom - top];
    const band = options.band;
    return quad(
      point,
      lower[next]!,
      upper[next]!,
      upper[index]!,
      normal,
      color,
      band === undefined ? undefined : (corner) => [[corner(0, band), corner(1, band)]],
      options.lineColor,
    );
  });
  faces.unshift({
    points: upper,
    normal: [0, 0, 1],
    color: options.top ?? color,
    lines: options.topLines,
    lineColor: options.lineColor,
  });
  return { faces };
}

function sphere(
  cx: number,
  cy: number,
  cz: number,
  radius: number,
  color: string,
  alt = color,
): SolidPart {
  const lat = 6,
    lon = 12;
  const point = (i: number, j: number): V3 => {
    const theta = (i / lat) * Math.PI;
    const phi = (j / lon) * Math.PI * 2;
    return [
      cx + Math.sin(theta) * Math.cos(phi) * radius,
      cy + Math.sin(theta) * Math.sin(phi) * radius,
      cz + Math.cos(theta) * radius,
    ];
  };
  const faces: SolidFace[] = [];
  for (let i = 0; i < lat; i++)
    for (let j = 0; j < lon; j++) {
      const points = [point(i, j), point(i + 1, j), point(i + 1, j + 1), point(i, j + 1)];
      const middle = point(i + 0.5, j + 0.5);
      faces.push({
        points,
        normal: [middle[0] - cx, middle[1] - cy, middle[2] - cz],
        color: i % 2 ? alt : color,
      });
    }
  return { faces };
}

const signedArea = (points: [number, number][]) =>
  points.reduce((sum, [x, y], index) => {
    const [nx, ny] = points[(index + 1) % points.length]!;
    return sum + x * ny - nx * y;
  }, 0) / 2;
const counterClockwise = (points: [number, number][]) =>
  signedArea(points) < 0 ? [...points].reverse() : points;

/** 床に平置きした多角形を押し出す（歯車・菱形など）。 */
function extrude(
  points: [number, number][],
  z: number,
  height: number,
  color: string,
  top = color,
): SolidPart {
  const outline = counterClockwise(points);
  const faces: SolidFace[] = outline.map(([x, y], index) => {
    const [nx, ny] = outline[(index + 1) % outline.length]!;
    return quad(
      [x, y, z],
      [nx, ny, z],
      [nx, ny, z + height],
      [x, y, z + height],
      [ny - y, x - nx, 0],
      color,
    );
  });
  faces.unshift({
    points: outline.map(([x, y]): V3 => [x, y, z + height]),
    normal: [0, 0, 1],
    color: top,
  });
  return { faces };
}

/** 縦の面に描いた多角形を奥行き方向へ押し出す（稲妻・錠前の掛け金・標識など）。 */
function upright(
  points: [number, number][],
  cx: number,
  cy: number,
  z: number,
  thickness: number,
  color: string,
  faceLines?: (front: boolean) => V3[][],
): SolidPart {
  const outline = counterClockwise(points);
  const half = thickness / 2;
  const at = (u: number, v: number, side: number): V3 => [cx + u, cy + side, z + v];
  const faces: SolidFace[] = outline.map(([u, v], index) => {
    const [nu, nv] = outline[(index + 1) % outline.length]!;
    return quad(
      at(u, v, -half),
      at(nu, nv, -half),
      at(nu, nv, half),
      at(u, v, half),
      [nv - v, 0, u - nu],
      mix(color, '#10202c', 0.12),
    );
  });
  faces.push(
    {
      points: outline.map(([u, v]) => at(u, v, half)),
      normal: [0, 1, 0],
      color,
      lines: faceLines?.(true),
      lineColor: '#ffffff',
    },
    {
      points: outline.map(([u, v]) => at(u, v, -half)),
      normal: [0, -1, 0],
      color,
      lines: faceLines?.(false),
      lineColor: '#ffffff',
    },
  );
  return { faces };
}

/** 面の辺から法線を求め、立体の中心に背を向ける向きに揃える。 */
function geometricNormal(points: V3[], center: V3): V3 {
  const [a, b, c] = points;
  const u = b!.map((value, axis) => value - a![axis]!) as unknown as V3;
  const v = c!.map((value, axis) => value - a![axis]!) as unknown as V3;
  const normal: V3 = [
    u[1] * v[2] - u[2] * v[1],
    u[2] * v[0] - u[0] * v[2],
    u[0] * v[1] - u[1] * v[0],
  ];
  const outward = [0, 1, 2].map(
    (axis) => points.reduce((sum, point) => sum + point[axis]!, 0) / points.length - center[axis]!,
  );
  return normal[0] * outward[0]! + normal[1] * outward[1]! + normal[2] * outward[2]! < 0
    ? [-normal[0], -normal[1], -normal[2]]
    : normal;
}

function octahedron(
  cx: number,
  cy: number,
  z: number,
  radius: number,
  height: number,
  colors: Palette,
): SolidPart {
  const middle = z + height / 2;
  const top: V3 = [cx, cy, z + height];
  const bottom: V3 = [cx, cy, z];
  const ring = Array.from({ length: 4 }, (_, index): V3 => {
    const angle = (index / 4) * Math.PI * 2 + Math.PI / 4;
    return [cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius, middle];
  });
  const faces: SolidFace[] = [];
  ring.forEach((point, index) => {
    const next = ring[(index + 1) % 4]!;
    for (const [apex, color] of [
      [top, index % 2 ? colors.alt : colors.main],
      [bottom, index % 2 ? colors.dark : colors.main],
    ] as const) {
      faces.push({
        points: [point, next, apex],
        normal: geometricNormal([point, next, apex], [cx, cy, middle]),
        color,
      });
    }
  });
  return { faces };
}

const circle = (u: number, v: number, radius: number, corner: (u: number, v: number) => V3) =>
  Array.from({ length: 11 }, (_, index) => {
    const angle = (index / 10) * Math.PI * 2;
    return corner(u + Math.cos(angle) * radius, v + Math.sin(angle) * radius * 0.9);
  });
const arrowLines = (from: V3, to: V3): V3[][] => {
  const dx = to[0] - from[0],
    dy = to[1] - from[1];
  const length = Math.hypot(dx, dy) || 1;
  const ux = dx / length,
    uy = dy / length;
  const head = Math.min(6, length * 0.4);
  return [
    [from, to],
    [
      [to[0] - ux * head - uy * head * 0.6, to[1] - uy * head + ux * head * 0.6, to[2]],
      to,
      [to[0] - ux * head + uy * head * 0.6, to[1] - uy * head - ux * head * 0.6, to[2]],
    ],
  ];
};
const gear = (
  cx: number,
  cy: number,
  outer: number,
  inner: number,
  teeth: number,
): [number, number][] =>
  Array.from({ length: teeth * 4 }, (_, index) => {
    const angle = (index / (teeth * 4)) * Math.PI * 2;
    const radius = index % 4 < 2 ? outer : inner;
    return [cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius];
  });

/** 境界の台座。上面は淡く、側面は濃くして入れ子の段差を読みやすくする。 */
export function slabPart(
  footprint: { x: number; y: number; width: number; height: number },
  bottom: number,
  top: number,
  accent: string,
): SolidPart {
  return box(
    footprint.x + footprint.width / 2,
    footprint.y + footprint.height / 2,
    bottom,
    footprint.width,
    footprint.height,
    top - bottom,
    mix(accent, '#ffffff', 0.5),
    { top: mix(accent, '#ffffff', 0.86) },
  );
}

/** 接続の矢じり。終点 tip を頂点とし、direction の向きへ尖らせる。 */
export function arrowCone(
  tip: V3,
  direction: V3,
  length: number,
  radius: number,
  color: string,
): SolidPart {
  const norm = Math.hypot(...direction) || 1;
  const d: V3 = [direction[0] / norm, direction[1] / norm, direction[2] / norm];
  // 向きに垂直な 2 本の基底で底面の円を作る。
  const helper: V3 = Math.abs(d[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1];
  const cross = (a: V3, b: V3): V3 => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
  const u = cross(d, helper);
  const ul = Math.hypot(...u) || 1;
  const e1: V3 = [u[0] / ul, u[1] / ul, u[2] / ul];
  const e2 = cross(d, e1);
  const base: V3 = [tip[0] - d[0] * length, tip[1] - d[1] * length, tip[2] - d[2] * length];
  const sides = 10;
  const ring = Array.from({ length: sides }, (_, index): V3 => {
    const angle = (index / sides) * Math.PI * 2;
    const c = Math.cos(angle) * radius,
      s = Math.sin(angle) * radius;
    return [
      base[0] + e1[0] * c + e2[0] * s,
      base[1] + e1[1] * c + e2[1] * s,
      base[2] + e1[2] * c + e2[2] * s,
    ];
  });
  const faces: SolidFace[] = ring.map((point, index) => {
    const next = ring[(index + 1) % sides]!;
    const middle = [0, 1, 2].map((axis) => (point[axis]! + next[axis]!) / 2 - base[axis]!);
    const slope = radius / length;
    return {
      points: [point, next, tip],
      normal: [
        middle[0]! + d[0] * radius * slope,
        middle[1]! + d[1] * radius * slope,
        middle[2]! + d[2] * radius * slope,
      ],
      color,
    };
  });
  faces.push({
    points: [...ring].reverse(),
    normal: [-d[0], -d[1], -d[2]],
    color: mix(color, '#10202c', 0.25),
  });
  return { faces };
}

/** 集約・合成の菱形。始点 tip から direction の向きへ伸ばす。 */
export function diamondTip(
  tip: V3,
  direction: V3,
  length: number,
  radius: number,
  color: string,
): SolidPart {
  const norm = Math.hypot(...direction) || 1;
  const d: V3 = [direction[0] / norm, direction[1] / norm, direction[2] / norm];
  const middle: V3 = [
    tip[0] + (d[0] * length) / 2,
    tip[1] + (d[1] * length) / 2,
    tip[2] + (d[2] * length) / 2,
  ];
  const end: V3 = [tip[0] + d[0] * length, tip[1] + d[1] * length, tip[2] + d[2] * length];
  const side: V3 = Math.abs(d[2]) > 0.9 ? [1, 0, 0] : [-d[1], d[0], 0];
  const sl = Math.hypot(...side) || 1;
  const across: V3 = [(side[0] / sl) * radius, (side[1] / sl) * radius, (side[2] / sl) * radius];
  const perpendicular: V3 = [
    d[1] * across[2] - d[2] * across[1],
    d[2] * across[0] - d[0] * across[2],
    d[0] * across[1] - d[1] * across[0],
  ];
  const perpendicularLength = Math.hypot(...perpendicular) || 1;
  const up = perpendicular.map(
    (value) => (value / perpendicularLength) * radius * 0.8,
  ) as unknown as V3;
  const ring: V3[] = [
    [middle[0] + across[0], middle[1] + across[1], middle[2] + across[2]],
    [middle[0] + up[0], middle[1] + up[1], middle[2] + up[2]],
    [middle[0] - across[0], middle[1] - across[1], middle[2] - across[2]],
    [middle[0] - up[0], middle[1] - up[1], middle[2] - up[2]],
  ];
  const faces: SolidFace[] = [];
  ring.forEach((point, index) => {
    const next = ring[(index + 1) % 4]!;
    for (const apex of [tip, end]) {
      faces.push({
        points: [point, next, apex],
        normal: geometricNormal([point, next, apex], middle),
        color,
      });
    }
  });
  return { faces };
}

/**
 * 台座の中心 (cx, cy) と床の高さ z に、幅 size の立体アイコンを組み立てる。
 * 部品は下から順に並べ、描画側で奥行き順に並べ替える。
 */
export function buildSolid(
  kind: SolidKind,
  cx: number,
  cy: number,
  z: number,
  size: number,
  color = solidColors[kind],
): Solid {
  const s = size;
  const c = palette(color);
  const pedestal: SolidPart = {
    ...prism(cx, cy, z, 3, s * 0.6, s * 0.56, 8, '#d9e2e6', {
      top: '#eef3f4',
      rotation: Math.PI / 8,
    }),
    ground: true,
  };
  const z1 = z + 3;
  const parts: SolidPart[] = [pedestal];
  const add = (...items: SolidPart[]) => parts.push(...items);
  let height = 0;
  switch (kind) {
    case 'compute': {
      const unit = s * 0.24,
        gap = s * 0.035;
      for (let index = 0; index < 3; index++)
        add(
          box(
            cx,
            cy,
            z1 + index * (unit + gap),
            s * 0.62,
            s * 0.56,
            unit,
            index % 2 ? c.alt : c.main,
            {
              lineColor: c.dark,
              sides: (at) => [
                [at(0.12, 0.5), at(0.58, 0.5)],
                [at(0.76, 0.5), at(0.84, 0.5)],
              ],
            },
          ),
        );
      height = 3 * unit + 2 * gap;
      break;
    }
    case 'container': {
      const h = s * 0.3;
      const ribs: FaceLines = (at) => [0.2, 0.4, 0.6, 0.8].map((u) => [at(u, 0.12), at(u, 0.88)]);
      add(box(cx, cy, z1, s * 0.92, s * 0.44, h, c.main, { sides: ribs, lineColor: c.dark }));
      add(
        box(cx + s * 0.04, cy, z1 + h + 1.5, s * 0.84, s * 0.44, h, c.alt, {
          sides: ribs,
          lineColor: c.dark,
        }),
      );
      height = h * 2 + 1.5;
      break;
    }
    case 'pod':
      add(prism(cx, cy, z1, s * 0.42, s * 0.38, s * 0.38, 6, c.main, { top: c.alt }));
      add(prism(cx, cy, z1 + s * 0.42, s * 0.12, s * 0.24, s * 0.22, 6, c.light));
      height = s * 0.54;
      break;
    case 'function': {
      add(prism(cx, cy, z1, s * 0.06, s * 0.32, s * 0.3, 16, c.dark));
      const w = s * 0.62,
        h = s * 0.82;
      const bolt: [number, number][] = [
        [0.12, 1],
        [-0.34, 0.42],
        [-0.02, 0.42],
        [-0.16, 0],
        [0.34, 0.6],
        [0.02, 0.6],
        [0.24, 1],
      ];
      add(
        upright(
          bolt.map(([u, v]) => [u * w, v * h]),
          cx,
          cy,
          z1 + s * 0.06,
          s * 0.16,
          c.main,
        ),
      );
      height = s * 0.88;
      break;
    }
    case 'database':
    case 'cache': {
      const discs = kind === 'database' ? 3 : 2;
      const h = kind === 'database' ? s * 0.16 : s * 0.15,
        gap = s * 0.04,
        radius = kind === 'database' ? s * 0.34 : s * 0.38;
      for (let index = 0; index < discs; index++)
        add(prism(cx, cy, z1 + index * (h + gap), h, radius, radius, 20, c.main, { top: c.light }));
      height = discs * h + (discs - 1) * gap;
      if (kind === 'cache') {
        add(sphere(cx, cy, z1 + height + s * 0.12, s * 0.13, c.alt, c.main));
        height += s * 0.25;
      }
      break;
    }
    case 'storage':
      add(
        prism(cx, cy, z1, s * 0.5, s * 0.27, s * 0.38, 20, c.main, {
          top: c.dark,
          band: 0.78,
          lineColor: c.light,
        }),
      );
      add(prism(cx, cy, z1 + s * 0.5, s * 0.03, s * 0.4, s * 0.4, 20, c.alt, { top: c.dark }));
      height = s * 0.53;
      break;
    case 'queue': {
      add(
        box(cx, cy, z1, s * 1.04, s * 0.26, s * 0.07, c.dark, {
          topLines: () =>
            arrowLines([cx - s * 0.48, cy, z1 + s * 0.07], [cx + s * 0.5, cy, z1 + s * 0.07]),
          lineColor: '#ffffff',
        }),
      );
      [-0.36, -0.12, 0.12, 0.36].forEach((offset, index) =>
        add(
          box(
            cx + offset * s,
            cy,
            z1 + s * 0.07,
            s * 0.19,
            s * 0.2,
            s * 0.19,
            index % 2 ? c.alt : c.main,
          ),
        ),
      );
      height = s * 0.26;
      break;
    }
    case 'loadBalancer': {
      const h = s * 0.16;
      const top = z1 + h;
      add(
        prism(cx, cy, z1, h, s * 0.44, s * 0.42, 16, c.main, {
          top: c.alt,
          lineColor: '#ffffff',
          topLines: [
            [
              [cx - s * 0.36, cy, top],
              [cx - s * 0.08, cy, top],
            ],
            ...arrowLines([cx, cy, top], [cx + s * 0.3, cy - s * 0.22, top]),
            ...arrowLines([cx, cy, top], [cx + s * 0.36, cy, top]),
            ...arrowLines([cx, cy, top], [cx + s * 0.3, cy + s * 0.22, top]),
          ],
        }),
      );
      add(sphere(cx, cy, top, s * 0.11, c.light, c.alt));
      height = h + s * 0.11;
      break;
    }
    case 'cdn':
      add(prism(cx, cy, z1, s * 0.08, s * 0.22, s * 0.16, 12, c.dark));
      add(sphere(cx, cy, z1 + s * 0.42, s * 0.34, c.main, c.alt));
      height = s * 0.76;
      break;
    case 'gateway':
      add(box(cx - s * 0.27, cy, z1, s * 0.16, s * 0.32, s * 0.5, c.main));
      add(box(cx + s * 0.27, cy, z1, s * 0.16, s * 0.32, s * 0.5, c.main));
      add(box(cx, cy, z1 + s * 0.5, s * 0.72, s * 0.36, s * 0.14, c.alt, { top: c.light }));
      add(box(cx, cy, z1, s * 0.38, s * 0.3, s * 0.02, c.dark));
      height = s * 0.64;
      break;
    case 'router': {
      const h = s * 0.2,
        top = z1 + h;
      add(
        prism(cx, cy, z1, h, s * 0.42, s * 0.4, 16, c.main, {
          top: c.alt,
          lineColor: '#ffffff',
          topLines: [
            ...arrowLines([cx + s * 0.1, cy, top], [cx + s * 0.34, cy, top]),
            ...arrowLines([cx - s * 0.1, cy, top], [cx - s * 0.34, cy, top]),
            ...arrowLines([cx, cy + s * 0.1, top], [cx, cy + s * 0.34, top]),
            ...arrowLines([cx, cy - s * 0.1, top], [cx, cy - s * 0.34, top]),
          ],
        }),
      );
      add(prism(cx, cy, top, s * 0.1, s * 0.09, s * 0.09, 10, c.light));
      height = h + s * 0.1;
      break;
    }
    case 'dns': {
      add(box(cx, cy, z1, s * 0.07, s * 0.07, s * 0.82, c.dark));
      const plate: [number, number][] = [
        [0, 0],
        [0.4, 0],
        [0.5, 0.09],
        [0.4, 0.18],
        [0, 0.18],
      ];
      add(
        upright(
          plate.map(([u, v]) => [u * s - s * 0.04, v * s]),
          cx,
          cy,
          z1 + s * 0.56,
          s * 0.06,
          c.main,
        ),
      );
      add(
        upright(
          plate.map(([u, v]) => [-u * s + s * 0.04, v * s]),
          cx,
          cy,
          z1 + s * 0.3,
          s * 0.06,
          c.alt,
        ),
      );
      height = s * 0.82;
      break;
    }
    case 'firewall': {
      const rowHeight = s * 0.17,
        width = s * 0.9,
        gap = 1.2;
      for (let row = 0; row < 3; row++) {
        const layout = row % 2 ? [0.5, 1, 1, 0.5] : [1, 1, 1];
        const unit = width / 3;
        let x = cx - width / 2;
        layout.forEach((span, index) => {
          const length = unit * span;
          add(
            box(
              x + length / 2,
              cy,
              z1 + row * (rowHeight + gap),
              length - gap,
              s * 0.28,
              rowHeight,
              (index + row) % 2 ? c.alt : c.main,
            ),
          );
          x += length;
        });
      }
      height = 3 * rowHeight + 2 * gap;
      break;
    }
    case 'identity': {
      add(box(cx, cy, z1, s * 0.42, s * 0.22, s * 0.06, c.dark));
      add(
        box(cx, cy, z1 + s * 0.06, s * 0.58, s * 0.07, s * 0.7, c.main, {
          lineColor: '#ffffff',
          sides: (at) => [
            circle(0.28, 0.66, 0.11, at),
            [at(0.12, 0.3), at(0.2, 0.42), at(0.36, 0.42), at(0.44, 0.3)],
            [at(0.56, 0.62), at(0.88, 0.62)],
            [at(0.56, 0.46), at(0.82, 0.46)],
            [at(0.56, 0.3), at(0.86, 0.3)],
          ],
        }),
      );
      height = s * 0.76;
      break;
    }
    case 'secret': {
      const bodyHeight = s * 0.42;
      add(
        box(cx, cy, z1, s * 0.56, s * 0.3, bodyHeight, c.main, {
          top: c.alt,
          lineColor: c.dark,
          sides: (at) => [circle(0.5, 0.6, 0.07, at), [at(0.5, 0.52), at(0.5, 0.28)]],
        }),
      );
      const outer = s * 0.2,
        inner = s * 0.12,
        leg = s * 0.1;
      const arc = (radius: number, reverse: boolean) =>
        Array.from({ length: 9 }, (_, index): [number, number] => {
          const angle = Math.PI * ((reverse ? 8 - index : index) / 8);
          return [-Math.cos(angle) * radius, leg + Math.sin(angle) * radius];
        });
      const shackle: [number, number][] = [
        [-outer, 0],
        ...arc(outer, false),
        [outer, 0],
        [inner, 0],
        ...arc(inner, true),
        [-inner, 0],
      ];
      add(upright(shackle, cx, cy, z1 + bodyHeight, s * 0.09, '#9aa7b2'));
      height = bodyHeight + leg + outer;
      break;
    }
    case 'user':
      add(prism(cx, cy, z1, s * 0.42, s * 0.27, s * 0.18, 16, c.main, { top: c.alt }));
      add(sphere(cx, cy, z1 + s * 0.42 + s * 0.17, s * 0.15, c.light, c.alt));
      height = s * 0.74;
      break;
    case 'cicd': {
      add(
        extrude(
          gear(cx - s * 0.05, cy + s * 0.04, s * 0.38, s * 0.3, 10),
          z1,
          s * 0.13,
          c.main,
          c.alt,
        ),
      );
      add(
        prism(cx + s * 0.13, cy - s * 0.12, z1 + s * 0.13, s * 0.08, s * 0.05, s * 0.05, 8, c.dark),
      );
      add(
        extrude(
          gear(cx + s * 0.13, cy - s * 0.12, s * 0.24, s * 0.18, 8),
          z1 + s * 0.21,
          s * 0.11,
          c.light,
          mix(c.light, '#ffffff', 0.3),
        ),
      );
      height = s * 0.32;
      break;
    }
    case 'repository': {
      const h = s * 0.12;
      [c.dark, c.main, c.alt].forEach((tone, index) =>
        add(
          box(
            cx + (index % 2 ? s * 0.04 : -s * 0.02),
            cy,
            z1 + index * (h + 1),
            s * 0.62,
            s * 0.46,
            h,
            tone,
            {
              top: index === 2 ? c.light : undefined,
              lineColor: c.dark,
              topLines:
                index === 2
                  ? () => {
                      const top = z1 + 2 * (h + 1) + h;
                      return [
                        [
                          [cx - s * 0.12, cy + s * 0.14, top],
                          [cx - s * 0.12, cy - s * 0.14, top],
                        ],
                        [
                          [cx - s * 0.12, cy + s * 0.04, top],
                          [cx + s * 0.12, cy - s * 0.1, top],
                        ],
                      ];
                    }
                  : undefined,
            },
          ),
        ),
      );
      height = 3 * h + 2;
      break;
    }
    case 'monitoring': {
      add(box(cx, cy, z1, s * 0.84, s * 0.42, s * 0.06, c.dark));
      [
        [-0.26, 0.3, c.light],
        [0, 0.5, c.alt],
        [0.26, 0.74, c.main],
      ].forEach(([offset, h, tone]) =>
        add(
          box(
            cx + Number(offset) * s,
            cy,
            z1 + s * 0.06,
            s * 0.18,
            s * 0.26,
            Number(h) * s,
            String(tone),
          ),
        ),
      );
      height = s * 0.8;
      break;
    }
    case 'ai':
      add(prism(cx, cy, z1, s * 0.1, s * 0.24, s * 0.2, 12, c.dark));
      add(octahedron(cx, cy, z1 + s * 0.18, s * 0.3, s * 0.62, c));
      height = s * 0.8;
      break;
    case 'collapsed': {
      const h = s * 0.09;
      [0.84, 0.74, 0.64].forEach((scale, index) =>
        add(
          box(
            cx,
            cy,
            z1 + index * (h + s * 0.03),
            s * scale,
            s * scale * 0.72,
            h,
            index === 2 ? c.alt : c.main,
            {
              top: index === 2 ? c.light : undefined,
              lineColor: c.dark,
              topLines:
                index === 2
                  ? () => {
                      const top = z1 + 2 * (h + s * 0.03) + h;
                      return [
                        [
                          [cx - s * 0.12, cy, top],
                          [cx + s * 0.12, cy, top],
                        ],
                        [
                          [cx, cy - s * 0.12, top],
                          [cx, cy + s * 0.12, top],
                        ],
                      ];
                    }
                  : undefined,
            },
          ),
        ),
      );
      height = 3 * h + 2 * s * 0.03;
      break;
    }
    case 'decision': {
      const r = s * 0.42;
      add(
        extrude(
          [
            [cx, cy - r],
            [cx + r, cy],
            [cx, cy + r],
            [cx - r, cy],
          ],
          z1,
          s * 0.24,
          c.main,
          c.light,
        ),
      );
      height = s * 0.24;
      break;
    }
    case 'terminal':
      add(prism(cx, cy, z1, s * 0.2, s * 0.4, s * 0.38, 24, c.main, { top: c.light }));
      height = s * 0.2;
      break;
    case 'variable':
      add(prism(cx, cy, z1, s * 0.05, s * 0.2, s * 0.18, 12, c.dark));
      add(sphere(cx, cy, z1 + s * 0.35, s * 0.3, c.main, c.alt));
      height = s * 0.65;
      break;
    case 'generic':
      add(box(cx, cy, z1, s * 0.64, s * 0.64, s * 0.38, c.main, { top: c.alt }));
      add(box(cx, cy, z1 + s * 0.38, s * 0.46, s * 0.46, s * 0.08, c.light));
      height = s * 0.46;
      break;
  }
  return { kind, parts, height: height + 3 };
}
