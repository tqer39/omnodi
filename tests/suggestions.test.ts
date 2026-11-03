import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDSL } from '../src/core/parser.js';
import { serializeDSL } from '../src/core/serialize.js';
import { addSuggestedResource, suggestResources } from '../src/core/suggestions.js';

const source = `diagram "候補" version=1 {
  vpc network "VPC" {
    subnet private_subnet "publicという名前" { aws.ec2 aws_ec2_1 "既存" }
    subnet second "別AZ" az="ap-northeast-1c"
  }
}`;
test('Subnet の候補は配置と関連付けを区別し、名前で公開設定を付けない', () => {
  const diagram = parseDSL(source).diagram!;
  const suggestions = suggestResources(diagram, 'private_subnet');
  assert.deepEqual(
    suggestions.map((item) => item.type),
    ['aws.ec2', 'aws.alb', 'aws.rds'],
  );
  assert.equal(suggestions[0]!.parentId, 'private_subnet');
  assert.equal(suggestions[1]!.parentId, 'network');
  assert.deepEqual(suggestions[1]!.attributes, { subnets: ['private_subnet'] });
  assert.match(suggestions[1]!.note!, /2つ以上/);
  assert.ok(suggestions.every((item) => item.attributes.public === undefined));
  assert.deepEqual(
    suggestResources(diagram, 'network').map((item) => item.type),
    ['subnet', 'sg', 'aws.alb', 'aws.rds'],
  );
});
test('一意な ID・DSL 往復・既存の根拠・無関係な接続を保持する', () => {
  const diagram = parseDSL(source).diagram!;
  diagram.resources[0]!.provenance = { kind: 'plan', address: 'aws_vpc.main' };
  const before = structuredClone(diagram);
  const next = addSuggestedResource(diagram, 'private_subnet', 'aws.ec2');
  assert.deepEqual(diagram, before);
  assert.equal(next.resources.at(-1)!.id, 'aws_ec2_2');
  assert.deepEqual(next.resources.at(-1)!.provenance, { kind: 'design' });
  assert.deepEqual(next.resources[0]!.provenance, diagram.resources[0]!.provenance);
  assert.deepEqual(next.connections, diagram.connections);
  const alb = addSuggestedResource(next, 'private_subnet', 'aws.alb');
  const roundtrip = parseDSL(serializeDSL(alb)).diagram!;
  assert.equal(roundtrip.resources.at(-1)!.parentId, 'network');
  assert.deepEqual(roundtrip.resources.at(-1)!.attributes.subnets, ['private_subnet']);
  assert.deepEqual(roundtrip.resources.at(-1)!.unresolved, alb.resources.at(-1)!.unresolved);
  assert.throws(() => addSuggestedResource(diagram, 'private_subnet', 'aws.s3'));
});
test('不明なクラウド・別クラウド・未対応種別には AWS 候補を出さない', () => {
  for (const body of [
    'subnet subnet1 "AWS public"',
    'project google "Google" { subnet subnet1 "AWS" }',
    'vpc v "VPC" { subnet subnet1 "AWS" provider=azurerm }',
    'aws.unknown subnet1 "未対応"',
  ])
    assert.deepEqual(
      suggestResources(parseDSL(`diagram "test" version=1 { ${body} }`).diagram!, 'subnet1'),
      [],
    );
  const diagram = parseDSL('diagram "test" version=1 { subnet s "Subnet" provider=aws }').diagram!;
  assert.deepEqual(
    suggestResources(diagram, 's').map((item) => item.type),
    ['aws.ec2'],
  );
  assert.deepEqual(suggestResources(diagram, 'missing'), []);
});

