import { LogicalEvent, EventType, SimulationConfig, DeliveryAttempt } from './types';
import { SeededRNG } from './rng';

const EVENT_TYPES: EventType[] = ['payment', 'order', 'inventory', 'notification', 'transfer'];

const PAYLOADS: Record<EventType, string[]> = {
  payment: ['$29.99', '$149.00', '$9.99', '$499.50', '$12.50'],
  order: ['SKU-A100 x2', 'SKU-B250 x1', 'SKU-C300 x5', 'SKU-D400 x3'],
  inventory: ['stock+50', 'stock-10', 'stock-25', 'stock+100'],
  notification: ['email:welcome', 'email:receipt', 'email:alert'],
  transfer: ['acct->acct $500', 'acct->acct $1200', 'acct->acct $75'],
};

export function generateLogicalEvents(config: SimulationConfig): LogicalEvent[] {
  const rng = new SeededRNG(config.seed);
  const events: LogicalEvent[] = [];

  for (let i = 0; i < config.totalEvents; i++) {
    const type = rng.pick(EVENT_TYPES);
    const payload = rng.pick(PAYLOADS[type]);
    events.push({
      id: `evt-${String(i + 1).padStart(5, '0')}`,
      type,
      sequence: i + 1,
      payload,
      createdAt: i,
    });
  }
  return events;
}

interface GeneratedDeliveries {
  deliveries: DeliveryAttempt[];
  duplicateCount: number;
}

export function generateDeliveryQueue(config: SimulationConfig): GeneratedDeliveries {
  const rng = new SeededRNG(config.seed + 1000);
  const events = generateLogicalEvents(config);
  const deliveries: DeliveryAttempt[] = [];
  let duplicateCount = 0;
  let logicalTime = 0;

  for (const event of events) {
    deliveries.push(createDelivery(event, 1, false, logicalTime++));
  }

  for (const event of events) {
    if (rng.chance(config.duplicateRate / 100)) {
      deliveries.push(createDelivery(event, 2, true, logicalTime++));
      duplicateCount++;
    }
  }

  if (config.ordering === 'out-of-order') {
    for (let i = deliveries.length - 1; i > 0; i--) {
      if (rng.chance(0.3)) {
        const j = rng.int(0, i);
        [deliveries[i], deliveries[j]] = [deliveries[j], deliveries[i]];
      }
    }
  }

  return { deliveries, duplicateCount };
}

function createDelivery(
  event: LogicalEvent,
  deliveryNumber: number,
  isDuplicate: boolean,
  logicalTime: number
): DeliveryAttempt {
  return {
    uid: `${event.id}-d${deliveryNumber}-${logicalTime}`,
    eventId: event.id,
    type: event.type,
    sequence: event.sequence,
    deliveryNumber,
    isDuplicate,
    workerId: null,
    status: 'Pending',
    decision: 'Pending',
    reason: 'Queued for delivery',
    timestamp: 0,
    logicalTime,
    processingLatency: 0,
    payload: event.payload,
    createdAt: event.createdAt,
    isOriginal: deliveryNumber === 1,
    failedBeforeProcessing: false,
    wasRetried: false,
  };
}
