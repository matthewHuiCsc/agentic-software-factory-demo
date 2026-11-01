import { test, expect } from '@playwright/test';

test('customer orders, staff completes, and all three independent effects become visible', async ({
  browser,
  request,
}) => {
  const beforeResponse = await request.get(
    'http://localhost:3002/api/customers/00000000-0000-4000-8000-000000000401',
  );
  expect(beforeResponse.ok()).toBe(true);
  const beforeCount = (await beforeResponse.json())
    .completedOrderCount as number;
  const context = await browser.newContext();
  const customer = await context.newPage();
  const staff = await context.newPage();
  await customer.goto('http://localhost:8080');
  await expect(
    customer.getByRole('heading', { name: 'A little tea. A lovely pause.' }),
  ).toBeVisible();
  await customer
    .getByRole('button', { name: 'Add Classic milk tea', exact: true })
    .click();
  await customer.getByRole('button', { name: 'Place pickup order' }).click();
  await expect(
    customer.getByRole('heading', { name: 'You’re on the list.' }),
  ).toBeVisible();
  const orderId = await customer.evaluate(() =>
    localStorage.getItem('boba-order'),
  );
  expect(orderId).toBeTruthy();
  const short = orderId!.slice(0, 8);
  await staff.goto('http://localhost:8081');
  await staff
    .getByRole('button')
    .filter({ hasText: `#${short}` })
    .click();
  await staff.getByRole('button', { name: 'Start preparing' }).click();
  await staff.getByRole('button', { name: 'Complete order' }).click();
  await expect(
    customer.getByRole('heading', { name: 'Your cup is ready.' }),
  ).toBeVisible();
  const effects = staff.getByRole('region', { name: 'Order processing' });
  await expect(
    effects.locator('li').filter({ hasText: 'Ingredient stock' }),
  ).toContainText('applied');
  await expect(
    effects.locator('li').filter({ hasText: 'Simulated sale' }),
  ).toContainText('applied');
  await expect(
    effects.locator('li').filter({ hasText: 'Customer activity' }),
  ).toContainText('applied');
  await staff.getByRole('button', { name: 'Inventory', exact: true }).click();
  await expect(
    staff.getByRole('heading', { name: 'Ingredient stock', exact: true }),
  ).toBeVisible();
  await expect(
    staff.getByRole('heading', { name: 'Tapioca pearls' }),
  ).toBeVisible();
  await staff
    .getByRole('button', { name: 'Sales ledger', exact: true })
    .click();
  await expect(staff.getByRole('table')).toContainText('5.50');
  await staff.getByRole('button', { name: 'Customers', exact: true }).click();
  await expect(staff.getByRole('table')).toContainText('Demo Customer');
  await expect(
    staff
      .getByRole('row')
      .filter({ hasText: 'Demo Customer' })
      .getByRole('cell')
      .last(),
  ).toHaveText(String(beforeCount + 1));
  await context.close();
});

test('mobile ordering is usable and staff rejection is shown to the customer', async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const customer = await context.newPage();
  await customer.goto('http://localhost:8080');
  await customer
    .getByRole('button', { name: 'Add Brown sugar milk tea', exact: true })
    .click();
  await customer.getByRole('button', { name: 'Place pickup order' }).click();
  await expect(
    customer.getByRole('heading', { name: 'You’re on the list.' }),
  ).toBeVisible();
  const id = await customer.evaluate(() => localStorage.getItem('boba-order'));
  const staff = await context.newPage();
  await staff.goto('http://localhost:8081');
  await staff
    .getByRole('button')
    .filter({ hasText: `#${id!.slice(0, 8)}` })
    .click();
  await staff
    .getByLabel('Reason for rejection or cancellation')
    .fill('Insufficient stock in demo');
  await staff.getByRole('button', { name: 'Reject order' }).click();
  await expect(
    customer.getByText('Insufficient stock in demo', { exact: true }),
  ).toBeVisible();
  await expect(
    customer
      .getByRole('region', { name: 'Order processing' })
      .locator('li')
      .filter({ hasText: 'Ingredient stock' }),
  ).toContainText('skipped');
  expect(
    await customer.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(
    await staff.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await context.close();
});

test('a gateway failure is visible and loading can recover', async ({
  page,
}) => {
  await page.route('**/api/menu', (route) =>
    route.fulfill({
      status: 502,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Demo gateway unavailable' }),
    }),
  );
  await page.goto('http://localhost:8080');
  await expect(page.getByRole('alert')).toContainText(
    'Demo gateway unavailable',
  );
  await expect(
    page.getByRole('button', { name: 'Place pickup order' }),
  ).toBeDisabled();
  await page.unroute('**/api/menu');
  await page.getByRole('button', { name: 'Retry loading' }).click();
  await expect(
    page.getByRole('button', { name: 'Add Classic milk tea', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});