test('EC2 → S3 → Lambda → DynamoDB を続けて追加し、配置と接続種別を保持する', () => {
  let diagram = parseDSL(`diagram "連続" version=1 {
    account a "AWS" provider=aws { region r "東京" { vpc v "VPC" { subnet s "Subnet" } } }
  }`).diagram!;
  let selected = 's';
  const expected = [
    ['aws.ec2', 's'],
    ['aws.s3', 'r'],
    ['aws.lambda', 'r'],
    ['aws.dynamodb', 'r'],
  ];
  for (const [type, parentId] of expected) {
    diagram = addSuggestedResource(diagram, selected, type!);
    const added = diagram.resources.at(-1)!;
    assert.equal(added.parentId, parentId);
    assert.ok(suggestResources(diagram, added.id).length > 0);
    selected = added.id;
  }
  assert.deepEqual(
    diagram.connections.map((edge) => [edge.source, edge.target, edge.kind]),
    [
      ['aws_ec2_1', 'aws_s3_1', 'traffic'],
      ['aws_s3_1', 'aws_lambda_1', 'association'],
      ['aws_lambda_1', 'aws_dynamodb_1', 'traffic'],
    ],
  );
  assert.ok(diagram.connections.every((edge) => edge.attributes.evidence === 'design'));
  const restored = parseDSL(serializeDSL(diagram)).diagram!;
  assert.equal(restored.connections.length, 3);
  assert.deepEqual(
    restored.resources.map((r) => r.parentId),
    diagram.resources.map((r) => r.parentId),
  );
});

test('ECS と EKS の論理階層からサービス連携へ進める', () => {
  for (const types of [
    ['aws.ecs-cluster', 'aws.ecs-service', 'aws.ecs-task', 'aws.ecs-container', 'aws.s3'],
    ['aws.eks', 'aws.eks-node-group', 'aws.ec2', 'aws.s3'],
  ]) {
    let diagram = parseDSL(
      'diagram "コンテナ" version=1 { account a "AWS" provider=aws }',
    ).diagram!;
    let selected = 'a';
    for (const type of ['region', ...types]) {
      diagram = addSuggestedResource(diagram, selected, type);
      const added = diagram.resources.at(-1)!;
      assert.equal(added.parentId, type === 'aws.s3' ? 'region_1' : selected);
      selected = added.id;
    }
    assert.equal(diagram.connections.length, 1);
    assert.ok(parseDSL(serializeDSL(diagram)).diagram);
  }
});

test('逆方向のDBアクセス・SG関連と配置未確定を誤った親子や通信にしない', () => {
  const diagram = parseDSL(`diagram "配置" version=1 {
    vpc v "VPC" {
      aws.rds db "DB"
      sg security "SG"
      aws.alb lb "ALB"
    }
  }`).diagram!;
  const databaseClient = addSuggestedResource(diagram, 'db', 'aws.lambda');
  assert.equal(databaseClient.resources.at(-1)!.parentId, undefined);
  assert.equal(databaseClient.connections[0]!.source, 'aws_lambda_1');
  assert.equal(databaseClient.connections[0]!.target, 'db');
  const instance = addSuggestedResource(diagram, 'security', 'aws.ec2');
  assert.equal(instance.resources.at(-1)!.parentId, 'v');
  assert.deepEqual(instance.resources.at(-1)!.attributes.securityGroups, ['security']);
  assert.match(instance.resources.at(-1)!.unresolved![0]!, /Subnet/);
  assert.equal(instance.connections.length, 0);
  const target = addSuggestedResource(diagram, 'lb', 'aws.ec2');
  assert.equal(target.resources.at(-1)!.parentId, 'v');
  assert.match(target.resources.at(-1)!.unresolved![0]!, /Subnet/);
});

test('別アカウントや別VPCを探索して勝手に配置先へ選ばず、ID衝突も回避する', () => {
  const diagram = parseDSL(`diagram "分離" version=1 {
    account other "別AWS" provider=aws { region unrelated "別Region" { vpc v "別VPC" } }
    aws.lambda original "Lambda"
    aws.s3 suggested_connection_1 "既存"
    original -> suggested_connection_1 id=suggested_connection_2 kind=association
  }`).diagram!;
  const before = structuredClone(diagram);
  const next = addSuggestedResource(diagram, 'original', 'aws.s3');
  assert.equal(next.resources.at(-1)!.parentId, undefined);
  assert.equal(next.connections.at(-1)!.id, 'suggested_connection_3');
  assert.deepEqual(diagram, before);
  assert.ok(!suggestResources(diagram, 'original').some((item) => item.type === 'aws.rds'));
});
