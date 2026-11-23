import type { Attributes, Connection, Diagram, EdgeKind, Resource } from './model.js';
import { parseDSL } from './parser.js';
import { serializeDSL } from './serialize.js';
import { validateDiagram } from './validate.js';

/**
 * 「何を作る予定ですか？」への回答から、設計用の雛形を決定的に生成する。
 * LLM・認証・クラウド API を使わず、同じ回答からは常に同じ DSL を返す。
 * 生成物は設計上の意図であり、構築済み・通信成立・権限成立を表さない。
 */
export const blueprintPurposes = ['api', 'web', 'static', 'worker'] as const;
export const blueprintClouds = ['aws', 'gcp', 'azure'] as const;
export const blueprintRegions = ['primary', 'secondary', 'both'] as const;
export const blueprintRuntimes = ['managed', 'function', 'vm'] as const;
export const blueprintStorages = ['sql', 'nosql', 'object'] as const;
export const blueprintDeliveries = ['github', 'none'] as const;

export type BlueprintPurpose = (typeof blueprintPurposes)[number];
export type BlueprintCloud = (typeof blueprintClouds)[number];
export type BlueprintRegion = (typeof blueprintRegions)[number];
export type BlueprintRuntime = (typeof blueprintRuntimes)[number];
export type BlueprintStorage = (typeof blueprintStorages)[number];
export type BlueprintDelivery = (typeof blueprintDeliveries)[number];

export interface BlueprintAnswers {
  purpose: BlueprintPurpose;
  cloud: BlueprintCloud;
  region: BlueprintRegion;
  runtime: BlueprintRuntime;
  /** 空配列は「保存しない」。 */
  storage: BlueprintStorage[];
  delivery: BlueprintDelivery;
}

export interface BlueprintOption<T extends string> {
  value: T;
  label: string;
  description: string;
}

export const purposeOptions: BlueprintOption<BlueprintPurpose>[] = [
  {
    value: 'api',
    label: 'API サーバー',
    description: 'アプリや他システムからのリクエストを受けて処理します。',
  },
  {
    value: 'web',
    label: 'Web アプリ（画面＋API）',
    description: '画面のファイル配信と、画面から呼ぶ API を分けて描きます。',
  },
  {
    value: 'static',
    label: '静的サイト',
    description: 'HTML・画像などのファイルを配信します。サーバー処理は描きません。',
  },
  {
    value: 'worker',
    label: '非同期処理（キュー＋ワーカー）',
    description: '受け付けたジョブをキューに入れ、ワーカーが順に処理します。',
  },
];

interface CloudProfile {
  label: string;
  regions: Record<'primary' | 'secondary', { id: string; code: string; label: string }>;
  runtimes: Partial<Record<BlueprintRuntime, { type: string; label: string; regional: boolean }>>;
  stores: Record<BlueprintStorage, { type: string; label: string }>;
  queue: { type: string; label: string };
  site: { type: string; label: string };
  entry: { type: string; label: string };
  deployIdentity: { type: string; label: string };
}

