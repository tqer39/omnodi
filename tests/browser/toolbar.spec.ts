import { test, expect } from './fixtures';
import { selectSavedView } from './display-controls';
import { resolve } from 'node:path';

for (const offline of [false, true]) {
  test(`操作グループが画面幅に応じて折り返し、図や情報欄を覆わない (${offline ? 'HTML' : '開発画面'})`, async ({
    page,
    context,
  }) => {
    if (offline) await context.setOffline(true);
    await page.goto(
      offline
        ? 'file://' + resolve('artifacts/aws.html')
        : `http://127.0.0.1:${process.env.INFRA_TEST_PORT ?? '5188'}`,
    );
    await expect(page.locator('.layout-status')).toHaveCount(0);
    const toolbar = page.getByRole('group', { name: '図の操作', exact: true });
    for (const name of ['表示', '境界の一括操作', '配置', '接続・囲み', '検索・選択']) {
      await expect(toolbar.getByRole('group', { name, exact: true })).toBeVisible();
    }
    await expect(page.getByRole('group', { name: 'ファイル', exact: true })).toBeVisible();
    await expect(page.getByRole('group', { name: '編集・相談', exact: true })).toBeVisible();
    const connections = toolbar.getByRole('group', { name: '接続・囲み', exact: true });
    const legend = connections.locator('.edge-legend');
    await expect(legend).toBeHidden();
    await connections.locator('.connection-help summary').click();
    await expect(legend).toBeVisible();
    await expect(legend.locator('.edge-legend-item')).toHaveCount(13);
    await connections.locator('.connection-help summary').click();
    await expect(legend).toBeHidden();
    await expect(connections.locator('.connection-help summary')).toBeVisible();
    await expect(toolbar.getByRole('group', { name: '構成情報', exact: true })).toBeVisible();
    await expect(page.locator('.canvas-area > .canvas-footer')).toHaveCount(0);
    for (const width of [1440, 900, 640]) {
      await page.setViewportSize({ width, height: 900 });
      const toolbarBounds = (await toolbar.boundingBox())!;
      if (width === 1440) expect(toolbarBounds.height).toBeLessThanOrEqual(100);
      const info = (await page.getByRole('group', { name: '構成情報' }).boundingBox())!;
      const canvas = (await page.locator('.canvas-area > .react-flow').boundingBox())!;
      expect(info.y).toBeGreaterThanOrEqual(toolbarBounds.y);
      expect(toolbarBounds.y + toolbarBounds.height).toBeLessThanOrEqual(canvas.y);
      expect(info.y + info.height).toBeLessThanOrEqual(canvas.y);
      expect(canvas.height).toBeGreaterThan(250);
      const area = (await page.locator('.canvas-area').boundingBox())!;
      for (const control of await toolbar
        .locator('button:visible, input:visible, select:visible')
        .all()) {
        const bounds = (await control.boundingBox())!;
        expect(bounds.x).toBeGreaterThanOrEqual(area.x);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(area.x + area.width);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      );
    }
    // カスタムビューが加わってもグループ内で折り返す。
    await page
      .getByRole('combobox', { name: 'サンプル', exact: true })
      .selectOption('architecture');
    await selectSavedView(page, 'data');
    await expect(page.locator('.canvas-footer')).toContainText('1 接続');
    await page.screenshot({ path: `artifacts/toolbar-${offline ? 'offline' : 'dev'}-narrow.png` });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.screenshot({ path: `artifacts/toolbar-${offline ? 'offline' : 'dev'}.png` });
  });
}

for (const offline of [false, true]) {
  test(`矢印を直接切り替え、機能名の表示設定を保持する (${offline ? 'HTML' : '開発画面'})`, async ({
    page,
    context,
  }) => {
    if (offline) await context.setOffline(true);
    await page.goto(
      offline
        ? 'file://' + resolve('artifacts/aws.html')
        : `http://127.0.0.1:${process.env.INFRA_TEST_PORT ?? '5188'}`,
    );
    await expect(page.locator('.layout-status')).toHaveCount(0);
    const shape = page.getByRole('combobox', { name: '矢印の形', exact: true });
    const options = page.getByRole('region', { name: '表示オプション', exact: true });
    await expect(options).toBeHidden();
    await expect(shape).toBeVisible();
    const viewport = page.locator('.react-flow__viewport');
    await viewport.evaluate(async () => {
      for (let i = 0; i < 35; i++) await new Promise(requestAnimationFrame);
    });
    const position = await viewport.getAttribute('style');
    const edge = page.locator('.react-flow__edge-path').first();
    const straight = await edge.getAttribute('d');
    await shape.selectOption('bezier');
    await expect(edge).not.toHaveAttribute('d', straight!);
    expect(await viewport.getAttribute('style')).toBe(position);
    await page.getByRole('button', { name: '元に戻す', exact: true }).click();
    await expect(shape).toHaveValue('orthogonal');
    await page.getByRole('button', { name: 'やり直す', exact: true }).click();
    await expect(shape).toHaveValue('bezier');
    const settings = page.getByRole('button', { name: '表示オプション', exact: true });
    await settings.click();
    await options.getByRole('checkbox', { name: '機能名を表示', exact: true }).uncheck();
    await expect(page.locator('.app-shell')).toHaveAttribute('data-action-labels', 'false');
    await settings.click();
    const move = page.getByRole('button', { name: '配置を移動', exact: true });
    await expect(move).toHaveAttribute('title', 'ノードを移動し、DSLへ位置を保存します');
    await move.click();
    const finish = page.getByRole('button', { name: '移動を完了', exact: true });
    await expect(finish).toHaveAttribute('title', '移動を完了してレイアウト編集を終了します');
    await expect(finish).toHaveAttribute('aria-pressed', 'true');
    await finish.click();
    await expect(move).toHaveAttribute('aria-pressed', 'false');
    const edit = page.getByRole('button', { name: 'DSL を編集', exact: true });
    await expect(edit.locator('svg')).toBeVisible();
    await expect(edit).toHaveAttribute('title', 'DSL を編集');
    await edit.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('textbox', { name: 'DSL 入力', exact: true })).toBeVisible();
    await page.reload();
    await expect(page.locator('.app-shell')).toHaveAttribute('data-action-labels', 'false');
    await settings.click();
    await options.getByRole('checkbox', { name: '機能名を表示', exact: true }).check();
    await expect(page.locator('.app-shell')).toHaveAttribute('data-action-labels', 'true');
  });
}
