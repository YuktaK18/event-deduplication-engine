import {
  DeliveryAttempt,
  RegistryEntry,
  WorkerState,
  SimulationConfig,
} from './types';
import { SeededRNG } from './rng';

export interface ProcessingResult {
  delivery: DeliveryAttempt;
  registryEntry: RegistryEntry | null;
  workerState: WorkerState;
  crashTriggered: boolean;
}

export function processDelivery(
  delivery: DeliveryAttempt,
  deliveryIndex: number,
  registry: Map<string, RegistryEntry>,
  workers: WorkerState[],
  config: SimulationConfig,
  crashRng: SeededRNG,
  currentWatermark: number = 0,
  currentQueueBacklog: number = 0
): ProcessingResult {
  const worker = selectWorker(workers, delivery, deliveryIndex);
  const updatedWorkers = workers.map((w) => ({ ...w }));
  const updatedWorker = updatedWorkers.find((w) => w.id === worker.id)!;

  let crashTriggered = false;

  // 1. Worker failure before processing begins
  const failBeforeProcessing = shouldFailBeforeProcessing(
    config,
    deliveryIndex,
    delivery
  );

  if (failBeforeProcessing) {
    crashTriggered = true;
    updatedWorker.status = 'crashed';
    updatedWorker.failedCount++;
    updatedWorker.currentEventId = null;

    return {
      delivery: {
        ...delivery,
        workerId: worker.id,
        status: 'Failed',
        decision: 'Failed',
        reason: `Worker ${worker.id} crashed before processing started`,
        timestamp: delivery.logicalTime,
        processingLatency: 0,
        failedBeforeProcessing: true,
        watermarkAtArrival: currentWatermark,
        queueWaitTime: 0,
      },
      registryEntry: null,
      workerState: updatedWorker,
      crashTriggered,
    };
  }

  // 2. Queue delay and latency simulation under burst/backlog
  const queueWaitTime = currentQueueBacklog > 0
    ? Math.min(60, Math.floor((currentQueueBacklog * 3) / Math.max(1, config.workerCount)))
    : 0;

  const isLate = delivery.isLate || delivery.lateness > 0;

  // 3. De-duplication Check FIRST (when enabled)
  // Ensures that already-processed duplicate redeliveries are always identified as duplicates,
  // even if they arrive late or with older timestamps.
  if (config.deduplicationEnabled) {
    const existing = registry.get(delivery.eventId);

    if (existing && existing.state === 'Processed') {
      const isLateDupe = isLate;
      const reason = isLateDupe
        ? `Event ${delivery.eventId} (late arrival, delay ${delivery.lateness}t) was already processed at T${existing.processedAt} — duplicate suppressed by registry`
        : `Event ${delivery.eventId} already processed — duplicate delivery suppressed by registry`;

      return {
        delivery: {
          ...delivery,
          workerId: worker.id,
          status: 'Duplicate',
          decision: 'Duplicate Suppressed',
          reason,
          timestamp: delivery.logicalTime,
          processingLatency: simulateLatency(delivery, crashRng, true, queueWaitTime),
          watermarkAtArrival: currentWatermark,
          queueWaitTime,
        },
        registryEntry: existing,
        workerState: { ...updatedWorker, status: 'idle' },
        crashTriggered: false,
      };
    }

    if (existing && existing.state === 'Processing') {
      if (delivery.wasRetried) {
        // Retry after crash: clear stale Processing entry and reprocess
        registry.delete(delivery.eventId);
      } else {
        return {
          delivery: {
            ...delivery,
            workerId: worker.id,
            status: 'Duplicate',
            decision: 'Duplicate Suppressed',
            reason: `Event ${delivery.eventId} is currently being processed by worker ${existing.processedBy} — duplicate suppressed`,
            timestamp: delivery.logicalTime,
            processingLatency: simulateLatency(delivery, crashRng, true, queueWaitTime),
            watermarkAtArrival: currentWatermark,
            queueWaitTime,
          },
          registryEntry: existing,
          workerState: { ...updatedWorker, status: 'idle' },
          crashTriggered: false,
        };
      }
    }
  }

  // 4. Late Event & Watermark Policy Evaluation for NEW events
  // Watermark = Maximum Event Time Observed - Allowed Lateness.
  // Maximum Arrival Delay controls simulation generation; rejection threshold is strictly the watermark policy.
  const isRejectedByWatermark =
    config.lateEventsEnabled &&
    isLate &&
    delivery.eventTime < currentWatermark;

  if (isRejectedByWatermark) {
    // Event arrived past the watermark threshold -> REJECTED
    updatedWorker.status = 'idle';
    return {
      delivery: {
        ...delivery,
        workerId: worker.id,
        status: 'Late Rejected',
        decision: 'Late Rejected',
        reason: `Late event ${delivery.eventId} (eventTime: T${delivery.eventTime}) arrived past watermark T${currentWatermark} (allowed lateness: ${config.allowedLateness} ticks) — rejected by watermark policy`,
        timestamp: delivery.logicalTime,
        processingLatency: simulateLatency(delivery, crashRng, true, queueWaitTime),
        watermarkAtArrival: currentWatermark,
        queueWaitTime,
      },
      registryEntry: null,
      workerState: updatedWorker,
      crashTriggered: false,
    };
  }

  const failAfterClaim = shouldFailAfterClaim(
    config,
    deliveryIndex,
    delivery
  );

  // 5. Processing when De-duplication is ENABLED (New unique event or accepted late event)
  if (config.deduplicationEnabled) {

    if (failAfterClaim) {
      crashTriggered = true;
      updatedWorker.status = 'crashed';
      updatedWorker.failedCount++;
      updatedWorker.currentEventId = null;

      const processingEntry: RegistryEntry = {
        eventId: delivery.eventId,
        state: 'Processing',
        processedBy: worker.id,
        processedAt: null,
        businessEffectApplied: false,
        eventTime: delivery.eventTime,
        arrivalTime: delivery.arrivalTime,
        isLate,
      };
      registry.set(delivery.eventId, processingEntry);

      return {
        delivery: {
          ...delivery,
          workerId: worker.id,
          status: 'Failed',
          decision: 'Failed',
          reason: `Worker ${worker.id} crashed after claiming event but before completing — registry left in Processing state`,
          timestamp: delivery.logicalTime,
          processingLatency: simulateLatency(delivery, crashRng, false, queueWaitTime),
          failedBeforeProcessing: false,
          watermarkAtArrival: currentWatermark,
          queueWaitTime,
        },
        registryEntry: processingEntry,
        workerState: updatedWorker,
        crashTriggered,
      };
    }

    // New unique event (or accepted late event)
    const newEntry: RegistryEntry = {
      eventId: delivery.eventId,
      state: 'Processed',
      processedBy: worker.id,
      processedAt: delivery.logicalTime,
      businessEffectApplied: true,
      eventTime: delivery.eventTime,
      arrivalTime: delivery.arrivalTime,
      isLate,
    };
    registry.set(delivery.eventId, newEntry);

    updatedWorker.status = 'idle';
    updatedWorker.processedCount++;
    updatedWorker.currentEventId = null;

    const reason = isLate
      ? `Late event ${delivery.eventId} (delay ${delivery.lateness}t) accepted within watermark — new event processed, business effect applied by worker ${worker.id}`
      : `New event processed and recorded in registry — business effect applied by worker ${worker.id}`;

    return {
      delivery: {
        ...delivery,
        workerId: worker.id,
        status: isLate ? 'Late' : 'Processed',
        decision: 'Processed',
        reason,
        timestamp: delivery.logicalTime,
        processingLatency: simulateLatency(delivery, crashRng, false, queueWaitTime),
        watermarkAtArrival: currentWatermark,
        queueWaitTime,
      },
      registryEntry: newEntry,
      workerState: updatedWorker,
      crashTriggered: false,
    };
  }

  // 5. De-duplication DISABLED — every non-rejected delivery is processed
  if (failAfterClaim) {
    crashTriggered = true;
    updatedWorker.status = 'crashed';
    updatedWorker.failedCount++;
    updatedWorker.currentEventId = null;

    return {
      delivery: {
        ...delivery,
        workerId: worker.id,
        status: 'Failed',
        decision: 'Failed',
        reason: `Worker ${worker.id} crashed during processing — no registry to prevent re-processing`,
        timestamp: delivery.logicalTime,
        processingLatency: simulateLatency(delivery, crashRng, false, queueWaitTime),
        failedBeforeProcessing: false,
        watermarkAtArrival: currentWatermark,
        queueWaitTime,
      },
      registryEntry: null,
      workerState: updatedWorker,
      crashTriggered,
    };
  }

  updatedWorker.status = 'idle';
  updatedWorker.processedCount++;
  updatedWorker.currentEventId = null;

  let reason = `New event processed by worker ${worker.id} — business effect applied`;
  if (delivery.isDuplicate) {
    reason = isLate
      ? `Duplicate late delivery processed again — no dedup registry, business effect applied again by worker ${worker.id}`
      : `Duplicate delivery processed again — no dedup registry, business effect applied again by worker ${worker.id}`;
  } else if (isLate) {
    reason = `Late event (delay ${delivery.lateness}t) processed by worker ${worker.id} — business effect applied`;
  }

  return {
    delivery: {
      ...delivery,
      workerId: worker.id,
      status: delivery.isDuplicate ? 'Duplicate' : isLate ? 'Late' : 'Processed',
      decision: 'Processed',
      reason,
      timestamp: delivery.logicalTime,
      processingLatency: simulateLatency(delivery, crashRng, false, queueWaitTime),
      watermarkAtArrival: currentWatermark,
      queueWaitTime,
    },
    registryEntry: null,
    workerState: updatedWorker,
    crashTriggered: false,
  };
}

