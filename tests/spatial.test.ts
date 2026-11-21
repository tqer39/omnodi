import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { LayoutResult, Resource } from '../src/core/model.js';
import { createProjector, tubePath } from '../src/viewer/spatial-math.js';
import { buildScene, tierDepths } from '../src/viewer/spatial-scene.js';
import { buildSolid, solidKind, solidKinds } from '../src/viewer/spatial-solids.js';
import { placeSpatialLabel } from '../src/viewer/spatial-labels.js';

const resource = (id: string, type: string, attributes: Resource['attributes'] = {}): Resource => ({
  id,
  type,
  label: id,
  attributes,
});

describe('3D の投影', () => {
  it('高い点ほど画面の上に見え、手前として奥行き順で後に描く', () => {
    const projector = createProjector({ yaw: -32, pitch: 36 });
    const ground = projector.project([100, 50, 0]);
    const raised = projector.project([100, 50, 40]);
    assert.ok(raised.y < ground.y);
    assert.ok(raised.depth > ground.depth);
  });
  it('上面は見え、底面は背面として描かない', () => {
    const projector = createProjector({ yaw: 70, pitch: 30 });
    assert.equal(projector.faces([0, 0, 1]), true);
    assert.equal(projector.faces([0, 0, -1]), false);
  });
  it('回転しても上面が側面より明るい', () => {
    for (const yaw of [-150, -32, 45, 120]) {
      const projector = createProjector({ yaw, pitch: 36 });
      const side = Math.max(
        ...(
          [
            [1, 0, 0],
            [-1, 0, 0],
            [0, 1, 0],
            [0, -1, 0],
          ] as const
        ).map((normal) => projector.light(normal)),
      );
      assert.ok(projector.light([0, 0, 1]) > side);
    }
  });
  it('配管は直角のときは角を丸め、曲線のときは滑らかな曲線にする', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 80 },
    ];
    assert.match(tubePath(points, false), / Q /);
    assert.doesNotMatch(tubePath(points, false), / C /);
    assert.match(tubePath(points, true), / C /);
  });
});

describe('立体アイコンの種別', () => {
  it('役割ごとに異なる立体を選ぶ', () => {
    const expected: [string, string][] = [
      ['aws.ec2', 'compute'],
      ['azure.vm', 'compute'],
      ['aws.ecs', 'container'],
      ['gcp.cloud_run', 'container'],
      ['k8s.pod', 'pod'],
      ['aws.lambda', 'function'],
      ['aws.rds', 'database'],
      ['saas.postgresql', 'database'],
      ['aws.elasticache', 'cache'],
      ['aws.s3', 'storage'],
      ['gcp.pubsub', 'queue'],
      ['aws.alb', 'loadBalancer'],
      ['k8s.service', 'loadBalancer'],
      ['aws.cloudfront', 'cdn'],
      ['aws.nat', 'gateway'],
      ['aws.transit-gateway', 'router'],
      ['aws.route53', 'dns'],
      ['aws.waf', 'firewall'],
      ['k8s.network-policy', 'firewall'],
      ['aws.iam', 'identity'],
      ['gcp.service-account', 'identity'],
      ['k8s.service-account', 'identity'],
      ['azure.key-vault', 'secret'],
      ['external.user', 'user'],
      ['github.actions', 'cicd'],
      ['gitlab.ci', 'cicd'],
      ['github.repository', 'repository'],
      ['saas.datadog', 'monitoring'],
      ['saas.claude', 'ai'],
    ];
    for (const [type, kind] of expected) assert.equal(solidKind(resource(type, type)), kind, type);
  });
  it('未知の型や UML は落とさず汎用の立体にし、偶然の部分一致で誤分類しない', () => {
    assert.equal(solidKind(resource('x', 'custom.terminator')), 'generic');
    assert.equal(solidKind(resource('x', 'uml.class')), 'generic');
    assert.equal(solidKind(resource('x', 'external.service')), 'generic');
  });
  it('明示した見た目・記法・アイコン種別を形に反映する', () => {
    assert.equal(solidKind(resource('x', 'custom.store', { appearance: 'database' })), 'database');
    assert.equal(solidKind(resource('x', 'flow.decision')), 'decision');
    assert.equal(solidKind(resource('x', 'causal.variable')), 'variable');
    assert.equal(solidKind(resource('x', 'custom.thing'), 'aws.s3'), 'storage');
  });
  it('折りたたんだ境界は内容を持つ積層の立体にする', () => {
    assert.equal(solidKind(resource('x', 'vpc'), 'aws.vpc', true), 'collapsed');
  });
  it('すべての種別が高さを持ち、互いに異なる形になる', () => {
    const signatures = new Map<string, string>();
    for (const kind of solidKinds) {
      const solid = buildSolid(kind, 0, 0, 0, 60);
      assert.ok(solid.height > 3, kind);
      const faces = solid.parts.map((part) => part.faces.length).join(',');
      const signature = `${faces}:${Math.round(solid.height)}`;
      assert.equal(
        signatures.get(signature),
        undefined,
        `${kind} と ${signatures.get(signature)} が同じ形`,
      );
      signatures.set(signature, kind);
    }
  });
});

