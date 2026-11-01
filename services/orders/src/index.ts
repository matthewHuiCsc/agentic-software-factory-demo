import { start } from '@boba/service-runtime';
import { openServiceDatabase } from '@boba/persistence';
import { createApp } from './app.js';

const db = await openServiceDatabase(
  new URL('../migrations/', import.meta.url),
);
const app = createApp(db);
db.on('error', (error) =>
  app.log.error({ err: error }, 'Idle database connection failed'),
);
app.addHook('onClose', async () => {
  await db.end();
});
await start(app);
