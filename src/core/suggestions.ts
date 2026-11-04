import type { Attributes, Diagram, EdgeKind, Resource } from './model.js';
import { validateDiagram } from './validate.js';

export interface ResourceSuggestion {
  type: string;
  label: string;
  reason: string;
  parentId?: string;
  attributes: Attributes;
  note?: string;
  connection?: { kind: EdgeKind; label: string; reverse?: boolean };
}
interface AwsContext {
  aws: boolean;
  vpc?: Resource;
  subnet?: Resource;
  region?: Resource;
  account?: Resource;
}

/** 名前ではなく型・provider・所属から AWS の設計コンテキストを解決する。 */
function awsContext(diagram: Diagram, resource: Resource): AwsContext {
  const byId = new Map(diagram.resources.map((item) => [item.id, item]));
  const seen = new Set<string>();
  let current: Resource | undefined = resource;
  const context: AwsContext = { aws: false };
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    const provider = String(current.attributes.provider ?? '');
    if (
      /^(google|google-beta|azurerm)(\.|$)/.test(provider) ||
      ['project', 'subscription'].includes(current.type)
    )
      return { aws: false };
    if (
      /^aws(\.|$)/.test(provider) ||
      current.type.startsWith('aws.') ||
      String(current.attributes.icon ?? '').startsWith('aws.') ||
      /(^|\.)aws_subnet\./.test(current.provenance?.address ?? '')
    )
      context.aws = true;
    if (current.type === 'vpc') {
      context.vpc ??= current;
      context.aws = true;
    }
    if (current.type === 'subnet') context.subnet ??= current;
    if (current.type === 'region') context.region ??= current;
    if (['account', 'aws.organization-account'].includes(current.type)) context.account ??= current;
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return context;
}

const labels: Record<string, string> = {
  region: 'Region',
  vpc: 'VPC',
  subnet: 'Subnet',
  sg: 'Security Group',
  'aws.ec2': 'EC2',
  'aws.alb': 'ALB',
  'aws.rds': 'RDS',
  'aws.s3': 'S3',
  'aws.lambda': 'Lambda',
  'aws.dynamodb': 'DynamoDB',
  'aws.ecs': 'ECS',
  'aws.ecs-cluster': 'ECS Cluster',
  'aws.ecs-service': 'ECS Service',
  'aws.ecs-task': 'ECS Task',
  'aws.ecs-container': 'ECS Container',
  'aws.eks': 'EKS',
  'aws.eks-node-group': 'EKS Node Group',
};
const subnetNote = '設計途中: 配置する Subnet・AZ とネットワーク設定を指定してください。';
const multiSubnetNote = (type: string): string =>
  type === 'aws.alb'
    ? '設計途中: 通常の ALB は異なる AZ の Subnet が2つ以上必要です。subnets・公開方式・経路を確認してください。'
    : '設計途中: 通常の DB subnet group は異なる AZ の Subnet が2つ以上必要です。subnets は図上の関連であり、DB subnet group の作成は表していません。';

