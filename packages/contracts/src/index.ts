import { z } from 'zod';

export const ORDER_EVENT_VERSION = 1;
export const ORDER_COMPLETION_EVENT_VERSION = 2;

const envelope = {
  eventId: z.uuid(),
  operationId: z.uuid(),
  source: z.literal('orders'),
  occurredAt: z.iso.datetime({ offset: true }),
};
const v1Envelope = { ...envelope, version: z.literal(ORDER_EVENT_VERSION) };

const orderIdentity = {
  orderId: z.uuid(),
  storeId: z.uuid(),
};

export const orderItemSchema = z.strictObject({
  productId: z.uuid(),
  quantity: z.number().int().positive(),
});

export const orderPlacedSchema = z.strictObject({
  ...v1Envelope,
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
  ...v1Envelope,
  type: z.literal('OrderCompleted'),
  data: z.strictObject(orderIdentity),
});

export const orderCompletedV2Schema = z.strictObject({
  ...envelope,
  version: z.literal(ORDER_COMPLETION_EVENT_VERSION),
  type: z.literal('OrderCompleted'),
  data: z.strictObject({
    ...orderIdentity,
    customerId: z.uuid().optional(),
    items: z
      .array(
        z.strictObject({
          productId: z.uuid(),
          quantity: z.number().int().positive(),
          unitPriceMinor: z.number().int().nonnegative(),
        }),
      )
      .nonempty(),
    totalMinor: z.number().int().nonnegative(),
    currency: z.string().regex(/^[A-Z]{3}$/),
  }),
});

export const orderRejectedSchema = z.strictObject({
  ...v1Envelope,
  type: z.literal('OrderRejected'),
  data: z.strictObject({ ...orderIdentity, reason: z.string().trim().min(1) }),
});

export const orderCancelledSchema = z.strictObject({
  ...v1Envelope,
  type: z.literal('OrderCancelled'),
  data: z.strictObject({ ...orderIdentity, reason: z.string().trim().min(1) }),
});

export const orderEventSchema = z.union([
  orderPlacedSchema,
  orderCompletedSchema,
  orderCompletedV2Schema,
  orderRejectedSchema,
  orderCancelledSchema,
]);

export type OrderPlaced = z.infer<typeof orderPlacedSchema>;
export type OrderCompleted = z.infer<typeof orderCompletedSchema>;
export type OrderCompletedV2 = z.infer<typeof orderCompletedV2Schema>;
export type OrderRejected = z.infer<typeof orderRejectedSchema>;
export type OrderCancelled = z.infer<typeof orderCancelledSchema>;
export type OrderEvent = z.infer<typeof orderEventSchema>;
