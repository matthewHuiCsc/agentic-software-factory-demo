import { start } from '@boba/service-runtime';
import { createApp } from './app.js';

await start(createApp());
