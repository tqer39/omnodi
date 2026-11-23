import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseDSL } from '../src/core/parser.js';
import { buildWalkthrough } from '../src/core/walkthrough.js';

const parse = (source: string) => {
  const result = parseDSL(source);
  assert.deepEqual(result.diagnostics, []);
  return result.diagram!;
};

describe('処理の流れの説明', () => {
  it('route・step を明示した経路を優先し、往路の後に復路、残りの接続を推定順で続ける', () => {
    const diagram = parse(`diagram "経路" {
  external.user user "利用者"
  aws.alb alb "ALB"
  aws.ecs api "API"
  aws.rds db "DB"
  aws.iam role "Role"
  api -> db kind=dependency
  api -> alb route=web step=1 routeDirection=return
  alb -> api route=web step=2 description="ALB が API へ転送します。"
  user -> alb route=web step=1
  alb -> user route=web step=2 routeDirection=return
  role -> api kind=deploy
}`);
    const steps = buildWalkthrough(diagram);
    assert.deepEqual(
      steps.map((step) => `${step.source}->${step.target}:${step.basis}`),
      [
        'user->alb:explicit',
        'alb->api:explicit',
        'api->alb:explicit',
        'alb->user:explicit',
        'api->db:inferred',
        'role->api:inferred',
      ],
    );
    assert.deepEqual(steps[2]!.route, { name: 'web', direction: 'return', step: 1 });
    assert.equal(steps[1]!.description, 'ALB が API へ転送します。');
    assert.equal(steps[0]!.title, '利用者 → ALB');
  });

  it('順序のない図は利用者から通信を辿り、運用の接続を後に並べる', () => {
    const diagram = parse(readFileSync('examples/aws.infra', 'utf8'));
    const steps = buildWalkthrough(diagram);
    assert.equal(steps.length, diagram.connections.length);
    assert.ok(steps.every((step) => step.basis === 'inferred'));
    assert.deepEqual(
      steps.slice(0, 3).map((step) => `${step.source}->${step.target}`),
      ['users->web', 'web->api', 'api->db'],
    );
    const kinds = steps.map((step) => step.kind);
    assert.ok(kinds.lastIndexOf('traffic') < kinds.indexOf('deploy'));
    // 依存は通信の証拠として説明しない。
    const dependency = steps.find((step) => step.kind === 'dependency')!;
    assert.match(dependency.description, /通信の証拠ではありません/);
    assert.match(steps[0]!.description, /HTTPS・443 番/);
  });

  it('未知の種別・循環・監視信号を含んでも各接続を一度ずつ説明する', () => {
    const diagram = parse(`diagram "未知" {
  custom.widget a "部品A"
  custom.widget b "部品B"
  saas.datadog monitor "Datadog"
  a -> b
  b -> a
  a -> monitor signals=[metrics,logs]
}`);
    const steps = buildWalkthrough(diagram);
    assert.deepEqual(
      steps.map((step) => step.connectionId).sort(),
      diagram.connections.map((edge) => edge.id).sort(),
    );
    // 監視信号は通常の通信の後に、送るデータの種類を添えて説明する。
    assert.equal(steps.at(-1)!.target, 'monitor');
    assert.match(steps.at(-1)!.description, /メトリクス・ログ/);
  });

  it('接続のない図では説明のステップを作らない', () => {
    assert.deepEqual(buildWalkthrough(parse('diagram "空" {\n  aws.ec2 a "A"\n}')), []);
  });
});
