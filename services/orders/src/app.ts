import { createHealthApp, type HealthApp } from '@boba/service-runtime';

export const createApp = (): HealthApp => createHealthApp('orders');
