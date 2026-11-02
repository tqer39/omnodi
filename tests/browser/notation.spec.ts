import { test, expect } from './fixtures';
import { resolve } from 'node:path';

for (const offline of [false, true]) {
  test(`汎用図の区画・矢印・分岐・因果編集 (${offline ? 'オフラインHTML' : '開発画面'})`, async ({
    page,
    context,
  }) => {
    if (offline) await context.setOffline(true);
    await page.goto(
      offline
        ? 'file://' + resolve('artifacts/aws.html')
        : `http://127.0.0.1:${process.env.INFRA_TEST_PORT ?? '5188'}`,
    );
    const picker = page.getByRole('combobox', { name: 'サンプル', exact: true });
    await picker.selectOption('uml');
    await expect(page.locator('.layout-status')).toHaveCount(0);
    await page.getByRole('button', { name: 'Fit View' }).click();
    const order = page.locator('.react-flow__node[data-id="order"]');
    await expect(order).toContainText('- status: OrderStatus');
    await expect(order).toContainText('+ confirm(): void');
    await expect(page.locator('.react-flow__edge-path[marker-start]')).toHaveCount(2);
    await order.locator('.resource-label').click();
    const form = page.getByRole('form', { name: 'リソース情報の編集' });
    await form.getByLabel('UML 属性', { exact: true }).fill('+ updated: boolean');
    await form.getByLabel('UML 操作', { exact: true }).focus();
    await expect(order).toContainText('+ updated: boolean');
    await page.getByRole('button', { name: 'DSL を編集', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'DSL 入力' })).toHaveValue(
      /fields=\["\+ updated: boolean"\]/,
    );
    await page.getByRole('button', { name: 'DSL を編集', exact: true }).click();
    await picker.selectOption('business-flow');
    const decision = page.locator('.react-flow__node[data-id="decision"]');
    await expect(decision.locator('[data-shape="diamond"] polygon')).toBeVisible();
    await expect(decision).toContainText('予算内か？');
    // 菱形の本文が中央半分の領域に収まり、接続口が残る。
    const bounds = await decision.boundingBox();
    const text = await decision.locator('.resource-heading').boundingBox();
    expect(text!.x).toBeGreaterThan(bounds!.x + bounds!.width * 0.2);
    expect(text!.x + text!.width).toBeLessThan(bounds!.x + bounds!.width * 0.8);
    await picker.selectOption('causal-loop');
    await expect(page.locator('.layout-status')).toHaveCount(0);
    await page.getByRole('button', { name: 'Fit View' }).click();
    const edge = page.getByRole('button', { name: /口コミ・紹介 → 利用者数: R1 利用者の増加/ });
    await expect(edge).toContainText('+');
    await expect(edge).toContainText('遅延');
    await edge.click();
    await page.locator('.connection-editor summary').click();
    const edgeForm = page.getByRole('form', { name: '接続 edge-2 の編集' });
    await edgeForm.getByLabel('因果の正負', { exact: true }).selectOption('negative');
    await expect(
      page.getByRole('button', { name: /口コミ・紹介 → 利用者数: R1 利用者の増加/ }),
    ).toContainText('−');
    await expect(page.locator('.diagnostics')).toHaveCount(0);
  });
}

for (const offline of [false, true]) {
  test(`菱形・楕円が公開範囲と変更予定・選択状態を保つ (${offline ? 'HTML' : '開発画面'})`, async ({
    page,
    context,
  }) => {
    if (offline) await context.setOffline(true);
    await page.goto(
      offline
        ? 'file://' + resolve('artifacts/aws.html')
        : `http://127.0.0.1:${process.env.INFRA_TEST_PORT ?? '5188'}`,
    );
    await page.getByRole('button', { name: 'DSL を編集', exact: true }).click();
    await page.getByRole('textbox', { name: 'DSL 入力' }).fill(`diagram "外形の属性" {
      flow.decision choice "${'予算と申請条件を確認する長い処理名'.repeat(5)}" exposure=private change=add ports=[input, output]
      flow.start start "開始" exposure=private change=add ports=[input, output]
    }`);
    await page.getByRole('button', { name: '解析して反映', exact: true }).click();
    await page.getByRole('button', { name: 'DSL を編集', exact: true }).click();
    for (const id of ['choice', 'start']) {
      const node = page.locator(`.react-flow__node[data-id="${id}"]`);
      await expect(node.locator('.resource-card')).toHaveCSS(
        'background-color',
        'rgba(0, 0, 0, 0)',
      );
      const outline = node.locator('.notation-outline > *');
      await expect(outline).toHaveCSS('fill', 'rgb(237, 248, 242)');
      await expect(outline).toHaveCSS('stroke', 'rgb(37, 132, 84)');
      await expect(outline).toHaveCSS('stroke-dasharray', '6px, 4px');
      expect(
        await node
          .locator('.resource-label strong')
          .evaluate((el) => el.scrollWidth <= el.clientWidth),
      ).toBe(true);
      const geometry = await node.evaluate((el) => {
        const card = el.querySelector('.resource-card')!.getBoundingClientRect();
        const heading = el.querySelector('.resource-heading')!.getBoundingClientRect();
        return {
          heightFits: heading.height <= card.height / 2,
          offsets: [...el.querySelectorAll('.interface-handle')].map((handle) => {
            const box = handle.getBoundingClientRect();
            const side = handle.classList.contains('react-flow__handle-left')
              ? card.left
              : card.right;
            return Math.abs(box.x + box.width / 2 - side);
          }),
        };
      });
      expect(geometry.heightFits).toBe(true);
      expect(geometry.offsets).toHaveLength(4);
      expect(geometry.offsets.every((offset) => offset < 4)).toBe(true);
      await node.locator('.resource-label').click();
      await expect(outline).toHaveCSS('stroke', 'rgb(25, 135, 121)');
      await page.getByRole('button', { name: '選択を解除', exact: true }).click();
      await expect(outline).toHaveCSS('stroke', 'rgb(37, 132, 84)');
    }
  });
}
