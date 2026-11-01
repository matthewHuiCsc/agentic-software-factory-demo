import { useEffect, useState } from 'react';
import { z } from 'zod';

export const STORE_ID = '00000000-0000-4000-8000-000000000001';
export const CUSTOMER_ID = '00000000-0000-4000-8000-000000000401';
export const money = (minor: number, currency = 'USD') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(
    minor / 100,
  );
export const shortId = (id: string) => id.slice(0, 8);

export const menuItem = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  unitPriceMinor: z.number(),
  currency: z.string(),
});
export type MenuItem = z.infer<typeof menuItem>;
export const orderSchema = z.object({
  id: z.string(),
  storeId: z.string(),
  customerId: z.string().nullable(),
  status: z.enum([
    'confirmed',
    'preparing',
    'completed',
    'rejected',
    'cancelled',
  ]),
  items: z.array(
    z.object({
      productId: z.string(),
      name: z.string(),
      quantity: z.number(),
      unitPriceMinor: z.number(),
    }),
  ),
  totalMinor: z.number(),
  currency: z.string(),
  reason: z.string().nullable(),
  createdAt: z.string(),
});
export type Order = z.infer<typeof orderSchema>;
export const stockSchema = z.object({
  id: z.string(),
  storeId: z.string(),
  name: z.string(),
  unit: z.string(),
  onHand: z.number(),
});
export type Stock = z.infer<typeof stockSchema>;
export const entrySchema = z.object({
  id: z.string(),
  kind: z.string(),
  amountMinor: z.number(),
  currency: z.string(),
  memo: z.string(),
  createdAt: z.string(),
});
export const customerSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    email: z.string(),
    completedOrderCount: z.number().optional(),
  })
  .passthrough();
export const effectSchema = z
  .object({
    status: z.string(),
    error: z.string().nullable().optional(),
    lastError: z.string().nullable().optional(),
    attempts: z.number().optional(),
    type: z.string().optional(),
    eventType: z.string().optional(),
  })
  .passthrough();
export const list = <T extends z.ZodType>(schema: T) =>
  z.object({ items: z.array(schema) });
export const section = <T extends z.ZodType>(schema: T) =>
  z.discriminatedUnion('status', [
    z.object({ status: z.literal('available'), data: schema }),
    z.object({ status: z.literal('unavailable'), error: z.string() }),
  ]);
export const journeySchema = z.object({
  order: section(orderSchema),
  events: section(list(effectSchema)),
  inventory: section(list(effectSchema)),
  finance: section(list(effectSchema)),
  customers: section(list(effectSchema)),
});
export type Journey = z.infer<typeof journeySchema>;
export const dashboardSchema = z.object({
  orders: section(list(orderSchema)),
  inventory: section(list(stockSchema)),
  finance: section(list(entrySchema)),
  customers: section(list(customerSchema)),
});
export type Dashboard = z.infer<typeof dashboardSchema>;

export async function api<T extends z.ZodType>(
  path: string,
  schema: T,
  options?: RequestInit,
): Promise<z.infer<T>> {
  const response = await fetch('/api' + path, {
    ...options,
    headers: { 'content-type': 'application/json', ...options?.headers },
    signal: options?.signal ?? AbortSignal.timeout(15000),
  });
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new Error(
      `The gateway returned an unreadable response (HTTP ${response.status}).`,
    );
  }
  if (!response.ok) {
    const error = z.object({ error: z.string() }).safeParse(data);
    throw new Error(
      error.success
        ? error.data.error
        : `Request failed (HTTP ${response.status}).`,
    );
  }
  const parsed = schema.safeParse(data);
  if (!parsed.success)
    throw new Error(
      'The service returned an unexpected response. Refresh or check service logs.',
    );
  return parsed.data;
}

export function ErrorNotice({ message }: { message: string }) {
  return (
    <p className="notice error" role="alert">
      {message}
    </p>
  );
}
export function Status({ value }: { value: string }) {
  return <span className={`status status-${value}`}>{value}</span>;
}
export function DrinkIllustration({ brown = false }: { brown?: boolean }) {
  return (
    <svg viewBox="0 0 180 220" aria-hidden="true" className="drink-art">
      <path d="M105 6h10l-12 72H93z" fill="#245446" />
      <path
        d="M38 58h106l-12 140c-1 14-84 14-85 0z"
        fill={brown ? '#ad754e' : '#d5b087'}
      />
      <path d="M39 65h104l-3 34H42z" fill={brown ? '#e4c5a6' : '#efe1c7'} />
      <path d="M38 57h106v12H38z" fill="#245446" />
      {[
        [64, 175],
        [87, 187],
        [108, 175],
        [69, 195],
        [116, 195],
        [93, 165],
      ].map(([cx, cy], i) => (
        <circle key={i} cx={cx} cy={cy} r="9" fill="#302920" />
      ))}
      <path d="M53 83l5 69" stroke="#fff" strokeWidth="5" opacity=".4" />
    </svg>
  );
}

