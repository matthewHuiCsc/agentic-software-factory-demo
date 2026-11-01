import { z } from 'zod';

export const ORDER_EVENT_VERSION = 1;

const envelope = {
  eventId: z.uuid(),
  operationId: z.uuid(),
  version: z.literal(ORDER_EVENT_VERSION),
  source: z.literal('orders'),
  occurredAt: z.iso.datetime({ offset: true }),
};

const orderIdentity = {
  orderId: z.uuid(),
  storeId: z.uuid(),
};

export const orderItemSchema = z.strictObject({
  productId: z.uuid(),
  quantity: z.number().int().positive(),
});

export const orderPlacedSchema = z.strictObject({
  ...envelope,
  type: z.literal('OrderPlaced'),
  data: z.strictObject({
    ...orderIdentity,
    customerId: z.uuid().optional(),
    items: z.array(orderItemSchema).nonempty(),
    totalMinor: z.number().int().nonnegative(),
    currency: z.string().regex(/^[A-Z]{3}$/),
  }),
});

export const orderCompletedSchema = z.strictObject({
  ...envelope,
  type: z.literal('OrderCompleted'),
  data: z.strictObject(orderIdentity),
});

export const orderRejectedSchema = z.strictObject({
  ...envelope,
  type: z.literal('OrderRejected'),
  data: z.strictObject({ ...orderIdentity, reason: z.string().trim().min(1) }),
});

export const orderCancelledSchema = z.strictObject({
  ...envelope,
  type: z.literal('OrderCancelled'),
  data: z.strictObject({ ...orderIdentity, reason: z.string().trim().min(1) }),
});

export const orderEventSchema = z.discriminatedUnion('type', [
  orderPlacedSchema,
  orderCompletedSchema,
  orderRejectedSchema,
  orderCancelledSchema,
]);

export type OrderPlaced = z.infer<typeof orderPlacedSchema>;
export type OrderCompleted = z.infer<typeof orderCompletedSchema>;
export type OrderRejected = z.infer<typeof orderRejectedSchema>;
export type OrderCancelled = z.infer<typeof orderCancelledSchema>;
export type OrderEvent = z.infer<typeof orderEventSchema>;
