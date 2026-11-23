import { test, expect, type Page } from './fixtures';
import { toggleMembership } from './display-controls';

async function load(page: Page, source?: string) {
  await page.goto(`http://127.0.0.1:${process.env.INFRA_TEST_PORT ?? '5188'}`);
  if (source)
    await page
      .locator('input[type=file]')
      .setInputFiles({ name: 'review.infra', mimeType: 'text/plain', buffer: Buffer.from(source) });
  await page.getByRole('button', { name: '3D', exact: true }).click();
  return page.getByRole('region', { name: '3D 構成図' });
}

test('未知の型も表示し、選択から外れた床下経路を淡くする', async ({ page }) => {
  const map = await load(
    page,
    `diagram "未知の型" {
  constructor a "未知の型 A"
  external.service b "B"
  external.service c "C"
  a -> b id=ab label="最初"
  b -> c id=bc label="次"
}`,
  );
  await expect(map.locator('[data-solid-id="a"]')).toHaveAttribute('data-solid-kind', 'generic');
  await map.getByRole('button', { name: '未知の型 A → B: 最初', exact: true }).click();
  const opacity = await map
    .locator('[data-connection-id="bc"]')
    .evaluate((element) => Number(getComputedStyle(element).opacity));
  expect(opacity).toBeLessThan(0.5);
  const ports = await map
    .locator('.spatial-port')
    .evaluateAll((elements) =>
      elements.map((element) => Number(getComputedStyle(element).opacity)),
    );
  expect(Math.min(...ports)).toBeLessThan(0.25);
  expect(Math.max(...ports)).toBeGreaterThanOrEqual(0.4);
});

for (const canceled of ['pointercancel', 'lostpointercapture'])
  test(`${canceled} で予約中の回転を破棄し、通常の操作終了では反映する`, async ({ page }) => {
    const map = await load(page);
    const drawing = map.locator('svg.spatial-drawing');
    const yaw = await drawing.getAttribute('data-yaw');
    const bounds = (await map.boundingBox())!;
    await map.evaluate((element) => {
      element.addEventListener(
        'pointerdown',
        (event) =>
          element.setAttribute('data-test-pointer', String((event as PointerEvent).pointerId)),
        { once: true },
      );
    });
    await page.mouse.move(bounds.x + 50, bounds.y + 45);
    await page.mouse.down({ button: 'right' });
    await map.evaluate(async (element, cancel) => {
      const bounds = element.getBoundingClientRect();
      const send = (type: string, x: number) =>
        element.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            isPrimary: true,
            pointerId: Number(element.getAttribute('data-test-pointer')),
            button: 2,
            buttons: 2,
            clientX: bounds.x + x,
            clientY: bounds.y + 45,
          }),
        );
      send('pointermove', 160);
      send(cancel, 160);
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
    }, canceled);
    await page.mouse.up({ button: 'right' });
    await expect(drawing).toHaveAttribute('data-yaw', yaw!);
    await page.mouse.move(bounds.x + 50, bounds.y + 45);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(bounds.x + 110, bounds.y + 45);
    await page.mouse.up({ button: 'right' });
    await expect(drawing).not.toHaveAttribute('data-yaw', yaw!);
    await map.getByRole('button', { name: '3D マップの向きを戻す' }).click();
    await page.mouse.move(bounds.x + 50, bounds.y + 45);
    await page.mouse.down({ button: 'right' });
    await map.evaluate(async (element, cancel) => {
      const bounds = element.getBoundingClientRect();
      const pointerId = Number(element.getAttribute('data-test-pointer'));
      element.dispatchEvent(
        new PointerEvent('pointermove', {
          bubbles: true,
          isPrimary: true,
          pointerId,
          button: 2,
          buttons: 2,
          clientX: bounds.x + 110,
          clientY: bounds.y + 45,
        }),
      );
      element.dispatchEvent(new PointerEvent(cancel, { bubbles: true, pointerId: pointerId + 1 }));
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
    }, canceled);
    await page.mouse.up({ button: 'right' });
    await expect(drawing).not.toHaveAttribute('data-yaw', yaw!);
  });

test('3D では画像出力を無効にし、2D に戻すと出力できる', async ({ page }) => {
  await load(page);
  await page.getByRole('button', { name: 'ダウンロード・印刷', exact: true }).click();
  const panel = page.getByRole('region', { name: 'ダウンロード・印刷' });
  await expect(panel).toContainText('2D 表示で利用できます');
  for (const button of await panel.getByRole('button').all()) await expect(button).toBeDisabled();
  await page.getByRole('button', { name: '2D', exact: true }).click();
  for (const button of await panel.getByRole('button').all()) await expect(button).toBeEnabled();
});

test('注記と名札を重ねず、長い囲みのラベルまで全体表示に含める', async ({ page }) => {
  const label = '業務全体の信頼境界とサービス間の関連を説明する長い囲みの名前'.repeat(3);
  const map = await load(
    page,
    `diagram "注記と囲み" {
  external.service a "サービス A"
  external.service b "サービス B"
  a -> b label="連携"
  note note_a "${'前提条件を説明する長い注記の名前'.repeat(12)}" anchor=a description="${'このサービスは段階的に切り替える設計です。'.repeat(12)}"
  overlay group "${label}" members=[a,b]
}`,
  );
  await toggleMembership(page);
  await map.getByRole('button', { name: '3D マップを全体表示' }).click();
  const bounds = (await map.boundingBox())!;
  const fence = (await map.locator('.spatial-overlay-label').boundingBox())!;
  expect(fence.x).toBeGreaterThanOrEqual(bounds.x);
  expect(fence.x + fence.width).toBeLessThanOrEqual(bounds.x + bounds.width);
  expect(fence.y).toBeGreaterThanOrEqual(bounds.y);
  const note = (await map.locator('.spatial-note').boundingBox())!;
  expect(note.y).toBeGreaterThanOrEqual(bounds.y);
  expect(note.y + note.height).toBeLessThanOrEqual(bounds.y + bounds.height);
  const overlaps = await map.evaluate((element) => {
    const notes = [...element.querySelectorAll('.spatial-note')].map((node) =>
      node.getBoundingClientRect(),
    );
    return [
      ...element.querySelectorAll('.spatial-caption,.spatial-edge-label,.spatial-overlay-label'),
    ].some((node) => {
      const r = node.getBoundingClientRect();
      return notes.some(
        (n) =>
          r.left < n.right - 1 &&
          r.right > n.left + 1 &&
          r.top < n.bottom - 1 &&
          r.bottom > n.top + 1,
      );
    });
  });
  expect(overlaps).toBe(false);
});
