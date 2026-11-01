import { start } from '@boba/service-runtime';
import { upstreamsFromEnvironment } from '@boba/gateway-runtime';
import { createApp } from './app.js';

await start(createApp(upstreamsFromEnvironment()));
