import { awsIconColors } from '../assets/aws-icon-colors';
import { isBoundary, type Resource } from '../core/model';
import type { SolidEmblem } from './spatial-solids';

/** GitHub の製品を示す表示アイコン。Octocat はこれらのノードだけに使う。 */
export const githubIconTypes = new Set(['saas.github', 'github.repository', 'github.actions']);

/**
 * 表示アイコンの種別から、3D で使う公式ロゴ・キャラクターを決める。
 * 名前やラベルからは推測しない。アイコンを解決できない型は機能別の立体のままにする。
 */
export function resolveEmblem(
  resource: Resource,
  iconType: string,
  collapsed: boolean,
  getIcon: (type: string) => string | undefined,
): SolidEmblem | undefined {
  if (collapsed || isBoundary(resource)) return undefined;
  if (githubIconTypes.has(iconType)) return { kind: 'octocat' };
  const official = awsIconColors[iconType];
  const href = official && getIcon(iconType);
  return official && href ? { kind: 'aws-logo', href, ...official } : undefined;
}