// 共通モデルの種別を使い、同梱アイコンがないサービスは機能別の立体で表す。
const clouds: Record<BlueprintCloud, CloudProfile> = {
  aws: {
    label: 'AWS',
    regions: {
      primary: { id: 'tokyo', code: 'ap-northeast-1', label: '東京' },
      secondary: { id: 'osaka', code: 'ap-northeast-3', label: '大阪' },
    },
    runtimes: {
      managed: { type: 'aws.ecs', label: 'ECS Fargate', regional: false },
      function: { type: 'aws.lambda', label: 'Lambda', regional: true },
      vm: { type: 'aws.ec2', label: 'EC2', regional: false },
    },
    stores: {
      sql: { type: 'aws.rds', label: 'RDS for PostgreSQL' },
      nosql: { type: 'aws.dynamodb', label: 'DynamoDB' },
      object: { type: 'aws.s3', label: 'S3' },
    },
    queue: { type: 'aws.sqs', label: 'SQS キュー' },
    site: { type: 'aws.s3', label: 'S3' },
    entry: { type: 'aws.alb', label: 'ALB' },
    deployIdentity: { type: 'aws.iam', label: 'デプロイ用 IAM ロール' },
  },
  gcp: {
    label: 'Google Cloud',
    regions: {
      primary: { id: 'tokyo', code: 'asia-northeast1', label: '東京' },
      secondary: { id: 'osaka', code: 'asia-northeast2', label: '大阪' },
    },
    runtimes: {
      managed: { type: 'gcp.cloud_run', label: 'Cloud Run', regional: true },
      vm: { type: 'gcp.compute', label: 'Compute Engine', regional: true },
    },
    stores: {
      sql: { type: 'gcp.sql', label: 'Cloud SQL for PostgreSQL' },
      nosql: { type: 'gcp.firestore', label: 'Firestore' },
      object: { type: 'gcp.storage', label: 'Cloud Storage' },
    },
    queue: { type: 'gcp.pubsub', label: 'Pub/Sub トピック' },
    site: { type: 'gcp.storage', label: 'Cloud Storage' },
    entry: { type: 'gcp.load-balancer', label: 'Cloud Load Balancing' },
    deployIdentity: { type: 'gcp.service-account', label: 'デプロイ用サービスアカウント' },
  },
  azure: {
    label: 'Azure',
    regions: {
      primary: { id: 'japan_east', code: 'japaneast', label: '東日本' },
      secondary: { id: 'japan_west', code: 'japanwest', label: '西日本' },
    },
    runtimes: {
      managed: { type: 'azure.app', label: 'App Service', regional: true },
      function: { type: 'azure.functions', label: 'Azure Functions', regional: true },
      vm: { type: 'azure.vm', label: '仮想マシン', regional: true },
    },
    stores: {
      sql: { type: 'azure.sql', label: 'Azure SQL Database' },
      nosql: { type: 'azure.cosmos-db', label: 'Cosmos DB' },
      object: { type: 'azure.storage', label: 'Blob Storage' },
    },
    queue: { type: 'azure.service-bus', label: 'Service Bus キュー' },
    site: { type: 'azure.storage', label: 'Storage 静的 Web サイト' },
    entry: { type: 'azure.front-door', label: 'Front Door' },
    deployIdentity: { type: 'azure.managed-identity', label: 'デプロイ用マネージド ID' },
  },
};

export const cloudOptions: BlueprintOption<BlueprintCloud>[] = [
  {
    value: 'aws',
    label: 'AWS',
    description: 'VPC・Subnet・ALB を含めて、ネットワークの境界まで描きます。',
  },
  {
    value: 'gcp',
    label: 'Google Cloud',
    description: 'プロジェクトとリージョンの中に、マネージドサービスを並べます。',
  },
  {
    value: 'azure',
    label: 'Azure',
    description: 'サブスクリプションとリソースグループの中に、サービスを並べます。',
  },
];

export function regionOptions(cloud: BlueprintCloud): BlueprintOption<BlueprintRegion>[] {
  const { primary, secondary } = clouds[cloud].regions;
  return [
    {
      value: 'primary',
      label: `${primary.label}だけ`,
      description: `${primary.code} の1リージョンに置きます。`,
    },
    {
      value: 'secondary',
      label: `${secondary.label}だけ`,
      description: `${secondary.code} の1リージョンに置きます。`,
    },
    {
      value: 'both',
      label: `${primary.label}＋${secondary.label}（データの複製先）`,
      description: `${secondary.label}には保存データの複製先だけを描きます。切替手順は未設計として残します。`,
    },
  ];
}

const runtimeDescriptions: Record<BlueprintRuntime, string> = {
  managed: 'コンテナやアプリを、サーバー管理の少ない基盤で動かします。',
  function: 'リクエストやイベントごとに関数を実行します。',
  vm: '仮想マシンを自分で管理して動かします。',
};

/** 選んだクラウドで実際に描ける実行方式だけを返す。 */
export function runtimeOptions(cloud: BlueprintCloud): BlueprintOption<BlueprintRuntime>[] {
  return blueprintRuntimes.flatMap((value) => {
    const runtime = clouds[cloud].runtimes[value];
    return runtime
      ? [{ value, label: runtime.label, description: runtimeDescriptions[value] }]
      : [];
  });
}

const storageDescriptions: Record<BlueprintStorage, string> = {
  sql: '表と SQL で扱う業務データ。',
  nosql: 'キーで読み書きする項目・セッションなど。',
  object: '画像・アップロードファイルなど。',
};
export function storageOptions(cloud: BlueprintCloud): BlueprintOption<BlueprintStorage>[] {
  return blueprintStorages.map((value) => ({
    value,
    label: clouds[cloud].stores[value].label,
    description: storageDescriptions[value],
  }));
}

