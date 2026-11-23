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
