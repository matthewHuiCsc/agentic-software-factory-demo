import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { App as Storefront } from '../apps/storefront/src/App.js';
import { App as StoreOps } from '../apps/store-ops/src/App.js';

it('renders the customer ordering interface with an honest initial loading state', () => {
  const html = renderToStaticMarkup(<Storefront />);
  expect(html).toContain('A little tea.');
  expect(html).toContain('Your order');
  expect(html).toContain('Loading the menu');
});

it('renders staff operations with an honest initial loading state', () => {
  const html = renderToStaticMarkup(<StoreOps />);
  expect(html).toContain('The counter');
  expect(html).toContain('Orders');
  expect(html).toContain('Loading store activity');
});
