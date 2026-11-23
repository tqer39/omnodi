import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { awsIconColors } from '../src/assets/aws-icon-colors.js';
import { boundaryTypes, type LayoutResult, type Resource } from '../src/core/model.js';
import { createProjector, pitchRange } from '../src/viewer/spatial-math.js';
import { buildScene, retargetAirRoute, type SceneRoute } from '../src/viewer/spatial-scene.js';
import { resolveEmblem } from '../src/viewer/spatial-emblems.js';
import { buildOctocat, logoPlaque } from '../src/viewer/spatial-solids.js';

const resource = (id: string, type: string, label = id): Resource => ({
  id,
  type,
  label,
  attributes: {},
});
const icon = (type: string) => `icon:${type}`;

/** icons.ts の型 → 同梱ファイルの対応を、import 文と対応表から読み取る。 */
function bundledIconFiles(): Map<string, string> {
  const source = readFileSync('src/assets/icons.ts', 'utf8');
  const imports = new Map(
    [...source.matchAll(/^import (\w+) from '\.\/([^']+)';$/gm)].map((match) => [
      match[1]!,
      match[2]!,
    ]),
  );
  return new Map(
    [...source.matchAll(/^\s+'([^']+)': (\w+),$/gm)].map((match) => [
      match[1]!,
      imports.get(match[2]!)!,
    ]),
  );
}

describe('AWS 公式アイコンの立体', () => {
  it('同梱した AWS のサービス・リソースアイコンすべての公式色を、元の SVG から写している', () => {
    const files = bundledIconFiles();
    // 境界を表すグループアイコンは立体のロゴにしない。
    const groups = new Set([
      'aws.cloud',
      'aws.account',
      'aws.region',
      'aws.vpc',
      'aws.subnet-public',
      'aws.subnet-private',
    ]);
    const expected = [...files.keys()].filter(
      (type) => type.startsWith('aws.') && !boundaryTypes.has(type) && !groups.has(type),
    );
    assert.deepEqual(Object.keys(awsIconColors).sort(), expected.sort());
    for (const [type, { color, tile }] of Object.entries(awsIconColors)) {
      const svg = readFileSync(`src/assets/${files.get(type)}`, 'utf8');
      // 最初の塗りが公式の背景色（Resource アイコンでは図形の色）。
      assert.equal(/fill="(#[0-9A-Fa-f]{6})"/.exec(svg)?.[1], color, type);
      assert.equal(/<rect\b/.test(svg), tile, type);
    }
  });

  it('型から公式ロゴ・Octocat を選び、名前・境界・未知の型からは推測しない', () => {
    assert.deepEqual(resolveEmblem(resource('api', 'aws.ecs'), 'aws.ecs', false, icon), {
      kind: 'aws-logo',
      href: 'icon:aws.ecs',
      color: '#ED7100',
      tile: true,
    });
    for (const type of ['saas.github', 'github.repository', 'github.actions'])
      assert.deepEqual(resolveEmblem(resource('gh', type), type, false, icon), { kind: 'octocat' });
    // 表示アイコンを GitHub に変えたノードは、型が違っても GitHub として扱う。
    assert.deepEqual(resolveEmblem(resource('x', 'custom.repo'), 'saas.github', false, icon), {
      kind: 'octocat',
    });
    assert.equal(
      resolveEmblem(resource('x', 'external.service', 'GitHub'), 'external.service', false, icon),
      undefined,
    );
    assert.equal(
      resolveEmblem(resource('c', 'aws.ecs-cluster'), 'aws.ecs', false, icon),
      undefined,
    );
    assert.equal(resolveEmblem(resource('api', 'aws.ecs'), 'aws.ecs', true, icon), undefined);
    assert.equal(
      resolveEmblem(resource('w', 'custom.widget'), 'custom.widget', false, icon),
      undefined,
    );
    assert.equal(
      resolveEmblem(resource('api', 'aws.ecs'), 'aws.ecs', false, () => undefined),
      undefined,
    );
  });

  it('ロゴを置く正面は、どの視点でも画面と平行な正方形に投影される', () => {
    for (const yaw of [-170, -32, 0, 45, 135])
      for (const pitch of [pitchRange.min, 36, pitchRange.max]) {
        const projector = createProjector({ yaw, pitch });
        const plaque = logoPlaque(100, 50, 12, 80, '#ED7100', true, { yaw, pitch });
        const [tl, tr, br, bl] = plaque.face.map((point) => projector.project(point));
        const width = tr!.x - tl!.x;
        assert.ok(width > 40, `yaw=${yaw} pitch=${pitch}`);
        assert.ok(Math.abs(tr!.y - tl!.y) < 1e-6);
        assert.ok(Math.abs(bl!.x - tl!.x) < 1e-6);
        assert.ok(Math.abs(bl!.y - tl!.y - width) < 1e-6);
        assert.ok(Math.abs(br!.x - tr!.x) < 1e-6 && Math.abs(br!.y - bl!.y) < 1e-6);
        // 正面・面取り・上の厚みが見え、板は台座より上にある。
        const visible = plaque.parts.at(-1)!.faces.filter((face) => projector.faces(face.normal));
        assert.ok(visible.length >= 4);
        assert.ok(
          Math.min(...plaque.parts.at(-1)!.faces.flatMap((face) => face.points.map((p) => p[2]))) >
            12,
        );
      }
  });
});

