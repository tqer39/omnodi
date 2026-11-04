import { resolve } from 'node:path';
import { test, expect } from './fixtures';

for (const offline of [false, true])
  test(`リソース候補の追加・履歴・下書き保護 (${offline ? 'HTML' : '開発画面'})`, async ({
    page,
    context,
  }) => {
    if (offline) await context.setOffline(true);
    await page.goto(
      offline
        ? 'file://' + resolve('artifacts/architecture.html')
        : `http://127.0.0.1:${process.env.INFRA_TEST_PORT ?? '5188'}`,
    );
    await page.locator('input[type=file]').setInputFiles({
      name: 'suggestions.infra',
      mimeType: 'text/plain',
      buffer: Buffer.from(
        'diagram "候補" version=1 { vpc network "VPC" { subnet subnet1 "Subnet" } }',
      ),
    });
    await page.locator('.react-flow__node[data-id="subnet1"] .resource-label').click();
    const suggestions = page.getByRole('region', { name: '次に追加するリソース' });
    await expect(
      suggestions.getByRole('button', { name: 'EC2 を追加', exact: true }),
    ).toBeEnabled();
    await suggestions.getByRole('button', { name: 'EC2 を追加', exact: true }).click();
    await page.getByRole('button', { name: 'DSL を編集', exact: true }).click();
    const editor = page.getByRole('textbox', { name: 'DSL 入力' });
    await expect(editor).toHaveValue(/aws\.ec2 aws_ec2_1/);
    await page.getByRole('button', { name: '元に戻す', exact: true }).click();
    await expect(editor).not.toHaveValue(/aws_ec2_1/);
    await page.getByRole('button', { name: 'やり直す', exact: true }).click();
    await expect(editor).toHaveValue(/aws_ec2_1/);
    await page.getByRole('button', { name: 'DSL を編集', exact: true }).click();
    await page.locator('.react-flow__node[data-id="subnet1"] .resource-label').click();
    await suggestions.getByRole('button', { name: 'ALB を追加', exact: true }).click();
    await page.getByRole('button', { name: 'DSL を編集', exact: true }).click();
    await expect(editor).toHaveValue(/aws\.alb aws_alb_1.*subnets=\["subnet1"\]/);
    const saved = await editor.inputValue();
    await editor.fill(saved + '\n// 未反映');
    await expect(
      suggestions.getByRole('button', { name: 'EC2 を追加', exact: true }),
    ).toBeDisabled();
    await expect(editor).toHaveValue(saved + '\n// 未反映');
    await expect(page.locator('.diagnostics')).toHaveCount(0);
    await editor.fill(saved);
    await page.getByRole('button', { name: 'DSL を編集', exact: true }).click();
    await page.locator('.react-flow__node[data-id="network"] .resource-label').click();
    await suggestions.getByRole('button', { name: 'Security Group を追加', exact: true }).click();
    await expect(page.locator('.react-flow__node[data-id="sg_1"]')).toBeVisible();
    await page.locator('.react-flow__node[data-id="network"] .resource-label').click();
    await suggestions.getByRole('button', { name: 'Subnet を追加', exact: true }).click();
    await expect(page.locator('.resource-id')).toHaveText('subnet_1');
    await expect(
      suggestions.getByRole('button', { name: 'EC2 を追加', exact: true }),
    ).toBeEnabled();
    if (!offline) await page.screenshot({ path: 'artifacts/suggestions.png' });
  });

for (const offline of [false, true])
  test(`追加したリソースの候補を選び続け、スコープ外のサービスも図とDSLに保存 (${offline ? 'HTML' : '開発画面'})`, async ({
    page,
    context,
  }) => {
    if (offline) await context.setOffline(true);
    await page.goto(
      offline
        ? 'file://' + resolve('artifacts/architecture.html')
        : `http://127.0.0.1:${process.env.INFRA_TEST_PORT ?? '5188'}`,
    );
    await page.locator('input[type=file]').setInputFiles({
      name: 'chain.infra',
      mimeType: 'text/plain',
      buffer: Buffer.from(
        'diagram "連続追加" version=1 { vpc network "VPC" { subnet start "Subnet" } }',
      ),
    });
    await page.locator('.react-flow__node[data-id="start"] .resource-label').click();
    await page.getByRole('button', { name: '詳細へ移動', exact: true }).click();
    const suggestions = page.getByRole('region', { name: '次に追加するリソース' });
    for (const [label, id] of [
      ['EC2', 'aws_ec2_1'],
      ['S3', 'aws_s3_1'],
      ['Lambda', 'aws_lambda_1'],
      ['DynamoDB', 'aws_dynamodb_1'],
    ]) {
      await suggestions.getByRole('button', { name: `${label} を追加`, exact: true }).click();
      await expect(page.locator('.resource-id')).toHaveText(id!);
      await expect(page.locator(`.react-flow__node[data-id="${id}"]`)).toBeVisible();
    }
    await expect(suggestions).toContainText('Streams');
    await expect(page.locator('.canvas-footer')).toContainText('3 接続');
    await page.getByRole('button', { name: 'DSL を編集', exact: true }).click();
    const editor = page.getByRole('textbox', { name: 'DSL 入力' });
    const saved = await editor.inputValue();
    expect(saved).toMatch(/aws_ec2_1 -> aws_s3_1.*kind="traffic"/);
    expect(saved).toMatch(/aws_s3_1 -> aws_lambda_1.*kind="association"/);
    expect(saved).toMatch(/aws_lambda_1 -> aws_dynamodb_1/);
    await page.getByRole('button', { name: '元に戻す', exact: true }).click();
    await expect(editor).not.toHaveValue(/aws_dynamodb_1/);
    await expect(page.locator('.canvas-footer')).toContainText('2 接続');
    await page.getByRole('button', { name: 'やり直す', exact: true }).click();
    await expect(editor).toHaveValue(saved);
    await page.locator('input[type=file]').setInputFiles({
      name: 'restored.infra',
      mimeType: 'text/plain',
      buffer: Buffer.from(saved),
    });
    await expect(page.locator('.canvas-footer')).toContainText('3 接続');
    await expect(page.locator('.diagnostics')).toHaveCount(0);
  });
