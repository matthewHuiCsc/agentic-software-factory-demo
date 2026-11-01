import { test, expect } from '@playwright/test';

test('a real insufficient-stock effect fails visibly and recovers after restocking and retry', async ({
  browser,
  request,
}) => {
  const stockResponse = await request.get(
    'http://localhost:3002/api/stock?storeId=00000000-0000-4000-8000-000000000001',
  );
  expect(stockResponse.ok()).toBe(true);
  const stock = (await stockResponse.json()).items.find(
    (item: { name: string }) => item.name === 'Tapioca pearls',
  );
  expect(stock).toBeTruthy();
  if (stock.onHand > 0) {
    const count = await request.post(
      `http://localhost:3002/api/stock/${stock.id}/adjustments`,
      {
        data: {
          delta: -stock.onHand,
          reason: 'Browser recovery test temporary stock count',
        },
      },
    );
    expect(count.ok()).toBe(true);
  }
  const context = await browser.newContext();
  try {
    const customer = await context.newPage();
    const staff = await context.newPage();
    await customer.goto('http://localhost:8080');
    await customer
      .getByRole('button', { name: 'Add Classic milk tea', exact: true })
      .click();
    await customer.getByRole('button', { name: 'Place pickup order' }).click();
    await expect(
      customer.getByRole('heading', { name: 'You’re on the list.' }),
    ).toBeVisible();
    const id = await customer.evaluate(() =>
      localStorage.getItem('boba-order'),
    );
    await staff.goto('http://localhost:8081');
    await staff
      .getByRole('button')
      .filter({ hasText: `#${id!.slice(0, 8)}` })
      .click();
    await staff.getByRole('button', { name: 'Start preparing' }).click();
    await staff.getByRole('button', { name: 'Complete order' }).click();
    const inventory = staff
      .getByRole('region', { name: 'Order processing' })
      .locator('li')
      .filter({ hasText: 'Ingredient stock' });
    await expect(inventory).toContainText('failed');
    await expect(
      customer
        .getByRole('region', { name: 'Order processing' })
        .locator('li')
        .filter({ hasText: 'Ingredient stock' }),
    ).toContainText('failed');
    await staff.getByRole('button', { name: 'Inventory', exact: true }).click();
    const form = staff.getByRole('form', { name: 'Adjust Tapioca pearls' });
    await form.getByLabel('Adjustment (g)').fill('50');
    await form.getByLabel('Reason').fill('Browser recovery test restock');
    await form.getByRole('button', { name: 'Adjust stock' }).click();
    await expect(staff.getByText('Stock adjustment saved.')).toBeVisible();
    await staff.getByRole('button', { name: /^Orders/ }).click();
    await inventory.getByRole('button', { name: 'Retry effect' }).click();
    await expect(inventory).toContainText('applied');
  } finally {
    await context.close();
    const current = await request.get(
      'http://localhost:3002/api/stock?storeId=00000000-0000-4000-8000-000000000001',
    );
    const latest = (await current.json()).items.find(
      (item: { id: string }) => item.id === stock.id,
    );
    const delta = stock.onHand - latest.onHand;
    if (delta !== 0) {
      const restore = await request.post(
        `http://localhost:3002/api/stock/${stock.id}/adjustments`,
        {
          data: { delta, reason: 'Restore stock after browser recovery test' },
        },
      );
      expect(restore.ok()).toBe(true);
    }
  }
});
