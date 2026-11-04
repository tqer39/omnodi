import { isBoundary, type Connection, type Resource } from './model.js';

export const nodeShapes = ['rectangle', 'rounded', 'ellipse', 'diamond'] as const;
export function nodeShape(resource: Resource): string {
  return String(
    resource.attributes.shape ??
      (
        {
          'flow.decision': 'diamond',
          'flow.start': 'ellipse',
          'flow.end': 'ellipse',
          'flow.activity': 'rounded',
          'uml.usecase': 'ellipse',
        } as Record<string, string>
      )[resource.type] ??
      'rectangle',
  );
}
export function validateNotationResource(resource: Resource): void {
  const { shape, stereotype } = resource.attributes;
  if (shape !== undefined && !(nodeShapes as readonly unknown[]).includes(shape))
    throw new Error('shape は rectangle・rounded・ellipse・diamond です。');
  if (
    shape !== undefined &&
    (resource.type === 'note' || resource.type === 'overlay' || isBoundary(resource))
  )
    throw new Error('shape は通常のノードに指定してください。');
  if (stereotype !== undefined && (typeof stereotype !== 'string' || !stereotype.trim()))
    throw new Error('stereotype は空でない文字列です。');
}
export function validateNotationConnection(edge: Connection): void {
  const { polarity, delay, sourceMultiplicity, targetMultiplicity } = edge.attributes;
  if (
    polarity !== undefined &&
    (edge.kind !== 'cause' ||
      typeof polarity !== 'string' ||
      !['positive', 'negative'].includes(polarity))
  )
    throw new Error('polarity は kind=cause に positive・negative を指定してください。');
  if (delay !== undefined && (edge.kind !== 'cause' || typeof delay !== 'boolean'))
    throw new Error('delay は kind=cause に boolean を指定してください。');
  for (const value of [sourceMultiplicity, targetMultiplicity]) {
    if (
      value !== undefined &&
      (typeof value !== 'string' || !/^(?:\*|\d+(?:\.\.(?:\d+|\*))?)$/.test(value))
    )
      throw new Error('多重度は 1・0..1・0..*・* などの文字列で指定してください。');
    if (typeof value === 'string' && value.includes('..')) {
      const [lower, upper] = value.split('..');
      if (upper !== '*' && BigInt(lower!) > BigInt(upper!))
        throw new Error('多重度の下限は上限以下にしてください。');
    }
  }
}
/** UML の全体側は source、継承・実現の一般側は target。 */
export function connectionMarker(
  edge: Pick<Connection, 'kind'>,
): 'triangle' | 'diamond' | 'filled-diamond' | 'arrow' {
  if (edge.kind === 'inheritance' || edge.kind === 'realization') return 'triangle';
  if (edge.kind === 'aggregation') return 'diamond';
  if (edge.kind === 'composition') return 'filled-diamond';
  return 'arrow';
}
export function markerPath(marker: ReturnType<typeof connectionMarker>): string {
  return marker === 'triangle'
    ? 'M1 1 L11 6 L1 11 Z'
    : marker === 'diamond' || marker === 'filled-diamond'
      ? 'M1 6 L6 1 L11 6 L6 11 Z'
      : 'M1 1 L11 6 L1 11 Z';
}