describe('3D シーン', () => {
  const layout: LayoutResult = {
    durationMs: 0,
    version: 'test',
    nodes: [
      { id: 'account', x: 0, y: 0, width: 900, height: 500, contentTop: 56 },
      { id: 'vpc', x: 24, y: 60, width: 600, height: 400, parentId: 'account', contentTop: 56 },
      { id: 'web', x: 40, y: 80, width: 220, height: 80, parentId: 'vpc' },
      { id: 'db', x: 340, y: 80, width: 220, height: 80, parentId: 'vpc' },
      { id: 'ci', x: 680, y: 140, width: 180, height: 80, parentId: 'account' },
      { id: 'logs', x: 680, y: 300, width: 180, height: 80, parentId: 'account' },
    ],
    edges: [
      {
        id: 'traffic',
        points: [
          { x: 284, y: 180 },
          { x: 364, y: 180 },
        ],
      },
      {
        id: 'telemetry',
        points: [
          { x: 284, y: 200 },
          { x: 700, y: 340 },
        ],
      },
      {
        id: 'auth',
        points: [
          { x: 680, y: 180 },
          { x: 284, y: 170 },
        ],
      },
      {
        id: 'deploy',
        points: [
          { x: 680, y: 190 },
          { x: 284, y: 175 },
        ],
      },
      {
        id: 'flow',
        points: [
          { x: 770, y: 220 },
          { x: 770, y: 300 },
        ],
      },
    ],
  };
  const nodes = [
    { id: 'account', resource: resource('account', 'account'), collapsed: false },
    { id: 'vpc', resource: resource('vpc', 'vpc'), collapsed: false },
    { id: 'web', resource: resource('web', 'aws.ecs'), collapsed: false },
    { id: 'db', resource: resource('db', 'aws.rds'), collapsed: false },
    { id: 'ci', resource: resource('ci', 'github.actions'), collapsed: false },
    { id: 'logs', resource: resource('logs', 'saas.datadog'), collapsed: false },
  ];
  const scene = buildScene(layout, nodes, [
    { id: 'traffic', source: 'web', target: 'db', kind: 'traffic' },
    { id: 'telemetry', source: 'web', target: 'logs', kind: 'traffic', signals: ['metrics'] },
    { id: 'auth', source: 'ci', target: 'web', kind: 'auth' },
    { id: 'deploy', source: 'ci', target: 'web', kind: 'deploy' },
    { id: 'flow', source: 'ci', target: 'logs', kind: 'association' },
  ]);
  const route = (id: string) => scene.routes.find((item) => item.id === id)!;
  const solid = (id: string) => scene.solids.find((item) => item.id === id)!;
  const heights = (id: string) => route(id).points.map((point) => point[2]);

  it('境界を入れ子の順に積み、子の立体を親の上面に載せる', () => {
    const account = scene.slabs.find((slab) => slab.id === 'account')!;
    const vpc = scene.slabs.find((slab) => slab.id === 'vpc')!;
    assert.equal(vpc.bottom, account.top);
    assert.ok(vpc.top > account.top);
    assert.equal(solid('web').base, vpc.top);
    assert.equal(solid('ci').base, account.top);
    assert.equal(solid('web').kind, 'container');
  });
  it('通信は床より下を通り、両端で立体の脇へ立ち上がる', () => {
    const z = heights('traffic');
    assert.equal(Math.min(...z), tierDepths.traffic);
    assert.ok(z[0]! > solid('web').base && z.at(-1)! > solid('db').base);
    assert.equal(route('traffic').ports.length, 2);
  });
  it('監視信号は通常の通信と別の床下レーンを通る', () => {
    assert.equal(route('telemetry').telemetry, true);
    assert.equal(Math.min(...heights('telemetry')), tierDepths.telemetry);
    assert.notEqual(tierDepths.telemetry, tierDepths.traffic);
  });
  it('認証とデプロイは立体より上空を通り、接続先の上面へ降りて影を落とす', () => {
    const tops = Math.max(solid('ci').top, solid('web').top);
    assert.ok(Math.max(...heights('auth')) > tops);
    assert.ok(Math.max(...heights('deploy')) > Math.max(...heights('auth')));
    const last = route('auth').points.at(-1)!;
    assert.deepEqual([last[0], last[1]], [solid('web').center.x, solid('web').center.y]);
    assert.ok(last[2] > solid('web').top);
    assert.ok(route('auth').shadow!.every((point) => point[2] < solid('web').top));
  });
  it('関連は床面に沿って通る', () => {
    const z = heights('flow');
    assert.ok(Math.min(...z) > solid('ci').base);
    assert.ok(Math.max(...z) < solid('ci').top);
  });
});

