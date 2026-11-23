import { test, expect, type Page } from './fixtures';

async function createApi(page: Page) {
  await page.goto(`http://127.0.0.1:${process.env.INFRA_TEST_PORT ?? '5188'}`);
  await page.getByRole('button', { name: '新しく作る', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('radio', { name: /^API サーバー/ }).check();
  for (let index = 0; index < 4; index++)
    await dialog.getByRole('button', { name: '次へ', exact: true }).click();
  await dialog.getByRole('checkbox', { name: /^RDS/ }).check();
  await dialog.getByRole('button', { name: '次へ', exact: true }).click();
  await dialog.getByRole('radio', { name: /^GitHub Actions/ }).check();
  await dialog.getByRole('button', { name: '次へ', exact: true }).click();
  await dialog.getByRole('button', { name: 'この内容で作成', exact: true }).click();
  await expect(page.getByRole('region', { name: '3D 構成図' })).toBeVisible();
}

test('作成直後の 3D は ALB・ECS・RDS を大きく収め、全体ボタンで全体を収める', async ({ page }) => {
  await createApi(page);
  const map = page.getByRole('region', { name: '3D 構成図' });
  const world = map.locator('.spatial-world');
  const scale = () =>
    world.evaluate(async (element) => {
      for (let frame = 0; frame < 10; frame++) await new Promise(requestAnimationFrame);
      return new DOMMatrix(getComputedStyle(element).transform).a;
    });
  const initial = await scale();
  const bounds = (await map.boundingBox())!;
  // API の入口（ALB）・API（ECS）・業務データ（RDS）の立体と名札が、すべて地図の中にある。
  const core = { entry: 'loadBalancer', app: 'container', database: 'database' };
  for (const [id, kind] of Object.entries(core)) {
    const caption = map.locator(`.spatial-caption[data-resource-id="${id}"]`);
    await expect(caption).toHaveAttribute('data-solid-kind', kind);
    for (const item of [caption, map.locator(`.spatial-solid[data-solid-id="${id}"]`)]) {
      const box = (await item.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(bounds.x);
      expect(box.y).toBeGreaterThanOrEqual(bounds.y);
      expect(box.x + box.width).toBeLessThanOrEqual(bounds.x + bounds.width);
      expect(box.y + box.height).toBeLessThanOrEqual(bounds.y + bounds.height);
    }
  }
  // 主要部分は左上に寄せず、地図の中央付近に置く。
  const centers = await Promise.all(
    Object.keys(core).map(async (id) => {
      const box = (await map.locator(`.spatial-solid[data-solid-id="${id}"]`).boundingBox())!;
      return box.x + box.width / 2;
    }),
  );
  const middle = (Math.min(...centers) + Math.max(...centers)) / 2;
  expect(Math.abs(middle - (bounds.x + bounds.width / 2))).toBeLessThan(bounds.width * 0.2);
  // 名札の名前（13px）が潰れない大きさを保つ。
  const name = map.locator('.spatial-caption[data-resource-id="app"] .resource-text strong');
  expect((await name.boundingBox())!.height).toBeGreaterThanOrEqual(8);

  await map.getByRole('button', { name: '3D マップを全体表示' }).click();
  const overview = await scale();
  // 初期表示は全体表示より本当に大きい（同じ倍率への後退を許さない）。
  expect(overview).toBeLessThan(initial);
  for (const item of await map
    .locator('.spatial-caption, .spatial-header, .spatial-edge-label')
    .all()) {
    const box = (await item.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(bounds.x - 1);
    expect(box.y).toBeGreaterThanOrEqual(bounds.y - 1);
    expect(box.x + box.width).toBeLessThanOrEqual(bounds.x + bounds.width + 1);
    expect(box.y + box.height).toBeLessThanOrEqual(bounds.y + bounds.height + 1);
  }
});

test('通信経路のない大きな図でも、3D の初期表示に実際の立体と名札を表示する', async ({ page }) => {
  await page.goto(`http://127.0.0.1:${process.env.INFRA_TEST_PORT ?? '5188'}`);
  const resources = Array.from(
    { length: 120 },
    (_, index) => `  aws.ec2 server_${index} "サーバー ${index}"`,
  ).join('\n');
  await page.locator('input[type=file]').setInputFiles({
    name: 'many.infra',
    mimeType: 'text/plain',
    buffer: Buffer.from(`diagram "通信経路のない大きな図" version=1 {\n${resources}\n}`),
  });
  await page.getByRole('button', { name: '3D', exact: true }).click();
  const map = page.getByRole('region', { name: '3D 構成図' });
  const scale = await map.locator('.spatial-world').evaluate(async (element) => {
    for (let frame = 0; frame < 10; frame++) await new Promise(requestAnimationFrame);
    return new DOMMatrix(getComputedStyle(element).transform).a;
  });
  // 全体を縮小せず、名札を読める倍率で表示する。
  expect(scale).toBeCloseTo(0.9, 5);
  const bounds = (await map.boundingBox())!;
  const shown = [];
  for (const caption of await map.locator('.spatial-caption').all()) {
    const box = await caption.boundingBox();
    if (
      box &&
      box.x >= bounds.x &&
      box.y >= bounds.y &&
      box.x + box.width <= bounds.x + bounds.width &&
      box.y + box.height <= bounds.y + bounds.height
    )
      shown.push(box);
  }
  expect(shown.length).toBeGreaterThan(0);
});

test('質問中はフォーカスと履歴操作を質問画面に留める', async ({ page }) => {
  await createApi(page);
  const title = page.locator('.document-title');
  const createdTitle = await title.textContent();
  const opener = page.getByRole('button', { name: '新しく作る', exact: true });
  await opener.click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('heading', { name: '何を作る予定ですか？' }).focus();
  await page.keyboard.press('Control+z');
  await expect(title).toHaveText(createdTitle!);
  for (const key of ['Shift+Tab', 'Tab']) {
    for (let index = 0; index < 12; index++) {
      await page.keyboard.press(key);
      await expect
        .poll(() => dialog.evaluate((element) => element.contains(document.activeElement)))
        .toBe(true);
    }
  }
  await page.keyboard.press('Escape');
  await expect(opener).toBeFocused();
  await expect(title).toHaveText(createdTitle!);
});

test('説明文と操作を枠内に表示し、再生中に動きを抑える設定へ変えると停止する', async ({ page }) => {
  await createApi(page);
  await page.getByRole('button', { name: '処理の流れを再生', exact: true }).click();
  const panel = page.getByRole('region', { name: '処理の流れの説明' });
  await expect(panel).toHaveAttribute('data-playing', 'true');
  await expect
    .poll(() => panel.evaluate((element) => element.scrollWidth <= element.clientWidth))
    .toBe(true);
  const bounds = (await panel.boundingBox())!;
  const close = (await panel
    .getByRole('button', { name: '説明を終了', exact: true })
    .boundingBox())!;
  expect(close.x + close.width).toBeLessThanOrEqual(bounds.x + bounds.width);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(panel).toHaveAttribute('data-playing', 'false');
  await expect(panel.getByRole('button', { name: /再生/ })).toBeDisabled();
  await panel.press('Space');
  await expect(panel).toHaveAttribute('data-playing', 'false');
  const map = page.getByRole('region', { name: '3D 構成図' });
  await expect(map.locator('.flow-particles')).toHaveAttribute('data-playing', 'false');
  await panel.getByRole('button', { name: '説明を終了', exact: true }).click();
  await expect(page.locator('.flow-particles')).toHaveCount(0);
});

test('履歴で別の図へ戻ると処理説明を終了する', async ({ page }) => {
  await createApi(page);
  await page.getByRole('button', { name: '処理の流れを再生', exact: true }).click();
  await expect(page.getByRole('region', { name: '処理の流れの説明' })).toBeVisible();
  await page.getByRole('button', { name: '元に戻す', exact: true }).click();
  await expect(page.getByRole('region', { name: '処理の流れの説明' })).toHaveCount(0);
  await expect(page.locator('.flow-particles')).toHaveCount(0);
});

test('同じ図でも履歴操作で説明中の接続がなくなると終了する', async ({ page }) => {
  await page.goto(`http://127.0.0.1:${process.env.INFRA_TEST_PORT ?? '5188'}`);
  await page.locator('input[type=file]').setInputFiles({
    name: 'flow-history.infra',
    mimeType: 'text/plain',
    buffer: Buffer.from(`diagram "接続の履歴" version=1 {
  external.user users "利用者"
  aws.ec2 app "API"
  users -> app
}`),
  });
  await page.locator('.react-flow__node[data-id="app"] .resource-label').click();
  await page
    .getByRole('region', { name: '次に追加するリソース' })
    .getByRole('button', { name: 'S3 を追加', exact: true })
    .click();
  await page.getByRole('button', { name: '処理の流れ', exact: true }).click();
  const panel = page.getByRole('region', { name: '処理の流れの説明' });
  await panel.getByRole('combobox', { name: 'ステップへ移動' }).selectOption({ index: 1 });
  await expect(panel.getByRole('heading')).toHaveText('API → S3');
  await page.getByRole('button', { name: '元に戻す', exact: true }).click();
  await expect(panel).toHaveCount(0);
  await expect(page.locator('.flow-particles')).toHaveCount(0);
});

for (const mode of ['2D', '3D']) {
  test(`説明から詳細範囲を解除してもパン・ズームを保持する（${mode}）`, async ({ page }) => {
    await createApi(page);
    await page.getByRole('button', { name: mode, exact: true }).click();
    await page.getByRole('textbox', { name: 'リソース検索' }).fill('アプリケーション VPC');
    await page.locator('.search-results button').first().click();
    await page.getByRole('button', { name: '詳細へ移動', exact: true }).click();
    await expect(page.locator('.scope-bar')).toBeVisible();
    await page.getByRole('button', { name: '処理の流れ', exact: true }).click();
    const panel = page.getByRole('region', { name: '処理の流れの説明' });
    await panel.getByRole('button', { name: /一時停止/ }).click();
    const world = page.locator(mode === '2D' ? '.react-flow__viewport' : '.spatial-world');
    const transform = () =>
      world.evaluate(async (element) => {
        for (let frame = 0; frame < 35; frame++) await new Promise(requestAnimationFrame);
        return getComputedStyle(element).transform;
      });
    await transform();
    await page.mouse.move(500, 360);
    await page.mouse.wheel(120, 0);
    await page.mouse.wheel(0, 70);
    const before = await transform();
    await panel.getByRole('button', { name: '折りたたみを開いて表示', exact: true }).click();
    await expect(page.locator('.scope-bar')).toHaveCount(0);
    await expect(panel.locator('.walkthrough-hidden')).toHaveCount(0);
    expect(await transform()).toBe(before);
    // 視点の移動は専用ボタンで明示的に行う。
    await panel.getByRole('button', { name: '画面に表示', exact: true }).click();
    await expect.poll(transform).not.toBe(before);
  });
}