function selectWorker(
  workers: WorkerState[],
  delivery: DeliveryAttempt,
  deliveryIndex: number
): WorkerState {
  const activeWorkers = workers.filter((w) => w.status !== 'crashed');
  if (activeWorkers.length === 0) {
    return workers[0];
  }
  const idx = deliveryIndex % activeWorkers.length;
  return activeWorkers[idx];
}

function shouldFailBeforeProcessing(
  config: SimulationConfig,
  deliveryIndex: number,
  delivery: DeliveryAttempt
): boolean {
  if (config.failureInjection !== 'worker-crash') return false;
  if (delivery.isDuplicate) return false;
  return deliveryIndex === Math.floor(config.totalEvents * 0.3) && delivery.deliveryNumber === 1;
}

function shouldFailAfterClaim(
  config: SimulationConfig,
  deliveryIndex: number,
  delivery: DeliveryAttempt
): boolean {
  if (config.failureInjection !== 'worker-crash') return false;
  if (delivery.isDuplicate) return false;
  return deliveryIndex === Math.floor(config.totalEvents * 0.6) && delivery.deliveryNumber === 1;
}

function simulateLatency(
  delivery: DeliveryAttempt,
  rng: SeededRNG,
  isCheck: boolean,
  queueWaitTime: number = 0
): number {
  const baseLatency = isCheck ? rng.int(1, 3) : rng.int(5, 25);
  return baseLatency + queueWaitTime;
}

export function retryDelivery(
  delivery: DeliveryAttempt,
  retryNumber: number,
  logicalTime: number
): DeliveryAttempt {
  return {
    ...delivery,
    uid: `${delivery.eventId}-d${delivery.deliveryNumber + retryNumber}-retry-${logicalTime}`,
    deliveryNumber: delivery.deliveryNumber + retryNumber,
    isDuplicate: false,
    status: 'Pending',
    decision: 'Retried',
    reason: `Retry attempt ${retryNumber} for event ${delivery.eventId} after worker failure`,
    timestamp: 0,
    logicalTime,
    workerId: null,
    failedBeforeProcessing: false,
    isOriginal: false,
    wasRetried: true,
  };
}
