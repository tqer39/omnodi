import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { LayoutResult, Resource } from '../src/core/model.js';
import { createProjector, dedupe, tubePath, type V3 } from '../src/viewer/spatial-math.js';
import { buildScene, tierDepths } from '../src/viewer/spatial-scene.js';
import { buildSolid, diamondTip, solidKind, solidKinds } from '../src/viewer/spatial-solids.js';
import { placeSpatialLabel } from '../src/viewer/spatial-labels.js';
import {
  focusMinZoom,
  initialCamera,
  overviewCamera,
  readableZoom,
} from '../src/viewer/spatial-camera.js';
import { nodeShape } from '../src/core/notation.js';

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

describe('3D の初期表示と全体表示', () => {
  type Bounds = { left: number; right: number; top: number; bottom: number };
  const box = (left: number, top: number, width: number, height: number): Bounds => ({
    left,
    top,
    right: left + width,
    bottom: top + height,
  });
  const onScreen = (camera: ReturnType<typeof initialCamera>, bounds: Bounds) => ({
    left: bounds.left * camera.zoom + camera.x,
    right: bounds.right * camera.zoom + camera.x,
    top: bounds.top * camera.zoom + camera.y,
    bottom: bounds.bottom * camera.zoom + camera.y,
  });
  const laptop = { width: 1100, height: 700 };
  const inside = (shown: Bounds, size: { width: number; height: number }) =>
    shown.left >= 0 && shown.right <= size.width && shown.top >= 0 && shown.bottom <= size.height;

  it('全体が読める大きさで収まる図は、初期表示も全体表示と同じにする', () => {
    const all = box(-300, -200, 700, 450);
    const structure = box(-260, -180, 600, 400);
    assert.deepEqual(initialCamera(all, structure, laptop), overviewCamera(all, laptop));
    assert.ok(overviewCamera(all, laptop).zoom >= readableZoom);
  });

  it('配管や注記で全体が広がっても、境界と名札を読める大きさで収める', () => {
    // 上空の配管と遠い注記で全体は広いが、境界・立体・名札は画面に収まる。
    const all = box(-900, -700, 1900, 1200);
    const structure = box(-400, -250, 1000, 600);
    const overview = overviewCamera(all, laptop);
    const initial = initialCamera(all, structure, laptop);
    assert.ok(overview.zoom < readableZoom);
    assert.ok(initial.zoom >= readableZoom);
    const shown = onScreen(initial, structure);
    assert.ok(shown.left >= 0 && shown.right <= laptop.width);
    assert.ok(shown.top >= 0 && shown.bottom <= laptop.height);
  });

  it('通信経路が構造全体に広がる図で、初期表示を縮小して一部だけ切り取らない', () => {
    const structure = box(0, 0, 1200, 920);
    const all = box(-100, -100, 1400, 1120);
    for (const ends of [
      [box(0, 0, 100, 100), box(1100, 820, 100, 100)],
      [box(40, 40, 100, 100), box(1060, 780, 100, 100)],
    ]) {
      const initial = initialCamera(all, structure, laptop, ends);
      assert.ok(initial.zoom >= focusMinZoom);
      assert.ok(initial.zoom > overviewCamera(all, laptop).zoom);
      assert.ok(inside(onScreen(initial, structure), laptop));
      for (const end of ends) assert.ok(inside(onScreen(initial, end), laptop));
    }
  });

  for (const [name, size] of [
    ['ノート PC', laptop],
    ['デスクトップ', { width: 1440, height: 900 }],
  ] as const)
    it(`${name}では、左上から遠い主要な通信経路を画面の中央に大きく収める`, () => {
      // AWS API の例と同じく、左に見出し、右寄りに ALB・ECS・RDS、さらに遠くに配備経路がある。
      const structure = box(0, 0, 3600, 1800);
      const all = box(-100, -300, 3900, 2300);
      const ends = [box(1400, 560, 220, 300), box(1740, 500, 220, 300), box(2080, 540, 220, 320)];
      const focus = box(1400, 500, 900, 360);
      const initial = initialCamera(all, structure, size, ends);
      assert.ok(initial.zoom > overviewCamera(all, size).zoom);
      const shown = onScreen(initial, focus);
      assert.ok(shown.left >= 0 && shown.right <= size.width);
      assert.ok(shown.top >= 0 && shown.bottom <= size.height);
      const middle = { x: (shown.left + shown.right) / 2, y: (shown.top + shown.bottom) / 2 };
      assert.ok(Math.abs(middle.x - size.width / 2) < 1);
      assert.ok(Math.abs(middle.y - size.height / 2) < 1);
    });

  it('主要な通信経路の端点が広く離れた図でも、文字が潰れない倍率で実際の端点を中央に表示する', () => {
    const structure = box(0, 0, 9000, 5000);
    const all = box(-100, -300, 9300, 5600);
    // 外接矩形 (1000, 1000)〜(6020, 2200) の中央は空白になる。
    const ends = [box(1000, 1000, 220, 140), box(5800, 2060, 220, 140)];
    const initial = initialCamera(all, structure, laptop, ends);
    assert.equal(initial.zoom, focusMinZoom);
    const visible = ends.map((item) => onScreen(initial, item)).filter((s) => inside(s, laptop));
    assert.ok(visible.length >= 1);
    const shown = visible[0]!;
    assert.ok(Math.abs((shown.left + shown.right) / 2 - laptop.width / 2) < 1);
    assert.ok(Math.abs((shown.top + shown.bottom) / 2 - laptop.height / 2) < 1);
  });

  it('端点が3つ以上広く離れた図では、主要部分の中央に最も近い端点を中央に置く', () => {
    const structure = box(0, 0, 9000, 5000);
    const all = box(-100, -300, 9300, 5600);
    const middle = box(3300, 1500, 220, 140);
    const ends = [box(400, 400, 220, 140), middle, box(6400, 2800, 220, 140)];
    const shown = onScreen(initialCamera(all, structure, laptop, ends), middle);
    assert.ok(inside(shown, laptop));
    assert.ok(Math.abs((shown.left + shown.right) / 2 - laptop.width / 2) < 1);
    assert.ok(Math.abs((shown.top + shown.bottom) / 2 - laptop.height / 2) < 1);
  });

  for (const [name, size] of [
    ['大規模図', laptop],
    ['小画面', { width: 360, height: 560 }],
  ] as const) {
    const structure = box(120, -80, 5200, 3400);
    const all = box(60, -260, 5400, 3800);
    it(`通信経路がない${name}では読める倍率を保ち、境界の見出しがある左上を画面に残す`, () => {
      const heading = box(120, -80, 260, 60);
      const items = [heading, box(2600, 1500, 200, 160), box(5000, 3100, 200, 160)];
      const initial = initialCamera(all, structure, size, [], items);
      assert.equal(initial.zoom, readableZoom);
      const shown = onScreen(initial, structure);
      assert.ok(shown.left > 0 && shown.left < size.width * 0.1);
      assert.ok(shown.top > 0 && shown.top < size.height * 0.1);
      assert.ok(inside(onScreen(initial, heading), size));
    });
    it(`通信経路がない${name}で外接矩形の左上が空白でも、左上に最も近い要素を表示する`, () => {
      // 投影した UML などは菱形に広がり、外接矩形の左上には何もない。
      const first = box(120, 1500, 200, 160);
      const items = [box(2600, -80, 240, 160), first, box(5120, 1600, 200, 160)];
      const initial = initialCamera(all, structure, size, [], items);
      assert.equal(initial.zoom, readableZoom);
      assert.ok(inside(onScreen(initial, first), size));
      // 外接矩形の左上の空白は画面の外へ出す。
      assert.ok(onScreen(initial, structure).top < 0);
    });
  }

  it('通信経路がない図で右下の要素が左上に最も近くても、図の端より先の空白へ寄せない', () => {
    const structure = box(0, 0, 3000, 2000);
    const all = box(-60, -60, 3120, 2120);
    const last = box(2800, 1840, 200, 160);
    const initial = initialCamera(all, structure, laptop, [], [last]);
    const shown = onScreen(initial, structure);
    assert.ok(inside(onScreen(initial, last), laptop));
    assert.ok(Math.abs(shown.right - laptop.width * 0.97) < 1);
    assert.ok(Math.abs(shown.bottom - laptop.height * 0.96) < 1);
  });

  for (const [name, size] of [
    ['大規模図', laptop],
    ['小画面', { width: 360, height: 560 }],
  ] as const)
    it(`${name}の全体表示は、縮小してもすべてを収める`, () => {
      const all = box(60, -260, 5400, 3800);
      assert.ok(inside(onScreen(overviewCamera(all, size), all), size));
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
    const expected = 'M 0 0 L 100 10';
    assert.equal(tubePath([start, end], curved), expected);
    assert.equal(tubePath([start, start, end, end], curved), expected);
    assert.equal(tubePath([start, start], curved), '');
    assert.doesNotMatch(expected, /NaN|Infinity/);
  }
});

it('小刻みに往復する配管点でも保持した隣接点を重複させない', () => {
  const points = [0, 10, 10.4, 10.8, 10, 20].map((x) => ({ x, y: 0 }));
  const distinct = dedupe(points);
  assert.ok(
    distinct.every((point, index) => !index || Math.abs(point.x - distinct[index - 1]!.x) > 0.5),
  );
  for (const curved of [false, true]) assert.doesNotMatch(tubePath(points, curved), /NaN|Infinity/);
});

it('Object.prototype と同名の未知の型・アイコンも汎用の立体へ退避する', () => {
  for (const type of ['constructor', 'toString', '__proto__']) {
    assert.equal(nodeShape(resource('unknown', type)), 'rectangle');
    assert.equal(solidKind(resource('unknown', type)), 'generic');
    assert.equal(solidKind(resource('unknown', 'unknown'), type), 'generic');
    const scene = buildScene(
      {
        durationMs: 0,
        version: 'test',
        nodes: [{ id: 'unknown', x: 0, y: 0, width: 80, height: 60 }],
      },
      [
        {
          id: 'unknown',
          resource: resource('unknown', type, { boundary: true }),
          collapsed: false,
        },
      ],
      [],
    );
    assert.equal(typeof scene.slabs[0]!.accent, 'string');
  }
});

it('AI の立体と UML の菱形の法線は三角形の両辺に垂直になる', () => {
  const shapes = [
    buildSolid('ai', 0, 0, 0, 80),
    ...(
      [
        [0, 1, 0],
        [0, 0, 1],
      ] as V3[]
    ).map((direction) => ({ parts: [diamondTip([0, 0, 0], direction, 14, 5, '#abcdef')] })),
  ];
  for (const shape of shapes)
    for (const part of shape.parts) {
      const vertices = part.faces.flatMap((face) => face.points);
      const center = [0, 1, 2].map(
        (axis) => vertices.reduce((sum, point) => sum + point[axis]!, 0) / vertices.length,
      );
      for (const face of part.faces) {
        if (face.points.length !== 3) continue;
        const [a, b, c] = face.points;
        for (const point of [b!, c!]) {
          const dot = face.normal.reduce(
            (sum, value, axis) => sum + value * (point[axis]! - a![axis]!),
            0,
          );
          assert.ok(Math.abs(dot) < 1e-6);
        }
        assert.ok(Math.hypot(...face.normal) > 0);
        const outward = face.points[0]!.map(
          (_, axis) =>
            face.points.reduce((sum, point) => sum + point[axis]!, 0) / face.points.length -
            center[axis]!,
        );
        assert.ok(face.normal.reduce((sum, value, axis) => sum + value * outward[axis]!, 0) > 0);
      }
    }
});

it('大量の並行経路でも床下・床面・上空の高さの区別を保つ', () => {
  const layout: LayoutResult = {
    durationMs: 0,
    version: 'test',
    nodes: [
      { id: 'a', x: 0, y: 0, width: 80, height: 60 },
      { id: 'b', x: 400, y: 0, width: 80, height: 60 },
    ],
  };
  for (const parallelOffset of [-6400, 0, 6400]) {
    const scene = buildScene(
      layout,
      ['a', 'b'].map((id) => ({ id, resource: resource(id, 'aws.ec2'), collapsed: false })),
      [
        {
          id: 'under',
          source: 'a',
          target: 'b',
          kind: 'traffic',
          signals: ['metrics'],
          parallelOffset,
        },
        { id: 'surface', source: 'a', target: 'b', kind: 'association', parallelOffset },
        { id: 'air', source: 'a', target: 'b', kind: 'dependency', parallelOffset },
      ],
    );
    assert.ok(scene.routes.find((route) => route.id === 'under')!.label[2] < 0);
    assert.ok(
      scene.routes.find((route) => route.id === 'surface')!.points.every((point) => point[2] >= 0),
    );
    assert.ok(
      scene.routes.find((route) => route.id === 'air')!.label[2] >=
        Math.max(...scene.solids.map((solid) => solid.top)),
    );
    if (!parallelOffset)
      assert.equal(
        scene.routes.find((route) => route.id === 'under')!.label[2],
        tierDepths.telemetry,
      );
  }
});

it('並行する同種の接続は束全体をずらしても線間の距離を保つ', () => {
  const layout: LayoutResult = {
    durationMs: 0,
    version: 'test',
    nodes: [
      { id: 'a', x: 0, y: 0, width: 80, height: 60 },
      { id: 'b', x: 400, y: 0, width: 80, height: 60 },
    ],
  };
  for (const kind of ['traffic', 'association', 'dependency'] as const) {
    const scene = buildScene(
      layout,
      ['a', 'b'].map((id) => ({ id, resource: resource(id, 'aws.ec2'), collapsed: false })),
      Array.from({ length: 9 }, (_, i) => ({
        id: String(i),
        source: 'a',
        target: 'b',
        kind,
        parallelOffset: (i - 4) * 64,
      })),
    );
    assert.equal(new Set(scene.routes.map((route) => route.label[2])).size, 9);
    const levels = scene.routes.map((route) => route.label[2]).sort((a, b) => a - b);
    const spacing = { traffic: 6, association: 3, dependency: 14 }[kind];
    assert.ok(levels.every((level, index) => !index || level - levels[index - 1]! >= spacing));
  }
});

it('3D の経路も最後に保持した点から小刻みな往復を除く', () => {
  const layout: LayoutResult = {
    durationMs: 0,
    version: 'test',
    nodes: [
      { id: 'a', x: 0, y: 0, width: 80, height: 60 },
      { id: 'b', x: 400, y: 0, width: 80, height: 60 },
    ],
    edges: [{ id: 'edge', points: [0, 10, 10.4, 10.8, 10, 20, 400].map((x) => ({ x, y: 30 })) }],
  };
  const scene = buildScene(
    layout,
    ['a', 'b'].map((id) => ({ id, resource: resource(id, 'aws.ec2'), collapsed: false })),
    [{ id: 'edge', source: 'a', target: 'b', kind: 'association' }],
  );
  const points = scene.routes[0]!.points;
  assert.ok(
    points.every(
      (point, index) =>
        !index ||
        Math.hypot(...point.map((value, axis) => value - points[index - 1]![axis]!)) > 0.5,
    ),
  );
});

it('異なる階の床面接続は両端の床へ降り、同じ階では水平を保つ', () => {
  const layout: LayoutResult = {
    durationMs: 0,
    version: 'test',
    nodes: [
      { id: 'group', x: 300, y: 0, width: 300, height: 200 },
      { id: 'a', x: 0, y: 0, width: 80, height: 60 },
      { id: 'b', x: 30, y: 40, width: 80, height: 60, parentId: 'group' },
    ],
  };
  const scene = buildScene(
    layout,
    [
      { id: 'group', resource: resource('group', 'group'), collapsed: false },
      { id: 'a', resource: resource('a', 'generic'), collapsed: false },
      { id: 'b', resource: resource('b', 'generic'), collapsed: false },
    ],
    [
      { id: 'cross', source: 'a', target: 'b', kind: 'association' },
      { id: 'same', source: 'a', target: 'a', kind: 'association' },
    ],
  );
  const cross = scene.routes.find((route) => route.id === 'cross')!;
  assert.equal(cross.points[0]![2], scene.solids.find((solid) => solid.id === 'a')!.base + 5);
  assert.equal(cross.points.at(-1)![2], scene.solids.find((solid) => solid.id === 'b')!.base + 5);
  assert.equal(
    new Set(scene.routes.find((route) => route.id === 'same')!.points.map((point) => point[2]))
      .size,
    1,
  );
});
