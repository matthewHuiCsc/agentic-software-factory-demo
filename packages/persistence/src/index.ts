import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import pg from 'pg';

export type Database = pg.Pool;
export type Transaction = pg.PoolClient;

export function connectDatabase(connectionString: string): Database {
  return new pg.Pool({
    connectionString,
    max: 5,
    connectionTimeoutMillis: 5000,
    statement_timeout: 10000,
  });
}

export async function transaction<T>(
  db: Database,
  operation: (client: Transaction) => Promise<T>,
): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function migrate(db: Database, directory: URL): Promise<void> {
  const files = (await readdir(directory))
    .filter((name) => name.endsWith('.sql'))
    .sort();
  await transaction(db, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(820041)');
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name text PRIMARY KEY,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    for (const name of files) {
      const sql = await readFile(new URL(name, directory), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const previous = await client.query<{ checksum: string }>(
        'SELECT checksum FROM schema_migrations WHERE name = $1',
        [name],
      );
      if (previous.rows[0]) {
        if (previous.rows[0].checksum !== checksum) {
          throw new Error(
            `Applied migration ${name} was modified; add a new migration instead`,
          );
        }
        continue;
      }
      await client.query(sql);
      await client.query(
        'INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)',
        [name, checksum],
      );
    }
  });
}

export async function openServiceDatabase(directory: URL): Promise<Database> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const db = connectDatabase(url);
  try {
    await migrate(db, directory);
    return db;
  } catch (error) {
    await db.end();
    throw error;
  }
}

export function isUniqueViolation(error: unknown): boolean {
  return error instanceof pg.DatabaseError && error.code === '23505';
}
