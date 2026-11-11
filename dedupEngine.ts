import {
  DeliveryAttempt,
  RegistryEntry,
  WorkerState,
  SimulationConfig,
  ProcessingDecision,
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
  crashRng: SeededRNG
): ProcessingResult {
  const worker = selectWorker(workers, delivery, deliveryIndex);
  const updatedWorkers = workers.map((w) => ({ ...w }));
  const updatedWorker = updatedWorkers.find((w) => w.id === worker.id)!;

  let crashTriggered = false;
  let registryEntry: RegistryEntry | null = null;

  const failBeforeProcessing = shouldFailBeforeProcessing(
    config,
    deliveryIndex,
    delivery,
    crashRng
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
      },
      registryEntry: null,
      workerState: updatedWorker,
      crashTriggered,
    };
  }

  const failAfterClaim = shouldFailAfterClaim(
    config,
    deliveryIndex,
    delivery,
    crashRng
  );

  if (config.deduplicationEnabled) {
    const existing = registry.get(delivery.eventId);

    if (existing && existing.state === 'Processed') {
      return {
        delivery: {
          ...delivery,
          workerId: worker.id,
          status: 'Duplicate',
          decision: 'Duplicate Suppressed',
          reason: `Event ${delivery.eventId} already processed — duplicate delivery suppressed by registry`,
          timestamp: delivery.logicalTime,
          processingLatency: simulateLatency(delivery, crashRng, true),
        },
        registryEntry: existing,
        workerState: { ...updatedWorker, status: 'idle' },
        crashTriggered: false,
      };
    }

    if (existing && existing.state === 'Processing') {
      if (delivery.wasRetried) {
        // Retry after a crash: the worker that left this entry has crashed.
        // Clear the stale Processing entry and reprocess the event.
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
            processingLatency: simulateLatency(delivery, crashRng, true),
          },
          registryEntry: existing,
          workerState: { ...updatedWorker, status: 'idle' },
          crashTriggered: false,
        };
      }
    }

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
          processingLatency: simulateLatency(delivery, crashRng, false),
          failedBeforeProcessing: false,
        },
        registryEntry: processingEntry,
        workerState: updatedWorker,
        crashTriggered,
      };
    }

    const newEntry: RegistryEntry = {
      eventId: delivery.eventId,
      state: 'Processed',
      processedBy: worker.id,
      processedAt: delivery.logicalTime,
      businessEffectApplied: true,
    };
    registry.set(delivery.eventId, newEntry);

    updatedWorker.status = 'idle';
    updatedWorker.processedCount++;
    updatedWorker.currentEventId = null;

    return {
      delivery: {
        ...delivery,
        workerId: worker.id,
        status: 'Processed',
        decision: 'Processed',
        reason: `New event processed and recorded in registry — business effect applied by worker ${worker.id}`,
        timestamp: delivery.logicalTime,
        processingLatency: simulateLatency(delivery, crashRng, false),
      },
      registryEntry: newEntry,
      workerState: updatedWorker,
      crashTriggered: false,
    };
  }

  // De-duplication disabled — every delivery is processed
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
        processingLatency: simulateLatency(delivery, crashRng, false),
        failedBeforeProcessing: false,
      },
      registryEntry: null,
      workerState: updatedWorker,
      crashTriggered,
    };
  }

  updatedWorker.status = 'idle';
  updatedWorker.processedCount++;
  updatedWorker.currentEventId = null;

  const decision: ProcessingDecision = delivery.isDuplicate
    ? 'Processed'
    : 'Processed';

  return {
    delivery: {
      ...delivery,
      workerId: worker.id,
      status: 'Processed',
      decision,
      reason: delivery.isDuplicate
        ? `Duplicate delivery processed again — no dedup registry, business effect applied again by worker ${worker.id}`
        : `New event processed by worker ${worker.id} — business effect applied`,
      timestamp: delivery.logicalTime,
      processingLatency: simulateLatency(delivery, crashRng, false),
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
  delivery: DeliveryAttempt,
  rng: SeededRNG
): boolean {
  if (config.failureInjection !== 'worker-crash') return false;
  if (delivery.isDuplicate) return false;
  return deliveryIndex === Math.floor(config.totalEvents * 0.3) && delivery.deliveryNumber === 1;
}

function shouldFailAfterClaim(
  config: SimulationConfig,
  deliveryIndex: number,
  delivery: DeliveryAttempt,
  rng: SeededRNG
): boolean {
  if (config.failureInjection !== 'worker-crash') return false;
  if (delivery.isDuplicate) return false;
  return deliveryIndex === Math.floor(config.totalEvents * 0.6) && delivery.deliveryNumber === 1;
}

function simulateLatency(
  delivery: DeliveryAttempt,
  rng: SeededRNG,
  isCheck: boolean
): number {
  if (isCheck) return rng.int(1, 3);
  return rng.int(5, 25);
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
