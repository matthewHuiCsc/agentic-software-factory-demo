import { start } from '@boba/service-runtime';
import { openServiceDatabase } from '@boba/persistence';
import { RabbitMessageBus, startOutboxPublisher } from '@boba/messaging';
import { createApp } from './app.js';

const db = await openServiceDatabase(
  new URL('../migrations/', import.meta.url),
);
const rabbitUrl = process.env.RABBITMQ_URL;
if (!rabbitUrl) throw new Error('RABBITMQ_URL is required');
const bus = new RabbitMessageBus(rabbitUrl, 'boba.orders.events');
const stopPublisher = await startOutboxPublisher(db, bus);
const app = createApp(db, async () => {
  if (!bus.isConnected) throw new Error('RabbitMQ is unavailable');
});
db.on('error', (error) =>
  app.log.error({ err: error }, 'Idle database connection failed'),
);
app.addHook('onClose', async () => {
  await stopPublisher();
  await bus.close();
  await db.end();
});
await start(app);