/** 配置と設計上の接続を分離する。権限・通信成立・デプロイ可能性は推定しない。 */
export function suggestResources(diagram: Diagram, selectedId: string): ResourceSuggestion[] {
  const selected = diagram.resources.find((item) => item.id === selectedId);
  if (!selected) return [];
  const context = awsContext(diagram, selected);
  if (!context.aws) return [];
  // リージョナルサービスを Subnet やアプリケーションの子に置かない。
  const regionalParent = context.region?.id ?? context.account?.id;
  const candidate = (
    type: string,
    parentId: string | undefined,
    reason: string,
    attributes: Attributes = {},
    note?: string,
  ): ResourceSuggestion => ({
    type,
    label: labels[type] ?? type,
    parentId,
    reason,
    attributes,
    ...(note ? { note } : {}),
  });
  const child = (type: string, note?: string) =>
    candidate(type, selected.id, '選択した境界の中に追加します。', {}, note);
  const regional = (type: string) =>
    candidate(
      type,
      regionalParent,
      'Region / Account 配下にサービスを追加します。境界がなければ図の最上位に配置します。',
    );
  const related = (
    item: ResourceSuggestion,
    label: string,
    kind: EdgeKind = 'traffic',
    reverse = false,
  ): ResourceSuggestion => ({
    ...item,
    connection: { kind, label, reverse },
  });
  const database = () =>
    candidate(
      'aws.rds',
      context.vpc!.id,
      'VPC 内にデータベースを追加します。',
      {},
      multiSubnetNote('aws.rds'),
    );
  const compute = () =>
    candidate(
      'aws.ec2',
      context.subnet?.id ?? context.vpc!.id,
      '同じネットワークの中にインスタンスを追加します。',
      {},
      context.subnet ? undefined : subnetNote,
    );
  const dataTargets = () => [
    ...(context.vpc ? [related(database(), 'DB アクセス（設計）')] : []),
    related(regional('aws.s3'), 'オブジェクトアクセス（設計）'),
    related(regional('aws.dynamodb'), 'データアクセス（設計）'),
  ];
  switch (selected.type) {
    case 'account':
    case 'aws.organization-account':
      return [
        {
          ...child('region', '設計途中: region 属性に利用するリージョンを指定してください。'),
          attributes: { provider: 'aws' },
        },
      ];
    case 'region':
      return [
        child('vpc'),
        ...['aws.lambda', 'aws.s3', 'aws.dynamodb', 'aws.ecs-cluster', 'aws.eks'].map(regional),
      ];
    case 'vpc':
      return [
        child('subnet'),
        child('sg'),
        candidate(
          'aws.alb',
          selected.id,
          'VPC 内にロードバランサーを追加します。',
          {},
          multiSubnetNote('aws.alb'),
        ),
        database(),
      ];
    case 'subnet':
      return [
        child('aws.ec2'),
        ...(context.vpc
          ? ['aws.alb', 'aws.rds'].map((type) =>
              candidate(
                type,
                context.vpc!.id,
                'VPC 内に配置し、選択した Subnet を関連付けます。',
                { subnets: [selected.id] },
                multiSubnetNote(type),
              ),
            )
          : []),
      ];
    case 'aws.alb':
      return [
        ...(context.vpc ? [related(compute(), 'ターゲット転送（設計）')] : []),
        related(
          {
            ...regional('aws.lambda'),
            note: '設計途中: Lambda ターゲットグループと呼び出し許可を設定してください。',
          },
          'ターゲット転送（設計）',
        ),
      ];
    case 'aws.ecs':
    case 'aws.ec2':
    case 'aws.ecs-container':
      return dataTargets();
    case 'aws.lambda':
      return dataTargets();
    case 'aws.rds':
      return [
        related(
          {
            ...regional('aws.lambda'),
            note: '設計途中: Lambda の VPC 接続・Subnet・Security Group・DB 認証を設定してください。',
          },
          'DB アクセス（設計）',
          'traffic',
          true,
        ),
      ];
    // https://docs.aws.amazon.com/lambda/latest/dg/with-s3.html
    case 'aws.s3':
      return [
        related(
          {
            ...regional('aws.lambda'),
            note: '設計途中: 同一リージョンの通知先、S3 イベント通知と Lambda 呼び出し許可を設定してください。',
          },
          'イベント通知（設計）',
          'association',
        ),
      ];
    // https://docs.aws.amazon.com/lambda/latest/dg/services-dynamodb-eventsourcemapping.html
    case 'aws.dynamodb':
      return [
        related(
          {
            ...regional('aws.lambda'),
            note: '設計途中: DynamoDB Streams とイベントソースマッピング、読み取り権限を設定してください。Lambda によるポーリングの関連です。',
          },
          'Streams イベントソース（設計）',
          'association',
        ),
      ];
    case 'sg':
      return context.vpc
        ? [
            {
              ...compute(),
              attributes: { securityGroups: [selected.id] },
              reason:
                'この Security Group を関連付けた EC2 を追加します。許可ルールと通信成立は未確認です。',
            },
          ]
        : [];
    // https://docs.aws.amazon.com/AmazonECS/latest/developerguide/ecs-configuration.html
    case 'aws.ecs-cluster':
      return [
        child(
          'aws.ecs-service',
          '設計途中: タスク定義・実行方式・ネットワーク設定を指定してください。',
        ),
      ];
    case 'aws.ecs-service':
    case 'aws.ecs-task-definition':
      return [child('aws.ecs-task')];
    case 'aws.ecs-task':
      return [child('aws.ecs-container')];
    // https://docs.aws.amazon.com/eks/latest/userguide/create-managed-node-group.html
    case 'aws.eks':
    case 'aws.eks-cluster':
      return [child('aws.eks-node-group', subnetNote)];
    case 'aws.eks-node-group':
      return [
        child('aws.ec2', '設計途中: ノードの Subnet 所属は subnets 属性で別途指定してください。'),
      ];
    default:
      return [];
  }
}

/** 現在も有効な候補だけを追加し、既存リソースと取り込み根拠を保持する。 */
export function addSuggestedResource(diagram: Diagram, selectedId: string, type: string): Diagram {
  const suggestion = suggestResources(diagram, selectedId).find((item) => item.type === type);
  if (!suggestion) throw new Error('選択中のリソースに対応しない候補です。');
  const ids = new Set(
    [...diagram.resources, ...diagram.connections, ...diagram.views].map((item) => item.id),
  );
  const uniqueId = (base: string) => {
    let number = 1;
    while (ids.has(`${base}_${number}`)) number++;
    const id = `${base}_${number}`;
    ids.add(id);
    return id;
  };
  const resource: Resource = {
    id: uniqueId(type.replaceAll('.', '_')),
    type,
    label: suggestion.label,
    parentId: suggestion.parentId,
    attributes: structuredClone(suggestion.attributes),
    provenance: { kind: 'design' },
    ...(suggestion.note ? { unresolved: [suggestion.note] } : {}),
  };
  const link = suggestion.connection;
  const connections = link
    ? [
        ...diagram.connections,
        {
          id: uniqueId('suggested_connection'),
          source: link.reverse ? resource.id : selectedId,
          target: link.reverse ? selectedId : resource.id,
          kind: link.kind,
          attributes: { label: link.label, evidence: 'design' },
        },
      ]
    : diagram.connections;
  return validateDiagram({ ...diagram, resources: [...diagram.resources, resource], connections });
}
