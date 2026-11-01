import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  api,
  dashboardSchema,
  orderSchema,
  stockSchema,
  STORE_ID,
  money,
  shortId,
  ErrorNotice,
  JourneyPanel,
  Status,
  type Dashboard,
  type Order,
  type Stock,
} from '@boba/web-ui';

type Tab = 'orders' | 'inventory' | 'finance' | 'customers';
export function App() {
  const detailRef = useRef<HTMLElement>(null);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [tab, setTab] = useState<Tab>('orders');
  const [selectedId, setSelectedId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');
  const [revision, setRevision] = useState(0);
  const refresh = () => setRevision((v) => v + 1);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    const load = async () => {
      try {
        const value = await api(
          `/dashboard?storeId=${STORE_ID}`,
          dashboardSchema,
          { signal: controller.signal },
        );
        if (active) {
          setDashboard(value);
          setError('');
        }
      } catch (e) {
        if (active)
          setError(
            e instanceof Error ? e.message : 'Could not load store activity.',
          );
      } finally {
        if (active)
          timer = setTimeout(() => {
            void load();
          }, 3000);
      }
    };
    void load();
    return () => {
      active = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [revision]);
  const orders =
    dashboard?.orders.status === 'available' ? dashboard.orders.data.items : [];
  const selected = orders.find((order) => order.id === selectedId);
  useEffect(() => {
    if (selectedId && window.innerWidth < 780) {
      detailRef.current?.scrollIntoView({
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
          ? 'instant'
          : 'smooth',
        block: 'start',
      });
    }
  }, [selectedId]);
  const transition = async (order: Order, status: string) => {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api(`/orders/${order.id}/status`, orderSchema, {
        method: 'PATCH',
        body: JSON.stringify({
          status,
          ...(['rejected', 'cancelled'].includes(status) ? { reason } : {}),
        }),
      });
      setReason('');
      setNotice(`Order #${shortId(order.id)} is ${status}.`);
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Status change failed.');
    } finally {
      setBusy(false);
    }
  };
  const section = dashboard?.[tab];
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to store activity
      </a>
      <header className="topbar">
        <a className="brand" href="/">
          leaf<span> & </span>pearl
        </a>
        <nav aria-label="Main">
          <span>Store operations</span>
          <a href="http://localhost:8080">Customer shop ↗</a>
        </nav>
      </header>
      <div className="demo-note">
        Downtown demo store · No authentication · Manual stock counts and
        simulated sales
      </div>
      <main className="page operations" id="main">
        <div className="ops-intro">
          <div>
            <h1>The counter</h1>
            <p>
              Good cups start with a clear counter. Prepare orders, keep stock
              in view, and follow every effect.
            </p>
          </div>
          <button className="button secondary" onClick={refresh}>
            Refresh activity
          </button>
        </div>
        <nav className="ops-tabs" aria-label="Store sections">
          {(['orders', 'inventory', 'finance', 'customers'] as const).map(
            (value) => (
              <button
                key={value}
                aria-current={tab === value ? 'page' : undefined}
                onClick={() => {
                  setTab(value);
                  setNotice('');
                }}
              >
                {value === 'finance'
                  ? 'Sales ledger'
                  : value.charAt(0).toUpperCase() + value.slice(1)}
                {value === 'orders' && orders.length > 0 && (
                  <span>
                    {
                      orders.filter((o) =>
                        ['confirmed', 'preparing'].includes(o.status),
                      ).length
                    }
                  </span>
                )}
              </button>
            ),
          )}
        </nav>
        {error && <ErrorNotice message={error} />}
        {notice && (
          <p className="notice" role="status">
            {notice}
          </p>
        )}
        {!dashboard && !error && (
          <p className="empty" role="status">
            Loading store activity…
          </p>
        )}
        {section?.status === 'unavailable' && (
          <ErrorNotice
            message={`${tab}: ${section.error}. This section is unavailable, not empty.`}
          />
        )}
        {tab === 'orders' && dashboard?.orders.status === 'available' && (
          <div className="counter-layout">
            <section className="order-queue" aria-label="Orders">
              <div className="section-heading">
                <h2>Pickup orders</h2>
                <span>Latest 100 · updates every 3 seconds</span>
              </div>
              {orders.length === 0 && (
                <p className="empty">
                  No orders yet. Place one in the customer shop.
                </p>
              )}
              {orders.map((order) => (
                <button
                  className={`queue-ticket ${selectedId === order.id ? 'selected' : ''}`}
                  key={order.id}
                  onClick={() => {
                    setSelectedId(order.id);
                    setReason('');
                    setNotice('');
                  }}
                  aria-pressed={selectedId === order.id}
                >
                  <div className="ticket-top">
                    <strong>#{shortId(order.id)}</strong>
                    <Status value={order.status} />
                  </div>
                  <p>
                    {order.items
                      .map((item) => `${item.quantity} × ${item.name}`)
                      .join(', ')}
                  </p>
                  <div className="ticket-bottom">
                    <time dateTime={order.createdAt}>
                      {new Date(order.createdAt).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </time>
                    <strong>{money(order.totalMinor, order.currency)}</strong>
                  </div>
                </button>
              ))}
            </section>
            <aside
              ref={detailRef}
              className="ticket-detail"
              aria-label="Selected order"
            >
              {!selected ? (
                <div className="select-order">
                  <span aria-hidden="true">○ ○ ○</span>
                  <h2>A cup to prepare</h2>
                  <p>
                    Select an order to prepare it,
                    <br />
                    complete it, or inspect its journey.
                  </p>
                </div>
              ) : (
                <>
                  <div className="section-heading">
                    <h2>#{shortId(selected.id)}</h2>
                    <Status value={selected.status} />
                  </div>
                  <p className="muted">
                    Pickup ·{' '}
                    {selected.customerId ? 'Customer linked' : 'Guest order'}
                  </p>
                  <ul className="detail-items">
                    {selected.items.map((item, i) => (
                      <li key={i}>
                        <strong>
                          {item.quantity} × {item.name}
                        </strong>
                        <span>
                          {money(
                            item.quantity * item.unitPriceMinor,
                            selected.currency,
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <div className="detail-total">
                    <span>Order total</span>
                    <strong>
                      {money(selected.totalMinor, selected.currency)}
                    </strong>
                  </div>
                  {selected.reason && (
                    <p className="notice">{selected.reason}</p>
                  )}
                  {['confirmed', 'preparing'].includes(selected.status) && (
                    <div className="order-actions">
                      <button
                        className="button"
                        disabled={busy}
                        onClick={() => {
                          void transition(
                            selected,
                            selected.status === 'confirmed'
                              ? 'preparing'
                              : 'completed',
                          );
                        }}
                      >
                        {busy
                          ? 'Saving…'
                          : selected.status === 'confirmed'
                            ? 'Start preparing'
                            : 'Complete order'}
                      </button>
                      <label className="field">
                        Reason for rejection or cancellation
                        <input
                          value={reason}
                          onChange={(event) => setReason(event.target.value)}
                          maxLength={500}
                          placeholder="For example, insufficient stock"
                        />
                      </label>
                      <div className="secondary-actions">
                        <button
                          className="button danger small"
                          disabled={busy || !reason.trim()}
                          onClick={() => {
                            void transition(selected, 'rejected');
                          }}
                        >
                          Reject order
                        </button>
                        <button
                          className="button secondary small"
                          disabled={busy || !reason.trim()}
                          onClick={() => {
                            void transition(selected, 'cancelled');
                          }}
                        >
                          Cancel order
                        </button>
                      </div>
                    </div>
                  )}
                  {selected.status === 'completed' && (
                    <p className="completion-note">
                      Order completed. Downstream effects below must be applied
                      separately before this journey is fully processed.
                    </p>
                  )}
                  <JourneyPanel
                    orderId={selected.id}
                    staff
                    onChanged={refresh}
                  />
                </>
              )}
            </aside>
          </div>
        )}
        {tab === 'inventory' && dashboard?.inventory.status === 'available' && (
          <section>
            <div className="section-heading">
              <div>
                <h2>Ingredient stock</h2>
                <p className="muted">
                  Counts are reduced by completed-order events. No reservations.
                </p>
              </div>
              <span>Downtown store</span>
            </div>
            {dashboard.inventory.data.items.length === 0 && (
              <p className="empty">No ingredients are configured.</p>
            )}
            {dashboard.inventory.data.items.map((stock) => (
              <StockRow key={stock.id} stock={stock} onChanged={refresh} />
            ))}
          </section>
        )}
        {tab === 'finance' && dashboard?.finance.status === 'available' && (
          <section>
            <div className="section-heading">
              <div>
                <h2>Sales ledger</h2>
                <p className="muted">
                  Simulated order income and manual entries. No payments are
                  processed.
                </p>
              </div>
              <span>Latest 100 entries</span>
            </div>
            {dashboard.finance.data.items.length === 0 ? (
              <p className="empty">No ledger entries yet.</p>
            ) : (
              <div className="table-scroll">
                <table>
                  <caption className="sr-only">Store ledger entries</caption>
                  <thead>
                    <tr>
                      <th>Entry</th>
                      <th>Kind</th>
                      <th>Amount</th>
                      <th>Recorded</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dashboard.finance.data.items.map((entry) => (
                      <tr key={entry.id}>
                        <td>{entry.memo}</td>
                        <td>
                          <Status value={entry.kind} />
                        </td>
                        <td>{money(entry.amountMinor, entry.currency)}</td>
                        <td>{new Date(entry.createdAt).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
        {tab === 'customers' && dashboard?.customers.status === 'available' && (
          <section>
            <div className="section-heading">
              <div>
                <h2>Customer activity</h2>
                <p className="muted">
                  Fictional profiles. Completed-order activity is updated by its
                  own service.
                </p>
              </div>
              <span>Latest 100 customers</span>
            </div>
            {dashboard.customers.data.items.length === 0 ? (
              <p className="empty">No customer profiles yet.</p>
            ) : (
              <div className="table-scroll">
                <table>
                  <caption className="sr-only">
                    Customer profiles and completed order activity
                  </caption>
                  <thead>
                    <tr>
                      <th>Customer</th>
                      <th>Email</th>
                      <th>Completed orders</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dashboard.customers.data.items.map((customer) => (
                      <tr key={customer.id}>
                        <td>{customer.name}</td>
                        <td>{customer.email}</td>
                        <td>
                          {customer.completedOrderCount ??
                            'Activity unavailable'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
      </main>
      <footer className="footer">
        Independent services. One clear view of the shop.
      </footer>
    </>
  );
}

function StockRow({
  stock,
  onChanged,
}: {
  stock: Stock;
  onChanged: () => void;
}) {
  const [delta, setDelta] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api(`/stock/${stock.id}/adjustments`, stockSchema, {
        method: 'POST',
        body: JSON.stringify({ delta: Number(delta), reason }),
      });
      setDelta('');
      setReason('');
      setNotice('Stock adjustment saved.');
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Stock adjustment failed.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <article className="stock-row">
      <div className="stock-count">
        <h3>{stock.name}</h3>
        <p>
          <strong>{stock.onHand.toLocaleString()}</strong> {stock.unit} on hand
        </p>
      </div>
      <form
        onSubmit={(event) => {
          void submit(event);
        }}
        aria-label={`Adjust ${stock.name}`}
      >
        <label className="field">
          Adjustment ({stock.unit})
          <input
            type="number"
            step="1"
            min="-1000000"
            max="1000000"
            required
            value={delta}
            onChange={(event) => setDelta(event.target.value)}
            placeholder="+100 or -50"
          />
        </label>
        <label className="field">
          Reason
          <input
            required
            maxLength={500}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Delivery or recount"
          />
        </label>
        <button
          className="button secondary"
          disabled={busy || !reason.trim() || !Number(delta)}
        >
          {busy ? 'Saving…' : 'Adjust stock'}
        </button>
      </form>
      {error && <ErrorNotice message={error} />}
      {notice && (
        <p role="status" className="muted">
          {notice}
        </p>
      )}
    </article>
  );
}
