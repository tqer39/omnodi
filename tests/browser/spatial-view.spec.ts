import { resolve } from 'node:path';
import { toggleArrowShape, toggleMembership } from './display-controls';
import { test, expect, type Page } from './fixtures';

const devServer = () => `http://127.0.0.1:${process.env.INFRA_TEST_PORT ?? '5188'}`;
async function openSample(page: Page, sample: string) {
  await page.goto(devServer());
  await page.getByRole('combobox', { name: 'サンプル', exact: true }).selectOption(sample);
  await page.getByRole('button', { name: '3D', exact: true }).click();
  return page.getByRole('region', { name: '3D 構成図' });
}

for (const offline of [false, true]) {
  test(`3D で同じ構成を探索し、2D と 3D の表示位置を保持する (${offline ? 'HTML' : '開発画面'})`, async ({
    page,
    context,
  }) => {
    if (offline) await context.setOffline(true);
    await page.goto(offline ? 'file://' + resolve('artifacts/aws.html') : devServer());
    const projection = page.getByRole('group', { name: '図の投影' });
    const twoDimensional = projection.getByRole('button', { name: '2D', exact: true });
    const threeDimensional = projection.getByRole('button', { name: '3D', exact: true });
    const flow = page.locator('.react-flow');
    const flowViewport = flow.locator('.react-flow__viewport');
    const map = page.getByRole('region', { name: '3D 構成図' });
    const world = map.locator('.spatial-world');
    await expect(twoDimensional).toHaveAttribute('aria-pressed', 'true');
    await expect(flow.locator('[data-id="api"]')).toBeVisible();
    await expect(map).toBeHidden();
    await flow.getByRole('button', { name: 'Zoom In', exact: true }).click();
    await flowViewport.evaluate(async () => {
      for (let i = 0; i < 30; i++) await new Promise(requestAnimationFrame);
    });
    const position2D = await flowViewport.getAttribute('style');

    await threeDimensional.click();
    await expect(flow).toBeHidden();
    // 境界は高さのある台座、リソースは機能ごとの立体として描く。
    await expect(map.locator('.spatial-slab[data-slab-id="prod"] polygon').first()).toBeVisible();
    expect(await map.locator('.spatial-slab[data-slab-id="prod"] polygon').count()).toBeGreaterThan(
      2,
    );
    for (const [id, kind] of [
      ['api', 'container'],
      ['db', 'database'],
      ['web', 'loadBalancer'],
      ['users', 'user'],
      ['actions', 'cicd'],
      ['deploy_role', 'identity'],
      ['uploads', 'storage'],
    ])
      await expect(map.locator(`.spatial-solid[data-solid-id="${id}"]`)).toHaveAttribute(
        'data-solid-kind',
        kind,
      );
    await expect(map.locator('[data-resource-id="prod"]')).toContainText('111111111111');
    await expect(map.locator('[data-resource-id="tokyo"]')).toContainText('ap-northeast-1');
    await expect(map.locator('[data-resource-id="main"]')).toContainText('10.0.0.0/16');

    // 通信は床下、認証・デプロイは立体より上空を通す。
    const route = (source: string, target: string) =>
      map.getByRole('button', { name: new RegExp(`^${source} → ${target}:`) });
    const tierOf = async (source: string, target: string) => {
      const label = route(source, target);
      return label.getAttribute('data-tier');
    };
    expect(await tierOf('ECS API', 'PostgreSQL')).toBe('under');
    expect(await tierOf('GitHub Actions', 'デプロイ IAM Role')).toBe('air');
    expect(await tierOf('デプロイ IAM Role', 'ECS API')).toBe('air');
    const authTube = map
      .locator('.spatial-layer-air .spatial-route[data-kind="auth"] > path')
      .first();
    const roleSolid = map.locator('.spatial-solid[data-solid-id="deploy_role"]');
    const [tubeBox, roleBox] = [(await authTube.boundingBox())!, (await roleSolid.boundingBox())!];
    expect(tubeBox.y).toBeLessThan(roleBox.y);
    await expect(map.locator('.spatial-air-shadow').first()).toBeAttached();
    await expect(map.locator('.spatial-port').first()).toBeAttached();

    const search = page.getByRole('textbox', { name: 'リソース検索' });
    await search.fill('ECS API');
    await page
      .locator('.search-results')
      .getByRole('button', { name: /ECS API/ })
      .click();
    const api = map.getByRole('button', { name: 'ECS API', exact: true });
    await expect(api).toHaveAttribute('aria-pressed', 'true');
    await expect(api).toBeInViewport();
    await expect(map.locator('.spatial-solid[data-solid-id="api"]')).toHaveClass(/selected/);
    await expect(page.locator('.detail-panel')).toContainText('ECS API');
    await page.getByRole('button', { name: '選択を解除', exact: true }).click();
    await api.click();
    await expect(api).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: '選択を解除', exact: true }).click();
    await api.press('Enter');
    await expect(api).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('form', { name: 'リソース情報の編集' })).toBeVisible();
    // 立体そのものをクリックしても同じリソースを選択する。
    await search.fill('PostgreSQL');
    await page
      .locator('.search-results')
      .getByRole('button', { name: /PostgreSQL/ })
      .click();
    await page.getByRole('button', { name: '選択を解除', exact: true }).click();
    await map.locator('.spatial-solid[data-solid-id="db"]').click();
    await expect(map.getByRole('button', { name: 'PostgreSQL', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await search.fill('ECS API');
    await page
      .locator('.search-results')
      .getByRole('button', { name: /ECS API/ })
      .click();

    await map.getByRole('button', { name: '3D マップを全体表示' }).click();
    const fitted = await world.getAttribute('style');
    const bounds = (await map.boundingBox())!;
    await page.mouse.move(bounds.x + 45, bounds.y + 45);
    await page.mouse.down();
    await page.mouse.move(bounds.x + 105, bounds.y + 70, { steps: 4 });
    await page.mouse.up();
    await expect(world).not.toHaveAttribute('style', fitted!);
    await expect(api).toHaveAttribute('aria-pressed', 'true');
    const panned = await world.getAttribute('style');
    await page.mouse.wheel(45, 0);
    await expect(world).not.toHaveAttribute('style', panned!);
    const afterHorizontalWheel = await world.getAttribute('style');
    await map.getByRole('button', { name: '3D マップを拡大' }).click();
    await expect(world).not.toHaveAttribute('style', afterHorizontalWheel!);
    const position3D = await world.getAttribute('style');

    const traffic = map.getByRole('button', { name: /ECS API → PostgreSQL:.*5432/ });
    await traffic.press('Enter');
    await expect(traffic).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.detail-panel')).toContainText('5432');
    const edge = map.locator('[data-connection-id] > path').first();
    const straight = await edge.getAttribute('d');
    await toggleArrowShape(page);
    await expect(edge).not.toHaveAttribute('d', straight!);
    await expect(world).toHaveAttribute('style', position3D!);

    await page.getByRole('button', { name: 'すべて折りたたむ', exact: true }).click();
    await expect(map.locator('.spatial-slab')).toHaveCount(0);
    await expect(map.locator('.spatial-solid[data-solid-kind="collapsed"]').first()).toBeVisible();
    await expect(api).toHaveCount(0);
    await expect(world).toHaveAttribute('style', position3D!);
    await page.getByRole('button', { name: 'すべて展開する', exact: true }).click();
    await expect(api).toHaveCount(1);

    await twoDimensional.click();
    await expect(map).toBeHidden();
    await expect(flow.locator('[data-id="api"]')).toBeVisible();
    await expect(flowViewport).toHaveAttribute('style', position2D!);
    await threeDimensional.click();
    await expect(world).toHaveAttribute('style', position3D!);
  });
}

