import { createGateway, type Upstreams } from '@boba/gateway-runtime';
import { type HealthApp } from '@boba/service-runtime';

export const createApp = (urls: Upstreams): HealthApp =>
  createGateway('storefront-gateway', urls, false);
