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
      eventTime: i,
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

  // 1. Determine burst window indices if burst is enabled
  const burstEventIndices = new Set<number>();
  if (config.burstEnabled && config.totalEvents > 10) {
    const burstStart = Math.max(2, Math.floor(config.totalEvents * 0.3));
    const effectiveBurstSize = Math.min(config.burstSize, config.totalEvents - burstStart);
    for (let i = 0; i < effectiveBurstSize; i++) {
      burstEventIndices.add(burstStart + i);
    }
  }

  // 2. Generate original deliveries for all logical events
  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    const isBurst = burstEventIndices.has(i);

    let isLate = false;
    let delay = 0;

    // Apply late event logic if enabled
    if (config.lateEventsEnabled && rng.chance(config.lateEventRate / 100)) {
      isLate = true;
      // Some late events within allowed lateness (accepted), some beyond (rejected)
      const shouldExceedWatermark = rng.chance(0.4);
      if (shouldExceedWatermark) {
        // Delay beyond allowed lateness
        delay = config.allowedLateness + rng.int(2, Math.max(3, config.maxArrivalDelay - config.allowedLateness));
      } else {
        // Delay within allowed lateness
        delay = rng.int(2, Math.max(2, config.allowedLateness));
      }
    }

    const eventTime = event.eventTime;
    let arrivalTime = eventTime + delay;

    // In a burst stream, arrival times are compressed tightly
    if (isBurst) {
      const burstStartEvent = events[Math.max(2, Math.floor(config.totalEvents * 0.3))];
      const offsetWithinBurst = Math.floor((i - burstStartEvent.sequence) / Math.max(1, config.burstIntensity));
      arrivalTime = burstStartEvent.eventTime + Math.min(config.burstDuration, offsetWithinBurst);
    }

    deliveries.push(createDelivery(event, 1, false, eventTime, arrivalTime, isLate, isBurst));
  }

  // 3. Generate duplicate deliveries based on duplicateRate
  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    const isBurst = burstEventIndices.has(i);

    if (rng.chance(config.duplicateRate / 100)) {
      const isLate = config.lateEventsEnabled && rng.chance(config.lateEventRate / 100);
      const delay = isLate ? rng.int(3, config.maxArrivalDelay) : rng.int(1, 4);
      const eventTime = event.eventTime;
      let arrivalTime = eventTime + delay;

      if (isBurst) {
        const burstStartEvent = events[Math.max(2, Math.floor(config.totalEvents * 0.3))];
        arrivalTime = burstStartEvent.eventTime + rng.int(0, config.burstDuration);
      }

      deliveries.push(createDelivery(event, 2, true, eventTime, arrivalTime, isLate, isBurst));
      duplicateCount++;
    }
  }

  // 4. Sort queue by arrivalTime so events reach the ingestion system when they actually arrive
  deliveries.sort((a, b) => {
    if (a.arrivalTime !== b.arrivalTime) {
      return a.arrivalTime - b.arrivalTime;
    }
    return a.sequence - b.sequence;
  });

  // Assign sequential logical arrival times and update UIDs
  deliveries.forEach((d, idx) => {
    d.logicalTime = idx;
    d.uid = `${d.eventId}-d${d.deliveryNumber}-${idx}`;
  });

  // 5. Apply out-of-order shuffling if enabled
  if (config.ordering === 'out-of-order') {
    for (let i = deliveries.length - 1; i > 0; i--) {
      if (rng.chance(0.35)) {
        const j = rng.int(0, i);
        [deliveries[i], deliveries[j]] = [deliveries[j], deliveries[i]];
      }
    }
    // Re-index logical times after shuffle
    deliveries.forEach((d, idx) => {
      d.logicalTime = idx;
      d.uid = `${d.eventId}-d${d.deliveryNumber}-${idx}`;
    });
  }

  return { deliveries, duplicateCount };
}

function createDelivery(
  event: LogicalEvent,
  deliveryNumber: number,
  isDuplicate: boolean,
  eventTime: number,
  arrivalTime: number,
  isLate: boolean,
  isBurst: boolean
): DeliveryAttempt {
  const lateness = Math.max(0, arrivalTime - eventTime);
  return {
    uid: `${event.id}-d${deliveryNumber}-${arrivalTime}`,
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
    logicalTime: arrivalTime,
    processingLatency: 0,
    payload: event.payload,
    createdAt: event.createdAt,
    isOriginal: deliveryNumber === 1,
    failedBeforeProcessing: false,
    wasRetried: false,
    eventTime,
    arrivalTime,
    lateness,
    isLate,
    isBurst,
    watermarkAtArrival: 0,
    queueWaitTime: 0,
  };
}