test('3D の視点を回転しても選択と名札を保ち、既定の向きへ戻せる', async ({ page }) => {
  const map = await openSample(page, 'aws');
  const drawing = map.locator('svg.spatial-drawing');
  const api = map.getByRole('button', { name: 'ECS API', exact: true });
  await api.click();
  const yaw = await drawing.getAttribute('data-yaw');
  const pitch = await drawing.getAttribute('data-pitch');
  const solid = map.locator('.spatial-solid[data-solid-id="api"] polygon').last();
  const before = await solid.getAttribute('points');
  await map.getByRole('button', { name: '3D マップを右に回転' }).click();
  await expect(drawing).not.toHaveAttribute('data-yaw', yaw!);
  await expect(solid).not.toHaveAttribute('points', before!);
  await map.getByRole('button', { name: '3D マップを見下ろす' }).click();
  await expect(drawing).not.toHaveAttribute('data-pitch', pitch!);
  await expect(api).toHaveAttribute('aria-pressed', 'true');

  // Shift キーを押したドラッグはパンではなく回転にする。
  const world = map.locator('.spatial-world');
  const style = await world.getAttribute('style');
  const rotated = await drawing.getAttribute('data-yaw');
  const box = (await map.boundingBox())!;
  await page.keyboard.down('Shift');
  await page.mouse.move(box.x + 60, box.y + 60);
  await page.mouse.down();
  await page.mouse.move(box.x + 160, box.y + 60, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await expect(drawing).not.toHaveAttribute('data-yaw', rotated!);
  await expect(api).toHaveAttribute('aria-pressed', 'true');
  expect(await world.getAttribute('style')).not.toBe(style);

  await map.getByRole('button', { name: '3D マップの向きを戻す' }).click();
  await expect(drawing).toHaveAttribute('data-yaw', yaw!);
  await expect(drawing).toHaveAttribute('data-pitch', pitch!);
});

test('3D で境界の見出しと接続ラベルを個別にクリックできる', async ({ page }) => {
  const map = await openSample(page, 'architecture');
  const boundary = map.getByRole('button', { name: 'AZ A', exact: true });
  await boundary.click();
  await expect(boundary).toHaveAttribute('aria-pressed', 'true');
  await expect(map.locator('.spatial-slab[data-slab-id="az_a"]')).toHaveClass(/related/);
  const response = map.getByRole('button', { name: /^DB Primary → API A:.*応答/ });
  await response.click();
  await expect(response).toHaveAttribute('aria-pressed', 'true');

  await toggleMembership(page);
  await expect(map.locator('.spatial-overlay-label')).toHaveText([
    'API の冗長化グループ',
    'バックエンドの信頼境界',
  ]);
  await expect(map.locator('.spatial-fence')).toHaveCount(2);
  await map.getByRole('button', { name: 'AZ Aを折りたたむ', exact: true }).click();
  await expect(map.getByRole('button', { name: 'API A', exact: true })).toHaveCount(0);
});

test('3D で UML・注記・未知の種別も内容を失わずに表示する', async ({ page }) => {
  const uml = await openSample(page, 'uml');
  // UML のクラスは汎用の立体と、属性・操作の表を持つ名札で表す。
  await expect(uml.locator('.spatial-solid[data-solid-id="order"]')).toHaveAttribute(
    'data-solid-kind',
    'generic',
  );
  await expect(uml.locator('.spatial-caption[data-resource-id="order"]')).toContainText('confirm');
  expect(await uml.locator('.spatial-caption').count()).toBe(
    await uml.locator('.spatial-solid').count(),
  );
  await expect(uml.locator('.spatial-layer-surface .spatial-route').first()).toBeAttached();

  const expressions = await openSample(page, 'expressions');
  await expect(expressions.locator('.spatial-note')).toHaveCount(2);
  await expect(expressions.locator('.spatial-note').first()).toBeVisible();
  await expect(expressions.locator('.spatial-solid[data-solid-id="jobs"]')).toHaveAttribute(
    'data-solid-kind',
    'queue',
  );
  await expect(expressions.locator('.spatial-solid[data-solid-id="legacy"]')).toHaveAttribute(
    'data-solid-kind',
    'generic',
  );
});

for (const offline of [false, true]) {
  test(`右ドラッグ後も拡大と空ラベル接続のキーボード選択ができる (${offline ? 'HTML' : '開発画面'})`, async ({
    page,
    context,
  }) => {
    if (offline) await context.setOffline(true);
    await page.goto(offline ? 'file://' + resolve('artifacts/aws.html') : devServer());
    await page.locator('input[type=file]').setInputFiles({
      name: 'empty-label.infra',
      mimeType: 'text/plain',
      buffer: Buffer.from(
        'diagram "空ラベル" {\n aws.ec2 a "計算機"\n aws.rds b "DB"\n a -> b label=""\n}',
      ),
    });
    await page.getByRole('button', { name: '3D', exact: true }).click();
    const map = page.getByRole('region', { name: '3D 構成図' });
    await expect(map.locator('.spatial-solid')).toHaveCount(2);
    const drawing = map.locator('.spatial-drawing');
    const initialYaw = await drawing.getAttribute('data-yaw');
    const box = (await map.boundingBox())!;
    const rotate = async () => {
      await page.mouse.move(box.x + 50, box.y + 45);
      await page.mouse.down({ button: 'right' });
      await page.mouse.move(box.x + 110, box.y + 45, { steps: 4 });
      await page.mouse.up({ button: 'right' });
    };
    await rotate();
    await expect(drawing).not.toHaveAttribute('data-yaw', initialYaw!);
    const world = map.locator('.spatial-world');
    const before = await world.getAttribute('style');
    await map.getByRole('button', { name: '3D マップを拡大' }).click();
    await expect(world).not.toHaveAttribute('style', before!);

    await rotate();
    const connection = map.getByRole('button', { name: '計算機 → DB: ', exact: true });
    await connection.focus();
    await page.keyboard.press('Enter');
    await expect(connection).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.detail-panel')).toContainText('接続元 → 接続先');

    const scale = () =>
      world.evaluate((element) => new DOMMatrix(getComputedStyle(element).transform).a);
    const zoom = await scale();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(2, 100);
    await expect.poll(scale).toBeLessThan(zoom);
  });
}
