import { it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parseDSL,
  serializeDSL,
  validateDiagram,
  buildDisplayGraph,
  layoutGraph,
  exportSVG,
  connectionLabel,
  isBoundary,
} from '../src/core/index.js';
import { resourceContent } from '../src/core/content.js';

for (const name of ['uml', 'business-flow', 'causal-loop']) {
  it(`${name}: DSL/JSONの往復・全要素の配置・SVG出力を保つ`, async () => {
    const result = parseDSL(readFileSync(`examples/${name}.infra`, 'utf8'));
    assert.deepEqual(result.diagnostics, []);
    const diagram = validateDiagram(result.diagram);
    const again = validateDiagram(parseDSL(serializeDSL(diagram)).diagram);
    assert.deepEqual(
      again.resources.map((r) => [r.id, r.type, r.attributes, r.parentId]),
      diagram.resources.map((r) => [r.id, r.type, r.attributes, r.parentId]),
    );
    assert.deepEqual(
      again.connections.map((e) => [e.kind, e.attributes]),
      diagram.connections.map((e) => [e.kind, e.attributes]),
    );
    const graph = buildDisplayGraph(again, { view: 'service' });
    const layout = await layoutGraph(graph);
    assert.equal(layout.nodes.length, graph.resources.length);
    assert.ok(layout.nodes.every((n) => Number.isFinite(n.x) && n.width > 0 && n.height > 0));
    const svg = await exportSVG(again, { view: 'service' });
    assert.doesNotMatch(svg, /foreignObject|<script/);
    if (name === 'uml') {
      assert.ok(isBoundary(again.resources.find((r) => r.id === 'app')!));
      assert.equal(resourceContent(again.resources.find((r) => r.id === 'order')!)?.kind, 'table');
      assert.match(svg, /OrderStatus/);
      assert.match(svg, /marker-start=/);
      assert.match(svg, /fill="#fff" stroke="#596579"/);
    }
    if (name === 'business-flow') assert.match(svg, /<polygon points=/);
    if (name === 'causal-loop') {
      assert.match(connectionLabel(again.connections[1]!), /\+.*遅延/);
      assert.match(svg, /−/);
      assert.equal(again.connections.filter((e) => e.kind === 'cause').length, 6);
    }
  });
}

for (const [statement, expected] of [
  ['uml.package a shape=ellipse', /shape/],
  ['uml.class a\numl.class b\na -> b kind=composition targetMultiplicity="5..1"', /下限/],
  ['uml.class a fields="oops"', /fields/],
  ['uml.class a display=list items=[x]', /fields/],
  ['flow.activity a shape=triangle', /shape/],
  ['flow.activity a\nflow.activity b\na -> b kind=flow polarity=positive', /polarity/],
  ['causal.variable a\ncausal.variable b\na -> b kind=cause polarity=neutral', /polarity/],
  ['causal.variable a\ncausal.variable b\na -> b kind=cause delay="yes"', /delay/],
  ['uml.class a\numl.class b\na -> b kind=composition targetMultiplicity="many"', /多重度/],
] as const) {
  it(`不正な汎用図記法を拒否: ${statement}`, () => {
    const result = parseDSL(`diagram "検証" {\n${statement}\n}`);
    assert.equal(result.diagram, undefined);
    assert.match(result.diagnostics.map((d) => d.message).join('\n'), expected);
  });
}

it('JSONからの入力も同じ因果属性の制約で拒否する', () => {
  const diagram = parseDSL(
    'diagram "test" {\ncausal.variable a\ncausal.variable b\na -> b kind=cause\n}',
  ).diagram!;
  diagram.connections[0]!.attributes.polarity = ['positive'];
  assert.throws(() => validateDiagram(diagram), /polarity/);
  delete diagram.connections[0]!.attributes.polarity;
  diagram.connections[0]!.attributes.delay = 'true';
  assert.throws(() => validateDiagram(diagram), /delay/);
});

it('SVGの凡例は実現の破線と継承・集約・合成のマーカーを区別する', async () => {
  const diagram = parseDSL('diagram "凡例" {\nflow.activity a\n}').diagram!;
  const svg = await exportSVG(diagram);
  const legend = (kind: string) =>
    svg.match(new RegExp(`<g data-legend-kind="${kind}">(.*?)</g>`))![1]!;
  assert.match(legend('realization'), /stroke-dasharray="6 4"/);
  assert.match(legend('inheritance'), /M1 1 L11 6 L1 11 Z.*fill="#fff"/);
  assert.match(legend('aggregation'), /M1 6 L6 1 L11 6 L6 11 Z.*fill="#fff"/);
  assert.match(legend('composition'), /M1 6 L6 1 L11 6 L6 11 Z.*fill="#596579"/);
});