it('視点を変えても上空の接続端が AWS ロゴの正面へ入り込まない', () => {
  const baseline = logoPlaque(200, 0, 0, 80, '#ED7100', true, { yaw: -32, pitch: 36 });
  const route: SceneRoute = {
    id: 'deployment',
    source: 'source',
    target: 'target',
    kind: 'deploy',
    tier: 'air',
    telemetry: false,
    ports: [],
    label: [100, 0, 200],
    points: [
      [0, 0, 20],
      [0, 0, 200],
      [200, 0, 200],
      [200, 0, baseline.height + 1],
    ],
  };
  for (const yaw of [-150, -32, 90, 180]) {
    for (const pitch of [pitchRange.min, 36, 60, pitchRange.max]) {
      const orientation = { yaw, pitch };
      const plaque = logoPlaque(200, 0, 0, 80, '#ED7100', true, orientation);
      const adjusted = retargetAirRoute(route, new Map([['target', plaque.height]]));
      const projector = createProjector(orientation);
      const tip = projector.project(adjusted.points.at(-1)!);
      const logoTop = Math.min(...plaque.face.map((point) => projector.project(point).y));
      assert.ok(tip.y <= logoTop, `yaw=${yaw}, pitch=${pitch}: ロゴより上で接続する`);
      assert.ok(adjusted.points[2]![2] > adjusted.points.at(-1)![2]);
    }
  }
  const under = { ...route, tier: 'under' as const };
  assert.equal(retargetAirRoute(under, new Map([['target', 200]])), under);
});

describe('GitHub の Octocat', () => {
  it('猫耳・頭・顔・胴・5本の触手を持ち、回転すると見える面と陰影が変わる', () => {
    const octocat = buildOctocat(0, 0, 0, 80);
    // 台座 + 触手 5 本 × 4 区間 + 胴・頭 + 耳 2 組 + 顔 + 目 2 + 鼻
    assert.equal(octocat.parts.length, 1 + 5 * 4 + 2 + 4 + 1 + 2 + 1);
    const tops = octocat.parts.map((part) =>
      Math.max(...part.faces.flatMap((face) => face.points.map((p) => p[2]))),
    );
    const headTop = tops[1 + 20 + 1]!;
    const earTop = Math.max(tops[1 + 22]!, tops[1 + 24]!);
    assert.ok(earTop > headTop, '耳が頭の上に出る');
    const front = createProjector({ yaw: -32, pitch: 36 });
    const back = createProjector({ yaw: 148, pitch: 36 });
    const center = (index: number) => {
      const points = octocat.parts[index]!.faces.flatMap((item) => item.points);
      return [0, 1, 2].map(
        (axis) => points.reduce((sum, point) => sum + point[axis]!, 0) / points.length,
      ) as unknown as [number, number, number];
    };
    const [faceCenter, headCenter] = [center(1 + 22 + 4), center(1 + 21)];
    // 既定の視点では顔が頭より手前に、反対側からは奥に見える。
    assert.ok(front.project(faceCenter).depth > front.project(headCenter).depth);
    assert.ok(back.project(faceCenter).depth < back.project(headCenter).depth);
    const shade = (projector: typeof front) =>
      octocat.parts[1 + 21]!.faces.map((item) => projector.light(item.normal)).join();
    assert.notEqual(shade(front), shade(back));
  });

  it('選択・ホバー用に触手を上げたポーズを持ち、3D の場面で GitHub の名前を保つ', () => {
    const rest = buildOctocat(0, 0, 0, 80);
    const wave = buildOctocat(0, 0, 0, 80, 'wave');
    // 右手前（4本目）の触手の先端を、顔の高さまで持ち上げる。
    const tip = (solid: typeof rest) => solid.parts[1 + 3 * 4 + 3]!.faces[0]!.points[2]![2];
    assert.ok(tip(wave) > tip(rest) + 40);
    const front = createProjector({ yaw: -32, pitch: 36 });
    const depth = (part: number) => front.project(wave.parts[part]!.faces[0]!.points[2]!).depth;
    assert.ok(depth(1 + 3 * 4 + 3) > depth(1 + 20 + 1), '上げた触手は頭より手前に見える');
    const layout: LayoutResult = {
      nodes: [
        { id: 'repo', x: 0, y: 0, width: 160, height: 80 },
        { id: 'api', x: 300, y: 0, width: 160, height: 80 },
      ],
      durationMs: 0,
      version: 'test',
    };
    const scene = buildScene(
      layout,
      [
        {
          id: 'repo',
          resource: resource('repo', 'github.repository', 'GitHub'),
          collapsed: false,
          emblem: { kind: 'octocat' },
        },
        {
          id: 'api',
          resource: resource('api', 'aws.ecs'),
          collapsed: false,
          emblem: { kind: 'aws-logo', href: 'x', color: '#ED7100', tile: true },
        },
      ],
      [{ id: 'deploy', source: 'repo', target: 'api', kind: 'deploy' }],
    );
    const [repo, api] = scene.solids;
    assert.equal(repo!.resource.label, 'GitHub');
    assert.equal(repo!.kind, 'repository');
    assert.ok(repo!.activeSolid);
    assert.equal(api!.kind, 'container');
    // 上空の経路は立体の上端から出る。
    assert.ok(scene.routes[0]!.points[0]![2] >= repo!.top - 1e-6);
  });
});
