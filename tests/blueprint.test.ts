import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  blueprintClouds,
  blueprintDeliveries,
  blueprintPurposes,
  blueprintRegions,
  blueprintRuntimes,
  generateBlueprint,
  runtimeOptions,
  type BlueprintAnswers,
} from '../src/core/blueprint.js';
import type { Diagram } from '../src/core/model.js';
import { parseDSL } from '../src/core/parser.js';
import { serializeDSL } from '../src/core/serialize.js';
import { buildWalkthrough } from '../src/core/walkthrough.js';

const base: BlueprintAnswers = {
  purpose: 'api',
  cloud: 'aws',
  region: 'primary',
  runtime: 'managed',
  storage: ['sql'],
  delivery: 'none',
};
const byType = (diagram: Diagram, type: string) =>
  diagram.resources.filter((resource) => resource.type === type);
const route = (diagram: Diagram, name: string) =>
  diagram.connections
    .filter((edge) => edge.attributes.route === name)
    .sort((a, b) => Number(a.attributes.step) - Number(b.attributes.step))
    .map((edge) => `${edge.source}->${edge.target}`);
const withoutLocations = (diagram: Diagram) => ({
  ...diagram,
  resources: diagram.resources.map(({ location: _location, ...resource }) => resource),
  connections: diagram.connections.map(({ location: _location, ...edge }) => edge),
});

