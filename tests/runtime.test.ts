import { expect, it } from 'vitest';
import {
  createHealthApp,
  HttpError,
} from '../packages/service-runtime/src/index.js';

it('exposes deliberate HTTP errors but not internal exception details', async () => {
  const app = createHealthApp('test');
  app.get('/conflict', async () => {
    throw new HttpError(409, 'Already exists');
  });
  app.get('/failure', async () => {
    throw new Error('Private implementation detail');
  });
  try {
    const conflict = await app.inject({ method: 'GET', url: '/conflict' });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toEqual({ error: 'Already exists' });
    const failure = await app.inject({ method: 'GET', url: '/failure' });
    expect(failure.statusCode).toBe(500);
    expect(failure.json()).toEqual({ error: 'Internal server error' });
  } finally {
    await app.close();
  }
});