export function JourneyPanel({
  orderId,
  staff = false,
  onChanged,
}: {
  orderId: string;
  staff?: boolean;
  onChanged?: () => void;
}) {
  const [journey, setJourney] = useState<Journey | null>(null);
  const [error, setError] = useState('');
  const [retrying, setRetrying] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    const load = async () => {
      try {
        const value = await api(`/orders/${orderId}/journey`, journeySchema, {
          signal: controller.signal,
        });
        if (active) {
          setJourney(value);
          setError('');
        }
      } catch (e) {
        if (active)
          setError(
            e instanceof Error
              ? e.message
              : 'Unable to read processing status.',
          );
      } finally {
        if (active)
          timer = setTimeout(() => {
            void load();
          }, 3000);
      }
    };
    setJourney(null);
    void load();
    return () => {
      active = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [orderId, revision]);
  const retry = async (service: string) => {
    setRetrying(service);
    try {
      await api(
        `/effects/${service}/${orderId}/retry`,
        z.record(z.string(), z.unknown()),
        { method: 'POST', body: '{}' },
      );
      setRevision((v) => v + 1);
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Retry failed.');
    } finally {
      setRetrying('');
    }
  };
  return (
    <section className="journey" aria-label="Order processing">
      <div className="section-heading">
        <h3>Behind your cup</h3>
        <span>Live service updates</span>
      </div>
      <p className="muted">
        Completion is an order fact. The other services apply it independently.
      </p>
      {error && <ErrorNotice message={error} />}
      {!journey && !error && <p role="status">Checking processing…</p>}
      {journey && (
        <ul className="effect-list">
          {(['events', 'inventory', 'finance', 'customers'] as const).map(
            (service) => {
              const result = journey[service];
              const allRecords =
                result.status === 'available' ? result.data.items : [];
              const records =
                service === 'events'
                  ? allRecords
                  : allRecords.filter(
                      (item) =>
                        (item.eventType ?? item.type) === 'OrderCompleted',
                    );
              const completed =
                journey.order.status === 'available' &&
                journey.order.data.status === 'completed';
              const closedWithoutCompletion =
                journey.order.status === 'available' &&
                ['rejected', 'cancelled'].includes(journey.order.data.status);
              const failed = records.find((item) => item.status === 'failed');
              const pendingError = records.find(
                (item) => item.error || item.lastError,
              );
              const processed = records.some((item) =>
                ['processed', 'published', 'applied'].includes(item.status),
              );
              const skipped =
                records.length > 0 &&
                records.every((item) =>
                  ['ignored', 'skipped'].includes(item.status),
                );
              const pending = records.some(
                (item) =>
                  ![
                    'processed',
                    'published',
                    'applied',
                    'ignored',
                    'skipped',
                  ].includes(item.status),
              );
              const state =
                result.status === 'unavailable'
                  ? 'unavailable'
                  : failed
                    ? 'failed'
                    : pending
                      ? 'pending'
                      : processed
                        ? 'applied'
                        : skipped
                          ? 'skipped'
                          : completed
                            ? 'pending'
                            : service !== 'events' && closedWithoutCompletion
                              ? 'skipped'
                              : 'waiting';
              const label = {
                events: 'Order facts',
                inventory: 'Ingredient stock',
                finance: 'Simulated sale',
                customers: 'Customer activity',
              }[service];
              return (
                <li key={service}>
                  <div>
                    <strong>{label}</strong>
                    <Status value={state} />
                    {result.status === 'unavailable' && (
                      <p className="effect-error">{result.error}</p>
                    )}
                    {failed && (
                      <p className="effect-error">
                        {failed.error ??
                          failed.lastError ??
                          'Processing failed; check service logs.'}
                      </p>
                    )}
                    {state === 'waiting' && (
                      <p className="muted">
                        Applies after the order is completed.
                      </p>
                    )}
                    {state === 'skipped' && (
                      <p className="muted">
                        No effect was required for this order.
                      </p>
                    )}
                    {state === 'pending' && (
                      <p className="muted">
                        Waiting for delivery or processing. Not yet confirmed.
                      </p>
                    )}
                    {state === 'pending' && pendingError && (
                      <p className="effect-error">
                        {pendingError.error ?? pendingError.lastError}
                      </p>
                    )}
                  </div>
                  {staff && failed && service !== 'events' && (
                    <button
                      className="button secondary small"
                      disabled={!!retrying}
                      onClick={() => {
                        void retry(service);
                      }}
                    >
                      {retrying === service ? 'Retrying…' : 'Retry effect'}
                    </button>
                  )}
                </li>
              );
            },
          )}
        </ul>
      )}
    </section>
  );
}