describe('質問への回答から作る設計雛形', () => {
  it('AWS・API・東京だけ・SQL 保存で、1リージョンの利用者・入口・実行・保存先を順に結ぶ', () => {
    const { diagram, source, unresolved } = generateBlueprint(base);
    const regions = byType(diagram, 'region');
    assert.deepEqual(
      regions.map((region) => region.attributes.region),
      ['ap-northeast-1'],
    );
    assert.equal(byType(diagram, 'external.user').length, 1);
    assert.equal(byType(diagram, 'aws.alb').length, 1);
    assert.equal(byType(diagram, 'aws.ecs').length, 1);
    assert.equal(byType(diagram, 'aws.rds').length, 1);
    assert.deepEqual(route(diagram, 'request'), ['users->entry', 'entry->app', 'app->database']);
    // ALB は Public、実行環境と DB は Private の Subnet に関連付ける。
    const subnets = (id: string) =>
      (
        diagram.resources.find((resource) => resource.id === id)!.attributes.subnets as string[]
      ).map(
        (subnet) =>
          diagram.resources.find((resource) => resource.id === subnet)!.attributes.subnetType,
      );
    assert.deepEqual(subnets('entry'), ['public', 'public']);
    assert.deepEqual(subnets('app'), ['private', 'private']);
    assert.deepEqual(subnets('database'), ['private', 'private']);
    // 実在のアカウント ID は推測せず、構築済み・検証済みとも扱わない。
    assert.equal(
      diagram.resources.find((resource) => resource.id === 'workload')!.attributes.account,
      undefined,
    );
    assert.ok(unresolved.some((item) => item.includes('アカウント ID は未指定')));
    assert.ok(unresolved.some((item) => item.includes('外向き経路は未設計')));
    assert.match(
      String(
        diagram.resources.find((resource) => resource.type === 'note')!.attributes.description,
      ),
      /構築済みではなく.*未検証/,
    );
    assert.match(source, /^diagram "API サーバー（AWS・東京）の設計雛形"/);
  });

  it('DSL へ書き出して読み直しても同じモデルになり、同じ回答からは同じ DSL を返す', () => {
    for (const answers of [
      base,
      {
        ...base,
        region: 'both' as const,
        storage: ['sql' as const, 'object' as const],
        delivery: 'github' as const,
      },
      { ...base, purpose: 'web' as const, cloud: 'gcp' as const },
      {
        ...base,
        purpose: 'worker' as const,
        cloud: 'azure' as const,
        runtime: 'function' as const,
      },
    ]) {
      const blueprint = generateBlueprint(answers);
      const parsed = parseDSL(blueprint.source);
      assert.deepEqual(parsed.diagnostics, []);
      assert.equal(serializeDSL(parsed.diagram!), blueprint.source);
      assert.deepEqual(withoutLocations(parsed.diagram!), withoutLocations(blueprint.diagram));
      assert.equal(generateBlueprint(answers).source, blueprint.source);
    }
  });

  it('保存方式によって保存先の種類と処理の終点が変わる', () => {
    const object = generateBlueprint({ ...base, storage: ['object'] }).diagram;
    assert.equal(byType(object, 'aws.rds').length, 0);
    assert.deepEqual(route(object, 'request').at(-1), 'app->files');
    assert.equal(byType(object, 'aws.s3').length, 1);
    // SQL も VPC も不要な Lambda は、リージョンに置いて VPC 接続を求めない。
    const lambda = generateBlueprint({ ...base, runtime: 'function', storage: ['nosql'] }).diagram;
    assert.equal(lambda.resources.find((resource) => resource.id === 'app')!.parentId, 'tokyo');
    assert.deepEqual(route(lambda, 'request').at(-1), 'app->items');

    const none = generateBlueprint({ ...base, storage: [] });
    assert.deepEqual(route(none.diagram, 'request'), ['users->entry', 'entry->app']);
    assert.ok(none.unresolved.some((item) => item.includes('状態を持たない')));

    const both = generateBlueprint({ ...base, storage: ['nosql', 'object'] }).diagram;
    assert.deepEqual(route(both, 'request').at(-1), 'app->items');
    assert.deepEqual(route(both, 'store-object'), ['app->files']);
  });

  it('ALB から Lambda を直接呼び出す経路には待受ポートを付けない', () => {
    const { diagram } = generateBlueprint({ ...base, runtime: 'function', storage: ['nosql'] });
    const invocation = diagram.connections.find((edge) => edge.id === 'request_2')!;
    assert.equal(invocation.attributes.port, undefined);
    assert.equal(invocation.attributes.protocol, undefined);
    assert.match(String(invocation.attributes.description), /直接呼び出し.*JSON イベント/);
    const entry = diagram.resources.find((resource) => resource.id === 'entry')!;
    assert.equal(diagram.resources.find((resource) => resource.id === entry.parentId)!.type, 'vpc');
    assert.equal(diagram.resources.find((resource) => resource.id === 'app')!.parentId, 'tokyo');
    assert.ok(
      diagram.resources
        .find((resource) => resource.id === 'app')!
        .unresolved?.some((item) => item.includes('呼び出し許可')),
    );
  });

  it('リージョンの選択で配置先と複製先が変わる', () => {
    const osaka = generateBlueprint({ ...base, region: 'secondary' }).diagram;
    assert.deepEqual(
      byType(osaka, 'region').map((region) => region.attributes.region),
      ['ap-northeast-3'],
    );
    assert.ok(
      osaka.resources.every(
        (resource) => !String(resource.attributes.az ?? '').startsWith('ap-northeast-1'),
      ),
    );

    const both = generateBlueprint({ ...base, region: 'both', storage: ['sql', 'object'] });
    assert.deepEqual(
      byType(both.diagram, 'region').map((region) => region.attributes.region),
      ['ap-northeast-1', 'ap-northeast-3'],
    );
    const replicas = both.diagram.connections.filter((edge) => edge.kind === 'replication');
    assert.deepEqual(
      replicas.map((edge) => `${edge.source}->${edge.target}`),
      ['database->database_replica', 'files->files_replica'],
    );
    // 大阪には実行環境を置かず、切替手順が未設計であることを残す。
    const secondary = both.diagram.resources.find((resource) => resource.id === 'osaka')!;
    assert.ok(secondary.unresolved?.some((item) => item.includes('切替手順は未設計')));
    assert.equal(
      both.diagram.resources.filter((resource) => resource.type === 'aws.ecs').length,
      1,
    );
  });

  it('用途に応じて構成を変える', () => {
    const site = generateBlueprint({ ...base, purpose: 'static', storage: ['sql'] });
    // 静的サイトは実行方式・保存先を質問せず、指定されていても使わない。
    assert.equal(byType(site.diagram, 'aws.rds').length, 0);
    assert.equal(byType(site.diagram, 'vpc').length, 0);
    assert.deepEqual(route(site.diagram, 'page'), ['users->site']);

    const web = generateBlueprint({ ...base, purpose: 'web' }).diagram;
    assert.deepEqual(route(web, 'page'), ['users->site']);
    assert.deepEqual(route(web, 'request'), ['users->entry', 'entry->app', 'app->database']);

    const worker = generateBlueprint({ ...base, purpose: 'worker' }).diagram;
    assert.equal(byType(worker, 'aws.alb').length, 0);
    assert.deepEqual(route(worker, 'job'), ['producer->queue', 'queue->app', 'app->database']);
    assert.equal(byType(worker, 'external.user').length, 0);

    const delivery = generateBlueprint({ ...base, delivery: 'github' }).diagram;
    assert.deepEqual(route(delivery, 'delivery'), [
      'repository->pipeline',
      'pipeline->deployer',
      'deployer->app',
    ]);
    assert.equal(delivery.connections.find((edge) => edge.id === 'delivery_2')!.kind, 'auth');
  });

  it('クラウドごとに描ける実行方式だけを使い、境界をそのクラウドの単位で作る', () => {
    assert.deepEqual(
      runtimeOptions('gcp').map((option) => option.value),
      ['managed', 'vm'],
    );
    const gcp = generateBlueprint({ ...base, cloud: 'gcp', runtime: 'function' });
    assert.equal(gcp.answers.runtime, 'managed');
    assert.equal(byType(gcp.diagram, 'gcp.cloud_run').length, 1);
    assert.equal(byType(gcp.diagram, 'gcp.sql').length, 1);
    assert.equal(byType(gcp.diagram, 'project').length, 1);
    assert.equal(byType(gcp.diagram, 'vpc').length, 0);
    const azure = generateBlueprint({ ...base, cloud: 'azure', runtime: 'function' }).diagram;
    assert.equal(byType(azure, 'azure.functions').length, 1);
    assert.equal(byType(azure, 'subscription').length, 1);
    assert.equal(byType(azure, 'group')[0]!.attributes.region, 'japaneast');
    assert.equal(azure.connections.find((edge) => edge.id === 'request_3')!.attributes.port, 1433);
  });

  it('未対応の回答は推測で埋めずに拒否する', () => {
    assert.throws(
      () => generateBlueprint({ ...base, cloud: 'oracle' as never }),
      /未対応の回答です: cloud=oracle/,
    );
    assert.throws(
      () => generateBlueprint({ ...base, storage: ['graph' as never] }),
      /未対応の保存方式/,
    );
  });

  it('すべての回答の組み合わせで検証を通り、すべての接続に説明の順序がある', () => {
    let count = 0;
    for (const purpose of blueprintPurposes)
      for (const cloud of blueprintClouds)
        for (const region of blueprintRegions)
          for (const runtime of blueprintRuntimes)
            for (const storage of [
              [],
              ['sql'],
              ['nosql', 'object'],
              ['sql', 'nosql', 'object'],
            ] as const)
              for (const delivery of blueprintDeliveries) {
                const { diagram } = generateBlueprint({
                  purpose,
                  cloud,
                  region,
                  runtime,
                  storage: [...storage],
                  delivery,
                });
                const steps = buildWalkthrough(diagram);
                assert.equal(steps.length, diagram.connections.length);
                assert.ok(steps.every((step) => step.basis === 'explicit'));
                assert.ok(diagram.connections.length > 0);
                count++;
              }
    assert.equal(count, 4 * 3 * 3 * 3 * 4 * 2);
  });
});