export const deliveryOptions: BlueprintOption<BlueprintDelivery>[] = [
  {
    value: 'github',
    label: 'GitHub Actions から配備',
    description: 'リポジトリから一時的な認証で配備する流れも描きます。',
  },
  { value: 'none', label: '描かない', description: '実行時の流れだけを描きます。' },
];

export const defaultBlueprintAnswers: Omit<BlueprintAnswers, 'purpose'> = {
  cloud: 'aws',
  region: 'primary',
  runtime: 'managed',
  storage: [],
  delivery: 'none',
};

/** 静的サイトは実行方式・保存先を質問しない。 */
export const asksRuntime = (purpose: BlueprintPurpose) => purpose !== 'static';
export const asksStorage = (purpose: BlueprintPurpose) => purpose !== 'static';

/**
 * クラウドの変更などで選べなくなった回答を、選べる値へ寄せる。
 * 画面と生成の両方で同じ規則を使い、表示した要約と生成物を一致させる。
 */
export function normalizeBlueprintAnswers(answers: BlueprintAnswers): BlueprintAnswers {
  const runtimes = runtimeOptions(answers.cloud).map((option) => option.value);
  return {
    ...answers,
    runtime: runtimes.includes(answers.runtime) ? answers.runtime : runtimes[0]!,
    storage: asksStorage(answers.purpose)
      ? blueprintStorages.filter((item) => answers.storage.includes(item))
      : [],
  };
}

export interface Blueprint {
  answers: BlueprintAnswers;
  diagram: Diagram;
  source: string;
  /** 回答から決めた設計上の仮定。 */
  assumptions: string[];
  /** 生成した要素に残した、確認が必要な事項。 */
  unresolved: string[];
}

export function describeAnswers(answers: BlueprintAnswers): { label: string; value: string }[] {
  const value = normalizeBlueprintAnswers(answers);
  const profile = clouds[value.cloud];
  const rows = [
    {
      label: '作るもの',
      value: purposeOptions.find((option) => option.value === value.purpose)!.label,
    },
    { label: 'クラウド', value: profile.label },
    {
      label: 'リージョン',
      value: regionOptions(value.cloud).find((option) => option.value === value.region)!.label,
    },
  ];
  if (asksRuntime(value.purpose))
    rows.push({ label: '実行方式', value: profile.runtimes[value.runtime]!.label });
  if (asksStorage(value.purpose))
    rows.push({
      label: 'データの保存',
      value: value.storage.length
        ? value.storage.map((item) => profile.stores[item].label).join('、')
        : '保存しない',
    });
  rows.push({
    label: '配備の流れ',
    value: deliveryOptions.find((option) => option.value === value.delivery)!.label,
  });
  return rows;
}

const purposeTitles: Record<BlueprintPurpose, string> = {
  api: 'API サーバー',
  web: 'Web アプリ',
  static: '静的サイト',
  worker: '非同期処理',
};

