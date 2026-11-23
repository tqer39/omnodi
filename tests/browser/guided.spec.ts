import { resolve } from 'node:path';
import { test, expect, type Page } from './fixtures';

const devServer = () => `http://127.0.0.1:${process.env.INFRA_TEST_PORT ?? '5188'}`;

/** 「新しく作る」から AWS・API・東京だけ・SQL 保存で確認画面まで進む。 */
async function answerApiOnTokyo(page: Page, options: { delivery?: boolean } = {}) {
  await page.getByRole('button', { name: '新しく作る', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: '何を作る予定ですか？' })).toBeFocused();
  const next = dialog.getByRole('button', { name: '次へ', exact: true });
  // 作るものを選ぶまでは先へ進めない。
  await expect(next).toBeDisabled();
  await dialog.getByRole('radio', { name: /^API サーバー/ }).check();
  await next.click();
  await expect(dialog.getByRole('heading', { name: 'どのクラウドで作りますか？' })).toBeVisible();
  await dialog.getByRole('radio', { name: /^AWS/ }).check();
  await next.click();
  await dialog.getByRole('radio', { name: /^東京だけ/ }).check();
  await next.click();
  await expect(dialog.getByRole('radio', { name: /^ECS Fargate/ })).toBeChecked();
  await next.click();
  await expect(dialog.getByRole('heading', { name: 'データを保存しますか？' })).toBeVisible();
  await dialog.getByRole('checkbox', { name: /^RDS for PostgreSQL/ }).check();
  await expect(dialog.getByRole('checkbox', { name: /^保存しない/ })).not.toBeChecked();
  await next.click();
  if (options.delivery)
    await dialog.getByRole('radio', { name: /^GitHub Actions から配備/ }).check();
  await next.click();
  await expect(dialog.getByRole('heading', { name: 'この内容で雛形を作ります' })).toBeVisible();
  return dialog;
}

for (const offline of [false, true])
  test(`質問に答えて雛形を作り、戻る・変更・Undo/Redo で扱える (${offline ? 'HTML' : '開発画面'})`, async ({
    page,
    context,
  }) => {
    if (offline) await context.setOffline(true);
    await page.goto(offline ? 'file://' + resolve('artifacts/aws.html') : devServer());
    const title = page.locator('.document-title');
    const original = await title.textContent();
    const dialog = await answerApiOnTokyo(page);
    const answers = dialog.locator('.wizard-answers');
    await expect(answers).toContainText('API サーバー');
    await expect(answers).toContainText('東京だけ');
    await expect(answers).toContainText('RDS for PostgreSQL');
    await expect(dialog.getByRole('region', { name: '処理の流れ' })).toContainText(
      '利用者のアプリ → API の入口（ALB）',
    );
    await expect(dialog.getByRole('region', { name: '設計上の仮定' })).toContainText(
      'ap-northeast-1',
    );
    await expect(dialog).toContainText('クラウドへの構築や、通信・権限・費用の確認は行いません');

    // 確認画面から回答を変え、確認へ戻ると要約に反映する。
    await dialog.getByRole('button', { name: 'データの保存を変更' }).click();
    await dialog.getByRole('checkbox', { name: /^S3/ }).check();
    await dialog.getByRole('button', { name: '確認へ戻る', exact: true }).click();
    await expect(answers).toContainText('RDS for PostgreSQL、S3');
    await dialog.getByRole('button', { name: '戻る', exact: true }).click();
    await expect(dialog.getByRole('heading', { name: '配備の流れも描きますか？' })).toBeVisible();
    await dialog.getByRole('button', { name: '次へ', exact: true }).click();
    await dialog.getByRole('button', { name: 'この内容で作成', exact: true }).click();

    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(title).toHaveText('API サーバー（AWS・東京）の設計雛形');
    await expect(page.getByRole('region', { name: '3D 構成図' })).toBeVisible();
    await page.getByRole('button', { name: '2D', exact: true }).click();
    await expect(page.locator('.react-flow__node[data-id="entry"]')).toBeVisible();
    await expect(page.locator('.react-flow__node[data-id="database"]')).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: '作成しました' })).toContainText(
      '確認が必要な事項',
    );
    await expect(page.locator('.unresolved-navigation').first()).toContainText('確認が必要な情報');
    await page.getByRole('button', { name: 'DSL を編集', exact: true }).click();
    const editor = page.getByRole('textbox', { name: 'DSL 入力' });
    await expect(editor).toHaveValue(/region tokyo "東京" region="ap-northeast-1"/);
    await expect(editor).toHaveValue(/users -> entry id="request_1" route="request" step=1/);
    await expect(editor).not.toHaveValue(/ap-northeast-3/);

    await page.getByRole('button', { name: '元に戻す', exact: true }).click();
    await expect(title).toHaveText(original!);
    await expect(editor).not.toHaveValue(/request_1/);
    await page.getByRole('button', { name: 'やり直す', exact: true }).click();
    await expect(title).toHaveText('API サーバー（AWS・東京）の設計雛形');
  });

