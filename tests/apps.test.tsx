import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { App as Storefront } from '../apps/storefront/src/App.js';
import { App as StoreOps } from '../apps/store-ops/src/App.js';

it('renders an honest customer placeholder', () => {
  const html = renderToStaticMarkup(<Storefront />);
  expect(html).toContain('<h1>Boba storefront</h1>');
  expect(html).toContain('later stage');
});

it('renders an honest staff placeholder', () => {
  const html = renderToStaticMarkup(<StoreOps />);
  expect(html).toContain('<h1>Boba store operations</h1>');
  expect(html).toContain('later stage');
});