describe('3D のラベル配置', () => {
  it('既存のラベルと重ねず、元の位置の近くに置く', () => {
    const occupied = [{ x: 0, y: 0, width: 100, height: 40 }];
    const placed = placeSpatialLabel({ x: 10, y: 10, width: 80, height: 24 }, occupied);
    const other = occupied[0]!;
    const overlaps =
      placed.x < other.x + other.width &&
      placed.x + placed.width > other.x &&
      placed.y < other.y + other.height &&
      placed.y + placed.height > other.y;
    assert.equal(overlaps, false);
    assert.ok(Math.hypot(placed.x - 10, placed.y - 10) < 120);
    assert.equal(occupied.length, 2);
  });
});

it('経路が欠けても存在する端点から 3D 接続を表示する', () => {
  const layout: LayoutResult = {
    durationMs: 0,
    version: 'test',
    nodes: [
      { id: 'a', x: 0, y: 0, width: 180, height: 90 },
      { id: 'b', x: 400, y: 0, width: 180, height: 90 },
    ],
  };
  const scene = buildScene(
    layout,
    ['a', 'b'].map((id) => ({
      id,
      resource: resource(id, 'aws.ec2'),
      collapsed: false,
    })),
    [{ id: 'edge', source: 'a', target: 'b', kind: 'traffic' }],
  );
  assert.equal(scene.routes.length, 1);
  assert.equal(scene.routes[0]!.id, 'edge');
  assert.ok(scene.routes[0]!.points.some((point) => point[2] < 0));
});

it('8段を超える境界も親子の階層番号と高さを保つ', () => {
  const nodes = Array.from({ length: 10 }, (_, index) => ({
    id: String(index),
    x: 24,
    y: 60,
    width: 2000 - index * 100,
    height: 2000 - index * 100,
    ...(index ? { parentId: String(index - 1) } : {}),
  }));
  const scene = buildScene(
    { nodes, durationMs: 0, version: 'test' },
    nodes.map((node) => ({
      id: node.id,
      resource: resource(node.id, 'group'),
      collapsed: false,
    })),
    [],
  );
  assert.deepEqual(
    scene.slabs.map((slab) => slab.level),
    nodes.map((_, index) => index),
  );
  for (let index = 1; index < scene.slabs.length; index++) {
    assert.equal(scene.slabs[index]!.bottom, scene.slabs[index - 1]!.top);
  }
});

it('近いラベル候補が埋まっていても重ならない位置へ退避する', () => {
  const occupied = [{ x: -1000, y: -1000, width: 2000, height: 2000 }];
  const box = placeSpatialLabel({ x: 0, y: 0, width: 100, height: 40 }, occupied);
  assert.ok(box.y + box.height <= -1000 || box.y >= 1000);
  assert.equal(occupied.length, 2);
});

it('2点と重複点の配管パスに不正座標を出さない', () => {
  for (const curved of [false, true]) {
    const start = { x: 0, y: 0 };
    const end = { x: 100, y: 10 };
    const expected = tubePath([start, end], curved);
    assert.equal(tubePath([start, start, end, end], curved), expected);
    assert.equal(tubePath([start, start], curved), '');
    assert.doesNotMatch(expected, /NaN|Infinity/);
  }
});