test('質問をキャンセルすると図を変えず、未反映の DSL 下書きがあると作成しない', async ({
  page,
}) => {
  await page.goto(devServer());
  const title = page.locator('.document-title');
  const original = await title.textContent();
  const opener = page.getByRole('button', { name: '新しく作る', exact: true });
  await opener.click();
  await page
    .getByRole('dialog')
    .getByRole('radio', { name: /^静的サイト/ })
    .check();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(opener).toBeFocused();
  await expect(title).toHaveText(original!);
  await opener.click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'キャンセル', exact: true })
    .first()
    .click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // 解析していない下書きは、雛形の作成で上書きしない。
  await page.getByRole('button', { name: 'DSL を編集', exact: true }).click();
  const editor = page.getByRole('textbox', { name: 'DSL 入力' });
  const draft = `${await editor.inputValue()}\n# 未反映の下書き`;
  await editor.fill(draft);
  const dialog = await answerApiOnTokyo(page);
  await expect(dialog.getByRole('alert')).toContainText('未反映の変更があります');
  await expect(dialog.getByRole('button', { name: 'この内容で作成', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: 'キャンセル', exact: true }).first().click();
  await expect(editor).toHaveValue(draft);
  await expect(title).toHaveText(original!);
});

test('処理の流れを再生・一時停止・ステップ移動し、2D と 3D の矢印に沿って粒子を流す', async ({
  page,
}) => {
  await page.goto(devServer());
  const dialog = await answerApiOnTokyo(page, { delivery: true });
  await dialog.getByRole('button', { name: 'この内容で作成', exact: true }).click();
  await page.getByRole('button', { name: '2D', exact: true }).click();
  const flowViewport = page.locator('.react-flow__viewport');
  await flowViewport.evaluate(async () => {
    for (let i = 0; i < 30; i++) await new Promise(requestAnimationFrame);
  });
  const position = await flowViewport.getAttribute('style');

  await page.getByRole('button', { name: '処理の流れ', exact: true }).click();
  const panel = page.getByRole('region', { name: '処理の流れの説明' });
  await expect(panel).toBeFocused();
  await expect(panel).toContainText('ステップ 1 / 6');
  await expect(panel).toContainText('経路 request・往路 1');
  await expect(panel.getByRole('heading')).toHaveText('利用者のアプリ → API の入口（ALB）');
  await expect(panel).toContainText('実際の通信や実行順を観測したものではありません');
  const particles = page.locator('.react-flow__edge[data-id="request_1"] .flow-particles');
  await expect(particles).toHaveAttribute('data-playing', 'true');
  // 粒子は矢印の始点側から終点側へ動く。
  const dot = particles.locator('circle').first();
  const before = Number(await dot.getAttribute('cx'));
  await expect.poll(async () => Number(await dot.getAttribute('cx'))).not.toBe(before);

  const play = panel.getByRole('button', { name: /一時停止/ });
  await play.click();
  await expect(particles).toHaveAttribute('data-playing', 'false');
  await expect(panel.getByRole('button', { name: /再生/ })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await panel.getByRole('button', { name: '次へ →', exact: true }).click();
  await expect(panel).toContainText('ステップ 2 / 6');
  await expect(
    page.locator('.react-flow__edge[data-id="request_2"] .flow-particles'),
  ).toBeAttached();
  await expect(particles).toHaveCount(0);
  await panel.press('ArrowRight');
  await expect(panel.getByRole('heading')).toHaveText(
    'API（ECS Fargate） → 業務データ（RDS for PostgreSQL）',
  );
  await panel.getByRole('combobox', { name: 'ステップへ移動' }).selectOption({ index: 4 });
  await expect(panel).toContainText('経路 delivery・往路 2');
  await expect(panel).toContainText('OIDC');
  // 説明の操作では画面の位置を変えない。
  await expect(flowViewport).toHaveAttribute('style', position!);

  // 3D でも同じステップの配管に沿って粒子を流す。上空の認証経路にも沿う。
  await page.getByRole('button', { name: '3D', exact: true }).click();
  const map = page.getByRole('region', { name: '3D 構成図' });
  const tube = map.locator('.spatial-route.flowing');
  await expect(tube).toHaveAttribute('data-connection-id', 'delivery_2');
  await expect(tube).toHaveAttribute('data-tier', 'air');
  await expect(tube.locator('.flow-particles circle')).toHaveCount(3);
  await panel.getByRole('button', { name: '← 前へ', exact: true }).click();
  await panel.getByRole('button', { name: '← 前へ', exact: true }).click();
  await expect(map.locator('.spatial-route.flowing')).toHaveAttribute('data-tier', 'under');

  // 一括折りたたみで線が隠れても説明を続け、折りたたみを開いて表示できる。
  await page.getByRole('button', { name: '2D', exact: true }).click();
  await page.getByRole('button', { name: 'すべて折りたたむ', exact: true }).click();
  await expect(panel).toContainText('現在の表示（折りたたみ・表示オプション）では描かれていません');
  await panel.getByRole('button', { name: '折りたたみを開いて表示', exact: true }).click();
  await expect(panel.locator('.walkthrough-hidden')).toHaveCount(0);
  await expect(
    page.locator('.react-flow__edge[data-id="request_3"] .flow-particles'),
  ).toBeAttached();

  // 検索で選択しても説明は崩れず、Esc で終了すると粒子を消す。
  const search = page.getByRole('textbox', { name: 'リソース検索' });
  await search.fill('GitHub Actions');
  await page
    .locator('.search-results')
    .getByRole('button', { name: /GitHub Actions/ })
    .click();
  await expect(panel).toContainText('ステップ 3 / 6');
  await panel.focus();
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await expect(page.locator('.flow-particles')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '処理の流れ', exact: true })).toBeFocused();
});

