import { useEffect, useState } from 'react';
import {
  api,
  menuItem,
  list,
  orderSchema,
  customerSchema,
  STORE_ID,
  CUSTOMER_ID,
  money,
  shortId,
  DrinkIllustration,
  ErrorNotice,
  JourneyPanel,
  Status,
  type MenuItem,
  type Order,
} from '@boba/web-ui';

export function App() {
  const [menu, setMenu] = useState<MenuItem[] | null>(null);
  const [customerName, setCustomerName] = useState('');
  const [cart, setCart] = useState<Record<string, number>>({});
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [order, setOrder] = useState<Order | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      api('/menu?available=true', list(menuItem), {
        signal: controller.signal,
      }),
      api(`/customers/${CUSTOMER_ID}`, customerSchema, {
        signal: controller.signal,
      }),
    ])
      .then(([menu, customer]) => {
        setMenu(menu.items);
        setCustomerName(customer.name);
        setError('');
      })
      .catch((e: unknown) => {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : 'Could not load the menu.');
      });
    return () => controller.abort();
  }, [revision]);
  useEffect(() => {
    const stored = localStorage.getItem('boba-order');
    if (!stored) return;
    const controller = new AbortController();
    void api(`/orders/${stored}`, orderSchema, { signal: controller.signal })
      .then(setOrder)
      .catch((e: unknown) => {
        if (!controller.signal.aborted)
          setError(
            e instanceof Error ? e.message : 'Could not restore your order.',
          );
      });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!order || ['completed', 'cancelled', 'rejected'].includes(order.status))
      return;
    const controller = new AbortController();
    const timer = setInterval(() => {
      void api(`/orders/${order.id}`, orderSchema, {
        signal: controller.signal,
      })
        .then((value) => {
          setOrder(value);
          setError('');
        })
        .catch((e: unknown) => {
          if (!controller.signal.aborted)
            setError(
              e instanceof Error ? e.message : 'Could not refresh your order.',
            );
        });
    }, 3000);
    return () => {
      clearInterval(timer);
      controller.abort();
    };
  }, [order?.id, order?.status]);
  const selected = (menu ?? []).filter((item) => (cart[item.id] ?? 0) > 0);
  const total = selected.reduce(
    (sum, item) => sum + item.unitPriceMinor * (cart[item.id] ?? 0),
    0,
  );
  const change = (id: string, amount: number) =>
    setCart((value) => ({
      ...value,
      [id]: Math.min(10, Math.max(0, (value[id] ?? 0) + amount)),
    }));
  const place = async () => {
    if (!selected.length || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      const placed = await api('/orders', orderSchema, {
        method: 'POST',
        body: JSON.stringify({
          storeId: STORE_ID,
          customerId: CUSTOMER_ID,
          currency: 'USD',
          items: selected.map((item) => ({
            productId: item.id,
            name: item.name,
            quantity: cart[item.id],
            unitPriceMinor: item.unitPriceMinor,
          })),
        }),
      });
      setOrder(placed);
      setCart({});
      localStorage.setItem('boba-order', placed.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not place your order.');
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to menu
      </a>
      <header className="topbar">
        <a className="brand" href="/">
          leaf<span> & </span>pearl
        </a>
        <nav aria-label="Main">
          <span>Downtown shop</span>
          <a href="http://localhost:8081">Staff counter ↗</a>
        </nav>
      </header>
      <div className="demo-note">
        Fictional shop · Demo customer · Simulated sales, no payment required
      </div>
      <main className="page storefront" id="main">
        <div className="menu-column">
          <section className="welcome">
            <h1>
              A little tea.
              <br />A lovely pause.
            </h1>
            <p>
              Milk tea, chewy pearls, and a moment that’s yours.
              <br className="desktop-break" /> Choose your cup. We’ll take it
              from here.
            </p>
            <div className="shop-details">
              <span>Downtown · Pickup</span>
              <span>Two house favorites</span>
            </div>
          </section>
          <section className="menu" aria-labelledby="menu-heading">
            <div className="section-heading">
              <h2 id="menu-heading">The milk tea menu</h2>
              <span>Freshly prepared by our team</span>
            </div>
            {!menu && !error && (
              <p role="status" className="empty">
                Loading the menu…
              </p>
            )}
            {menu?.length === 0 && (
              <p className="empty">No drinks are available yet.</p>
            )}
            {menu?.map((item, index) => (
              <article className="menu-drink" key={item.id}>
                <div className={`drink-stage ${index % 2 ? 'brown' : ''}`}>
                  <DrinkIllustration brown={index % 2 === 1} />
                </div>
                <div className="drink-copy">
                  <h3>{item.name}</h3>
                  <p>
                    {item.description ??
                      'Milk tea with our signature tapioca pearls.'}
                  </p>
                  <strong className="price">
                    {money(item.unitPriceMinor, item.currency)}
                  </strong>
                  <div className="drink-control">
                    {(cart[item.id] ?? 0) === 0 ? (
                      <button
                        className="button secondary"
                        onClick={() => change(item.id, 1)}
                        disabled={submitting}
                      >
                        Add {item.name}
                      </button>
                    ) : (
                      <div
                        className="quantity"
                        role="group"
                        aria-label={`${item.name} quantity`}
                      >
                        <button
                          aria-label={`Remove one ${item.name}`}
                          onClick={() => change(item.id, -1)}
                          disabled={submitting}
                        >
                          −
                        </button>
                        <output aria-live="polite">{cart[item.id]}</output>
                        <button
                          aria-label={`Add one ${item.name}`}
                          onClick={() => change(item.id, 1)}
                          disabled={submitting || (cart[item.id] ?? 0) >= 10}
                        >
                          +
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </section>
        </div>
        <aside className="order-slip" aria-label="Your order">
          <div className="section-heading">
            <h2>Your order</h2>
            <span>Pickup</span>
          </div>
          <p className="muted">
            {customerName ? `For ${customerName}` : 'Demo customer profile'}
          </p>
          {error && (
            <>
              <ErrorNotice message={error} />
              <button
                className="button secondary small"
                onClick={() => setRevision((v) => v + 1)}
              >
                Retry loading
              </button>
            </>
          )}
          {order ? (
            <>
              <div className="order-confirmation" aria-live="polite">
                <span className="ticket-number">#{shortId(order.id)}</span>
                <Status value={order.status} />
                <h3>
                  {order.status === 'completed'
                    ? 'Your cup is ready.'
                    : order.status === 'preparing'
                      ? 'We’re making your tea.'
                      : order.status === 'confirmed'
                        ? 'You’re on the list.'
                        : 'This order is closed.'}
                </h3>
                <p className="muted">
                  {order.reason ??
                    'Follow along here, or open the staff counter to prepare this demo order.'}
                </p>
              </div>
              <ul className="receipt-items">
                {order.items.map((item, i) => (
                  <li key={i}>
                    <span>
                      {item.quantity} × {item.name}
                    </span>
                    <strong>
                      {money(
                        item.quantity * item.unitPriceMinor,
                        order.currency,
                      )}
                    </strong>
                  </li>
                ))}
              </ul>
              <div className="receipt-total">
                <span>Total</span>
                <strong>{money(order.totalMinor, order.currency)}</strong>
              </div>
              <JourneyPanel orderId={order.id} />
              <button
                className="button secondary new-order"
                onClick={() => {
                  setOrder(null);
                  localStorage.removeItem('boba-order');
                }}
              >
                Start another order
              </button>
            </>
          ) : (
            <>
              {selected.length ? (
                <ul className="receipt-items">
                  {selected.map((item) => (
                    <li key={item.id}>
                      <span>
                        {cart[item.id]} × {item.name}
                      </span>
                      <strong>
                        {money(
                          item.unitPriceMinor * (cart[item.id] ?? 0),
                          item.currency,
                        )}
                      </strong>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="cart-empty">
                  <span aria-hidden="true">○ ○ ○</span>
                  <p>
                    Your next little joy starts
                    <br />
                    with a cup from the menu.
                  </p>
                </div>
              )}
              <div className="receipt-total">
                <span>Total</span>
                <strong>{money(total)}</strong>
              </div>
              <button
                className="button place-order"
                disabled={!selected.length || submitting || !customerName}
                onClick={() => {
                  void place();
                }}
              >
                {submitting ? 'Placing your order…' : 'Place pickup order'}
              </button>
              <p className="checkout-note">
                No payment will be taken. Orders are confirmed on placement,
                then prepared by staff.
              </p>
            </>
          )}
        </aside>
      </main>
      <footer className="footer">
        A fictional boba chain. A real software journey.
      </footer>
    </>
  );
}