/** 回答から設計用の雛形を作り、既存の検証・DSL 往復を通した図を返す。 */
export function generateBlueprint(input: BlueprintAnswers): Blueprint {
  for (const [key, values] of [
    ['purpose', blueprintPurposes],
    ['cloud', blueprintClouds],
    ['region', blueprintRegions],
    ['runtime', blueprintRuntimes],
    ['delivery', blueprintDeliveries],
  ] as const)
    if (!(values as readonly string[]).includes(input[key]))
      throw new Error(`未対応の回答です: ${key}=${String(input[key])}`);
  if (input.storage.some((item) => !(blueprintStorages as readonly string[]).includes(item)))
    throw new Error('未対応の保存方式です。');
  const answers = normalizeBlueprintAnswers(input);
  const profile = clouds[answers.cloud];
  const resources: Resource[] = [];
  const connections: Connection[] = [];
  const assumptions: string[] = [];
  const add = (
    id: string,
    type: string,
    label: string,
    parentId?: string,
    attributes: Attributes = {},
    unresolved: string[] = [],
  ) => {
    resources.push({
      id,
      type,
      label,
      ...(parentId ? { parentId } : {}),
      attributes,
      provenance: { kind: 'design' },
      ...(unresolved.length ? { unresolved } : {}),
    });
    return id;
  };
  const connect = (
    id: string,
    source: string,
    target: string,
    kind: EdgeKind,
    attributes: Attributes,
  ) => connections.push({ id, source, target, kind, attributes });

  const regions =
    answers.region === 'both'
      ? [profile.regions.primary, profile.regions.secondary]
      : [profile.regions[answers.region]];
  const home = regions[0]!;

  // 管理境界: 実在の ID は推測せず、未指定として残す。
  let scopeId: string;
  if (answers.cloud === 'aws')
    scopeId = add('workload', 'account', 'AWS アカウント', undefined, { icon: 'aws.account' }, [
      'AWS アカウント ID は未指定です。利用するアカウントを決めて account 属性に記載してください。',
    ]);
  else if (answers.cloud === 'gcp')
    scopeId = add('workload', 'project', 'Google Cloud プロジェクト', undefined, {}, [
      'プロジェクト ID は未指定です。利用するプロジェクトを決めて project 属性に記載してください。',
    ]);
  else
    scopeId = add('workload', 'subscription', 'Azure サブスクリプション', undefined, {}, [
      'サブスクリプション ID は未指定です。利用するサブスクリプションを決めて subscription 属性に記載してください。',
    ]);
  const regionIds = regions.map((region, index) =>
    add(
      region.id,
      answers.cloud === 'azure' ? 'group' : 'region',
      answers.cloud === 'azure' ? `${region.label}のリソースグループ` : region.label,
      scopeId,
      { region: region.code },
      index === 0
        ? []
        : [
            `${region.label}には保存データの複製先だけを描いています。実行環境と切替手順は未設計です。`,
          ],
    ),
  );
  const homeRegion = regionIds[0]!;
  assumptions.push(
    answers.region === 'both'
      ? `${home.label}（${home.code}）で処理し、${regions[1]!.label}（${regions[1]!.code}）にはデータの複製先だけを置く前提です。`
      : `${home.label}（${home.code}）の1リージョンだけに置く前提です。`,
  );

  const users = add(
    answers.purpose === 'worker' ? 'producer' : 'users',
    answers.purpose === 'worker' ? 'external.service' : 'external.user',
    answers.purpose === 'worker'
      ? 'ジョブの送信元'
      : answers.purpose === 'api'
        ? '利用者のアプリ'
        : '利用者',
  );
  const runtime = asksRuntime(answers.purpose) ? profile.runtimes[answers.runtime]! : undefined;
  const storage = answers.storage;

  // AWS は VPC 内の Subnet を描き、ALB・コンテナ・VM・RDS の配置先を示す。
  const needsEntry = answers.purpose === 'api' || answers.purpose === 'web';
  const awsVpc =
    answers.cloud === 'aws' &&
    (needsEntry || (runtime !== undefined && !runtime.regional) || storage.includes('sql'));
  const vpcIds = new Map<string, { vpc: string; public?: string[]; private: string[] }>();
  const createVpc = (regionId: string, region: { code: string }, primary: boolean) => {
    const prefix = primary ? '' : 'replica_';
    const octet = primary ? 0 : 1;
    const cidr = `10.${octet}.0.0/16`;
    const vpc = add(
      `${prefix}vpc`,
      'vpc',
      primary ? 'アプリケーション VPC' : '複製先 VPC',
      regionId,
      { cidr },
      [
        `CIDR ${cidr} と2つの AZ は設計用の仮の値です。既存のネットワークと重ならないか確認してください。`,
        'Internet Gateway・NAT Gateway・ルートテーブル・VPC エンドポイントなどの外向き経路は未設計です。イメージ取得や SQS・S3・DynamoDB への接続方法を確認してください。',
      ],
    );
    const zones = ['a', 'c'];
    const publicSubnets =
      primary && needsEntry
        ? zones.map((zone, index) =>
            add(`${prefix}public_${zone}`, 'subnet', `Public AZ-${zone}`, vpc, {
              subnetType: 'public',
              az: `${region.code}${zone}`,
              cidr: `10.${octet}.${index}.0/24`,
            }),
          )
        : undefined;
    const privateSubnets = zones.map((zone, index) =>
      add(`${prefix}private_${zone}`, 'subnet', `Private AZ-${zone}`, vpc, {
        subnetType: 'private',
        az: `${region.code}${zone}`,
        cidr: `10.${octet}.${10 + index}.0/24`,
      }),
    );
    vpcIds.set(regionId, { vpc, public: publicSubnets, private: privateSubnets });
  };
  if (awsVpc) createVpc(homeRegion, home, true);

  const homeNetwork = vpcIds.get(homeRegion);
  let entry: string | undefined;
  let app: string | undefined;
  let site: string | undefined;
  let queue: string | undefined;

  if (answers.purpose === 'web' || answers.purpose === 'static') {
    site = add(
      'site',
      profile.site.type,
      `画面のファイル（${profile.site.label}）`,
      homeRegion,
      { description: 'HTML・JavaScript・画像などの静的ファイルを置きます。' },
      [
        answers.cloud === 'aws'
          ? 'HTTPS と独自ドメインで配信するには CDN（CloudFront 等）と証明書の設計が必要です。この雛形には含めていません。'
          : 'HTTPS と独自ドメインで配信する方式（CDN・証明書）は未設計です。',
      ],
    );
  }
  if (needsEntry) {
    entry = add(
      'entry',
      profile.entry.type,
      `API の入口（${profile.entry.label}）`,
      homeNetwork ? homeNetwork.vpc : homeRegion,
      homeNetwork ? { subnets: homeNetwork.public! } : {},
      ['公開範囲・証明書・リスナー・ヘルスチェックは未設定です。'],
    );
  }
  if (answers.purpose === 'worker') {
    queue = add('queue', profile.queue.type, profile.queue.label, homeRegion, {}, [
      '再試行回数・デッドレターキュー・メッセージの保持期間は未決定です。',
    ]);
  }
  if (runtime) {
    const label = `${answers.purpose === 'worker' ? 'ワーカー' : 'API'}（${runtime.label}）`;
    const inVpc = homeNetwork && (!runtime.regional || storage.includes('sql'));
    app = add(
      'app',
      runtime.type,
      label,
      inVpc ? homeNetwork.vpc : homeRegion,
      inVpc ? { subnets: homeNetwork.private } : {},
      [
        storage.length
          ? '台数・性能・自動スケールの条件は未決定です。'
          : '保存先を選ばなかったため、状態を持たない処理として描いています。台数・性能は未決定です。',
        ...(runtime.type === 'aws.lambda' && inVpc
          ? ['Lambda を VPC に接続する設定（Subnet・セキュリティグループ）が必要です。']
          : []),
        ...(runtime.type === 'aws.lambda' && needsEntry
          ? [
              'ALB の Lambda ターゲット登録・呼び出し許可と、JSON イベントを扱う関数を設定してください。',
            ]
          : []),
      ],
    );
  }

  const storeIds: { kind: BlueprintStorage; id: string }[] = [];
  for (const kind of storage) {
    const store = profile.stores[kind];
    const id = { sql: 'database', nosql: 'items', object: 'files' }[kind];
    const attributes: Attributes =
      kind === 'sql' && homeNetwork ? { subnets: homeNetwork.private } : {};
    add(
      id,
      store.type,
      { sql: '業務データ', nosql: '項目データ', object: 'ファイル保存' }[kind] +
        `（${store.label}）`,
      kind === 'sql' && homeNetwork ? homeNetwork.vpc : homeRegion,
      attributes,
      [
        {
          sql: 'エンジンの版・インスタンスサイズ・バックアップ方式は未決定です。',
          nosql: 'キー設計・容量モード・バックアップ方式は未決定です。',
          object: '公開範囲・暗号化・保持期間は未決定です。',
        }[kind],
      ],
    );
    storeIds.push({ kind, id });
  }

  // 処理の順序は route・step・purpose で明示し、説明モードの再生順に使う。
  const protocolFor = (kind: BlueprintStorage): Attributes =>
    kind === 'sql'
      ? {
          protocol: 'tcp',
          port: answers.cloud === 'azure' ? 1433 : 5432,
        }
      : { protocol: 'https', port: 443 };
  const storeVerb: Record<BlueprintStorage, string> = {
    sql: 'SQL で業務データを読み書き',
    nosql: 'キーを指定して項目を読み書き',
    object: 'ファイルを保存・取得',
  };
  const storeDescription = (kind: BlueprintStorage, from: string) =>
    `${from} が ${profile.stores[kind].label} へ${storeVerb[kind]}します。`;

  if (site) {
    connect('page_1', users, site, 'traffic', {
      route: 'page',
      step: 1,
      purpose: 'application',
      protocol: 'https',
      port: 443,
      label: '画面の取得',
      description: '利用者のブラウザーが、画面の HTML・JavaScript・画像を取得します。',
    });
  }
  if (entry && app) {
    const [first, ...rest] = storeIds;
    connect('request_1', users, entry, 'traffic', {
      route: 'request',
      step: 1,
      purpose: 'application',
      protocol: 'https',
      port: 443,
      label: answers.purpose === 'web' ? '画面からの API 呼び出し' : 'API リクエスト',
      description:
        answers.purpose === 'web'
          ? '画面の JavaScript が、HTTPS で API の入口にリクエストを送ります。'
          : '利用者のアプリが、HTTPS で API の入口にリクエストを送ります。',
    });
    connect('request_2', entry, app, 'traffic', {
      route: 'request',
      step: 2,
      purpose: 'application',
      // ALB の Lambda ターゲットはネットワークの待受ポートを使わず、関数を直接呼ぶ。
      ...(runtime!.type === 'aws.lambda'
        ? {
            label: '関数の呼び出し',
            description:
              'ALB が Lambda を直接呼び出し、HTTP リクエストの内容を JSON イベントとして渡します。',
          }
        : {
            protocol: answers.cloud === 'aws' ? 'http' : 'https',
            port: answers.cloud === 'aws' ? 8080 : 443,
            label: '処理の振り分け',
            description: `入口が、${runtime!.label} で動く API へリクエストを振り分けます。`,
          }),
    });
    if (first)
      connect('request_3', app, first.id, 'traffic', {
        route: 'request',
        step: 3,
        purpose: 'application',
        ...protocolFor(first.kind),
        label: { sql: 'SQL クエリ', nosql: '項目の読み書き', object: 'ファイルの保存' }[first.kind],
        description: storeDescription(first.kind, 'API'),
      });
    rest.forEach(({ kind, id }) =>
      connect(`store_${kind}_1`, app, id, 'traffic', {
        route: `store-${kind}`,
        step: 1,
        purpose: 'application',
        ...protocolFor(kind),
        label: { sql: 'SQL クエリ', nosql: '項目の読み書き', object: 'ファイルの保存' }[kind],
        description: `必要なときに、${storeDescription(kind, 'API')}`,
      }),
    );
  }
  if (queue && app) {
    connect('job_1', users, queue, 'traffic', {
      route: 'job',
      step: 1,
      purpose: 'application',
      protocol: 'https',
      port: 443,
      label: 'ジョブの登録',
      description: '送信元が、処理してほしい内容をメッセージとしてキューに登録します。',
    });
    connect('job_2', queue, app, 'traffic', {
      route: 'job',
      step: 2,
      purpose: 'application',
      label: 'メッセージの受け取り',
      description:
        'ワーカーがキューからメッセージを受け取ります。受け取り方式（取得・プッシュ）と再試行は設計で決めます。',
    });
    const [first, ...rest] = storeIds;
    if (first)
      connect('job_3', app, first.id, 'traffic', {
        route: 'job',
        step: 3,
        purpose: 'application',
        ...protocolFor(first.kind),
        label: '処理結果の保存',
        description: storeDescription(first.kind, 'ワーカー'),
      });
    rest.forEach(({ kind, id }) =>
      connect(`store_${kind}_1`, app, id, 'traffic', {
        route: `store-${kind}`,
        step: 1,
        purpose: 'application',
        ...protocolFor(kind),
        label: '処理結果の保存',
        description: `必要なときに、${storeDescription(kind, 'ワーカー')}`,
      }),
    );
  }

  // 複製先は保存データだけを置き、実行環境と切替手順は未設計として残す。
  if (answers.region === 'both') {
    const secondaryId = regionIds[1]!;
    const secondary = regions[1]!;
    if (answers.cloud === 'aws' && storeIds.some((item) => item.kind === 'sql'))
      createVpc(secondaryId, secondary, false);
    const replicaNetwork = vpcIds.get(secondaryId);
    const copies = [...storeIds, ...(site ? [{ kind: 'object' as const, id: site }] : [])];
    for (const { kind, id } of copies) {
      const store = profile.stores[kind];
      const replica = add(
        `${id}_replica`,
        store.type,
        `${secondary.label}の複製（${store.label}）`,
        kind === 'sql' && replicaNetwork ? replicaNetwork.vpc : secondaryId,
        kind === 'sql' && replicaNetwork ? { subnets: replicaNetwork.private } : {},
        ['複製方式・遅延の許容値・切り替えの判断基準は未決定です。'],
      );
      connect(`replicate_${id}`, id, replica, 'replication', {
        route: `replicate-${id}`,
        step: 1,
        purpose: 'resilience',
        label: 'リージョン間の複製',
        description: `${home.label}のデータを${secondary.label}へ複製します。複製の成立と切り替え手順は未検証です。`,
      });
    }
  }

  if (answers.delivery === 'github') {
    const target = app ?? site!;
    add('repository', 'github.repository', 'アプリのリポジトリ', undefined, {}, [
      'リポジトリ名・ブランチ保護・承認ルールは未指定です。',
    ]);
    add('pipeline', 'github.actions', 'GitHub Actions');
    add('deployer', profile.deployIdentity.type, profile.deployIdentity.label, scopeId, {}, [
      '信頼するリポジトリ・ブランチと、配備に必要な最小権限は未設定です。',
    ]);
    connect('delivery_1', 'repository', 'pipeline', 'deploy', {
      route: 'delivery',
      step: 1,
      purpose: 'delivery',
      label: 'ワークフローの起動',
      description: '変更を取り込むと、GitHub Actions のワークフローが起動します。',
    });
    connect('delivery_2', 'pipeline', 'deployer', 'auth', {
      route: 'delivery',
      step: 2,
      purpose: 'delivery',
      protocol: 'oidc',
      label: 'OIDC で一時認証',
      description: `長期の鍵を保存せず、OIDC で${profile.deployIdentity.label}の一時的な認証情報を受け取ります。`,
    });
    connect('delivery_3', 'deployer', target, 'deploy', {
      route: 'delivery',
      step: 3,
      purpose: 'delivery',
      label: site && !app ? 'ファイルの配置' : '新しい版の配備',
      description:
        site && !app
          ? '受け取った権限で、画面のファイルを配置します。'
          : '受け取った権限で、新しい版を実行環境へ配備します。',
    });
  }

  resources.push({
    id: 'about',
    type: 'note',
    label: 'この図について',
    attributes: {
      anchor: users,
      description:
        '質問への回答から生成した設計用の雛形です。クラウド上に構築済みではなく、通信・権限・費用は未検証です。',
    },
    provenance: { kind: 'design' },
  });

  assumptions.push(
    runtime
      ? `処理は${runtime.label}で動かす前提です。`
      : 'サーバー処理を持たず、ファイル配信だけの前提です。',
    ...(asksStorage(answers.purpose)
      ? [
          storeIds.length
            ? `データは${storeIds.map(({ kind }) => profile.stores[kind].label).join('・')}に保存する前提です。`
            : 'データを保存しない（状態を持たない）前提です。',
        ]
      : []),
    ...(answers.cloud === 'aws' && homeNetwork
      ? ['VPC は 10.0.0.0/16、Subnet は2つの AZ に分ける仮の値です。']
      : []),
    answers.delivery === 'github'
      ? 'GitHub Actions から OIDC の一時認証で配備する前提です。'
      : '配備の流れは描いていません。',
    '矢印の順序は設計上の処理の流れです。実際の通信・権限・性能は確認していません。',
  );

  const title = `${purposeTitles[answers.purpose]}（${profile.label}・${regions.map((region) => region.label).join('＋')}）の設計雛形`;
  const diagram = validateDiagram({
    version: 1,
    title,
    resources,
    connections,
    views: [
      { id: 'overview', level: 'overview', direction: 'RIGHT' },
      { id: 'service', level: 'service', direction: 'RIGHT' },
      { id: 'network', level: 'subnet', direction: 'RIGHT' },
    ],
    diagnostics: [],
  });
  // 既存の DSL と同じ経路で読み直し、エディター・保存・Undo と同じ表現にそろえる。
  const source = serializeDSL(diagram);
  const parsed = parseDSL(source);
  if (!parsed.diagram) throw new Error(parsed.diagnostics.map((item) => item.message).join('\n'));
  return {
    answers,
    diagram: parsed.diagram,
    source,
    assumptions,
    unresolved: parsed.diagram.resources.flatMap((resource) =>
      (resource.unresolved ?? []).map((message) => `${resource.label}: ${message}`),
    ),
  };
}