test('視差効果を減らす設定では自動で進めず、画面が非表示になると再生を止める', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(devServer());
  await page.getByRole('button', { name: '処理の流れ', exact: true }).click();
  const panel = page.getByRole('region', { name: '処理の流れの説明' });
  // 順序のない既定の図は、利用者から始まる推定順で説明する。
  await expect(panel).toContainText('順序の指定なし');
  await expect(panel.getByRole('heading')).toHaveText('利用者 → Application Load Balancer');
  const particles = page.locator('.flow-particles');
  await expect(particles).toHaveAttribute('data-reduced', 'true');
  await expect(particles).toHaveAttribute('data-playing', 'false');
  const play = panel.getByRole('button', { name: /再生/ });
  await expect(play).toHaveAttribute('aria-pressed', 'false');

  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await play.click();
  await expect(panel.getByRole('button', { name: /一時停止/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(panel.getByRole('button', { name: /再生/ })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await expect(panel).toContainText('ステップ 1 /');
});

for (const offline of [false, true])
  test(`3D で AWS の公式アイコンを立体のメダリオン、GitHub を Octocat で表す (${offline ? 'HTML' : '開発画面'})`, async ({
    page,
    context,
  }) => {
    if (offline) await context.setOffline(true);
    await page.goto(offline ? 'file://' + resolve('artifacts/aws.html') : devServer());
    await page.getByRole('button', { name: '3D', exact: true }).click();
    const map = page.getByRole('region', { name: '3D 構成図' });
    const api = map.locator('.spatial-solid[data-solid-id="api"]');
    await expect(api).toHaveAttribute('data-emblem', 'aws-logo');
    await expect(api).toHaveAttribute('data-solid-kind', 'container');
    const logo = api.locator('image.spatial-logo');
    if (offline) await expect(logo).toHaveAttribute('href', /^data:image\/svg\+xml/);
    const box = (await logo.boundingBox())!;
    // ラベルの横の小さなアイコンではなく、立体の正面に正方形で載せる。
    expect(Math.abs(box.width - box.height)).toBeLessThan(1);
    expect(box.width).toBeGreaterThan(14);
    expect(
      await logo.evaluate((image) => (image as SVGImageElement).getBBox().width),
    ).toBeGreaterThan(30);
    expect(await api.locator('polygon').count()).toBeGreaterThan(8);

    const repository = map.locator('.spatial-solid[data-solid-id="repository"]');
    // 初期表示は通信経路を優先するため、配備側のキャラクターは全体表示で操作する。
    await map.getByRole('button', { name: '3D マップを全体表示' }).click();
    await expect(repository).toHaveAttribute('data-emblem', 'octocat');
    await expect(repository.locator('title')).toHaveText('tqer39/example（GitHub の Octocat）');
    await expect(map.locator('.spatial-caption[data-resource-id="repository"]')).toContainText(
      'tqer39/example',
    );
    expect(await repository.locator('polygon').count()).toBeGreaterThan(150);
    await expect(repository).toHaveAttribute('data-pose', 'rest');
    await repository.hover();
    await expect(repository).toHaveAttribute('data-pose', 'wave');
    await page.mouse.move(5, 5);
    await expect(repository).toHaveAttribute('data-pose', 'rest');
    await repository.click();
    await expect(repository).toHaveAttribute('data-pose', 'wave');
    await expect(repository).toHaveClass(/selected/);
    const before = await repository.locator('polygon').nth(40).getAttribute('points');
    await map.getByRole('button', { name: '3D マップを右に回転' }).click();
    await expect(repository.locator('polygon').nth(40)).not.toHaveAttribute('points', before!);
    await expect(api.locator('image.spatial-logo')).toBeVisible();
  });
