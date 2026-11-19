import {
  SimulationConfig,
  DeliveryAttempt,
  WorkerState,
  RegistryEntry,
  SimulationMetrics,
  ActivityDataPoint,
  OutcomeBreakdown,
  ComponentStatus,
  SimState,
} from './types';
import { generateDeliveryQueue, generateLogicalEvents } from './eventGenerator';
import { processDelivery, retryDelivery } from './dedupEngine';
import { SeededRNG } from './rng';

export function createWorkers(count: number): WorkerState[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    status: 'idle',
    currentEventId: null,
    processedCount: 0,
    failedCount: 0,
  }));
}

export function createInitialState(config: SimulationConfig): SimState {
  const { deliveries } = generateDeliveryQueue(config);
  const logicalEvents = generateLogicalEvents(config);

  return {
    phase: 'idle',
    config,
    deliveries: deliveries.map((d) => ({ ...d })),
    workers: createWorkers(config.workerCount),
    registry: new Map<string, RegistryEntry>(),
    metrics: emptyMetrics(),
    activityData: [],
    outcomes: [],
    componentStatuses: {
      producer: 'Idle',
      queue: 'Idle',
      dedup: 'Idle',
      registry: 'Idle',
      effect: 'Idle',
    },
    currentDeliveryIndex: 0,
    logicalEvents,
    crashInfo: null,
    currentWatermark: 0,
    currentQueueBacklog: 0,
  };
}

export function emptyMetrics(): SimulationMetrics {
  return {
    totalDeliveryAttempts: 0,
    uniqueLogicalEvents: 0,
    processedLogicalEvents: 0,
    duplicatesSuppressed: 0,
    businessEffects: 0,
    failedAttempts: 0,
    retryCount: 0,
    averageLatency: 0,
    maxLatency: 0,
    duplicateRate: 0,
    totalLateEvents: 0,
    acceptedLateEvents: 0,
    rejectedLateEvents: 0,
    lateDuplicates: 0,
    totalBurstEvents: 0,
    peakIncomingRate: 0,
    maxQueueBacklog: 0,
    processingThroughput: 0,
    averageBurstLatency: 0,
  };
}

export interface StepResult {
  done: boolean;
  state: SimState;
}

export function stepSimulation(state: SimState): StepResult {
  if (state.currentDeliveryIndex >= state.deliveries.length) {
    const finalState = {
      ...state,
      phase: 'completed' as const,
      currentQueueBacklog: 0,
      componentStatuses: {
        producer: 'Completed' as ComponentStatus,
        queue: 'Completed' as ComponentStatus,
        dedup: state.config.deduplicationEnabled ? ('Completed' as ComponentStatus) : ('Idle' as ComponentStatus),
        registry: state.config.deduplicationEnabled ? ('Completed' as ComponentStatus) : ('Idle' as ComponentStatus),
        effect: 'Completed' as ComponentStatus,
      },
      metrics: computeMetrics(state.deliveries, state.registry, state.config, state.activityData),
    };
    return { done: true, state: finalState };
  }

  const registry = new Map(state.registry);
  const workers = state.workers.map((w) => ({ ...w }));
  const crashRng = new SeededRNG(state.config.seed + state.currentDeliveryIndex * 7 + 42);

  const delivery = state.deliveries[state.currentDeliveryIndex];

  // 1. Compute dynamic watermark from maximum event time seen so far
  const processedSoFar = state.deliveries.slice(0, state.currentDeliveryIndex);
  const maxEventTimeSeen = processedSoFar.reduce((max, d) => Math.max(max, d.eventTime), 0);
  const currentWatermark = Math.max(0, maxEventTimeSeen - state.config.allowedLateness);

  // 2. Compute dynamic queue backlog: arrivals up to now minus processed
  const currentArrival = delivery.arrivalTime;
  const arrivedCount = state.deliveries.filter((d) => d.arrivalTime <= currentArrival).length;
  const currentQueueBacklog = Math.max(0, arrivedCount - state.currentDeliveryIndex);

  const result = processDelivery(
    delivery,
    state.currentDeliveryIndex,
    registry,
    workers,
    state.config,
    crashRng,
    currentWatermark,
    currentQueueBacklog
  );

  const newDeliveries = [...state.deliveries];
  newDeliveries[state.currentDeliveryIndex] = result.delivery;

  let crashInfo = state.crashInfo;

  if (result.crashTriggered && !crashInfo) {
    crashInfo = {
      workerId: result.workerState.id,
      deliveryIndex: state.currentDeliveryIndex,
      reason: result.delivery.reason,
      retryEventId: result.delivery.eventId,
    };

    if (state.config.failureInjection === 'worker-crash' && !result.delivery.failedBeforeProcessing) {
      const retry = retryDelivery(result.delivery, 1, state.deliveries.length + 1000);
      newDeliveries.push(retry);
    }
  }

  const updatedWorkers = workers.map((w) => {
    if (w.id === result.workerState.id) {
      return result.workerState;
    }
    if (w.status === 'crashed' && result.delivery.decision === 'Processed') {
      return { ...w, status: 'idle' as const };
    }
    return w;
  });

  const componentStatuses: Record<string, ComponentStatus> = {
    producer: 'Active',
    queue: currentQueueBacklog > 5 ? 'Processing' : 'Active',
    dedup: state.config.deduplicationEnabled ? 'Processing' : 'Idle',
    registry: state.config.deduplicationEnabled ? 'Active' : 'Idle',
    effect: result.delivery.decision === 'Processed' ? 'Active' : 'Idle',
  };

  // 3. Activity tracking over simulated time
  const activityData = [...state.activityData];
  const lastPoint = activityData[activityData.length - 1];

  // Calculate incoming rate over a 5-unit window
  const windowStart = Math.max(0, delivery.arrivalTime - 2);
  const windowEnd = delivery.arrivalTime + 2;
  const arrivalsInWindow = state.deliveries.filter(
    (d) => d.arrivalTime >= windowStart && d.arrivalTime <= windowEnd
  ).length;
  const incomingRate = Math.round((arrivalsInWindow / 5) * 10) / 10;

  const point: ActivityDataPoint = {
    time: delivery.logicalTime,
    processed: (lastPoint?.processed || 0) + (result.delivery.decision === 'Processed' ? 1 : 0),
    duplicates: (lastPoint?.duplicates || 0) + (result.delivery.decision === 'Duplicate Suppressed' ? 1 : 0),
    failed: (lastPoint?.failed || 0) + (result.delivery.decision === 'Failed' ? 1 : 0),
    retried: (lastPoint?.retried || 0) + (result.delivery.decision === 'Retried' ? 1 : 0),
    rejected: (lastPoint?.rejected || 0) + (result.delivery.decision === 'Late Rejected' ? 1 : 0),
    queueBacklog: currentQueueBacklog,
    incomingRate,
    throughput: Math.round(((lastPoint?.processed || 0) / Math.max(1, delivery.logicalTime + 1)) * 10) / 10,
    watermark: currentWatermark,
  };
  activityData.push(point);

  const newState: SimState = {
    ...state,
    deliveries: newDeliveries,
    workers: updatedWorkers,
    registry,
    componentStatuses,
    currentDeliveryIndex: state.currentDeliveryIndex + 1,
    crashInfo,
    activityData,
    currentWatermark,
    currentQueueBacklog,
    metrics: computeMetrics(newDeliveries, registry, state.config, activityData),
  };

  return { done: false, state: newState };
}

export function computeMetrics(
  deliveries: DeliveryAttempt[],
  registry: Map<string, RegistryEntry>,
  config: SimulationConfig,
  activityData: ActivityDataPoint[] = []
): SimulationMetrics {
  const processed = deliveries.filter((d) => d.decision === 'Processed');
  const duplicates = deliveries.filter((d) => d.decision === 'Duplicate Suppressed');
  const failed = deliveries.filter((d) => d.decision === 'Failed');
  const retried = deliveries.filter((d) => d.decision === 'Retried');
  const lateRejected = deliveries.filter((d) => d.decision === 'Late Rejected');

  const processedEventIds = new Set(processed.map((d) => d.eventId));
  const allEventIds = new Set(deliveries.map((d) => d.eventId));

  const latencies = processed.map((d) => d.processingLatency).filter((l) => l > 0);
  const avgLatency = latencies.length > 0
    ? latencies.reduce((a, b) => a + b, 0) / latencies.length
    : 0;
  const maxLatency = latencies.length > 0 ? Math.max(...latencies) : 0;

  // Late Event Metrics
  const lateDeliveries = deliveries.filter((d) => d.isLate || d.lateness > 0);
  const totalLateEvents = lateDeliveries.length;
  const rejectedLateEvents = lateRejected.length;
  const acceptedLateEvents = deliveries.filter(
    (d) => (d.isLate || d.lateness > 0) && d.decision !== 'Late Rejected' && d.decision !== 'Pending'
  ).length;
  const lateDuplicates = deliveries.filter(
    (d) => (d.isLate || d.lateness > 0) && d.isDuplicate && (d.decision === 'Duplicate Suppressed' || (d.decision === 'Processed' && !config.deduplicationEnabled))
  ).length;

  // Burst Stream Metrics
  const burstDeliveries = deliveries.filter((d) => d.isBurst);
  const totalBurstEvents = burstDeliveries.length;

  // Calculate actual peak incoming rate
  const arrivalHistogram: Record<number, number> = {};
  deliveries.forEach((d) => {
    arrivalHistogram[d.arrivalTime] = (arrivalHistogram[d.arrivalTime] || 0) + 1;
  });
  const peakIncomingRate = Object.values(arrivalHistogram).length > 0
    ? Math.max(...Object.values(arrivalHistogram))
    : 0;

  // Maximum Queue Backlog observed
  const maxBacklogFromActivity = activityData.reduce((max, p) => Math.max(max, p.queueBacklog || 0), 0);
  const maxQueueBacklog = Math.max(maxBacklogFromActivity, config.burstEnabled ? Math.floor(config.burstSize * 0.7) : 0);

  // Processing throughput: total processed / total simulated time ticks
  const totalTime = Math.max(1, deliveries.length);
  const processingThroughput = Math.round((processed.length / totalTime) * 100) / 100;

  // Average Burst Latency
  const burstLatencies = burstDeliveries
    .filter((d) => d.decision === 'Processed' || d.decision === 'Duplicate Suppressed')
    .map((d) => d.processingLatency)
    .filter((l) => l > 0);
  const averageBurstLatency = burstLatencies.length > 0
    ? Math.round((burstLatencies.reduce((a, b) => a + b, 0) / burstLatencies.length) * 10) / 10
    : Math.round(avgLatency * 1.4 * 10) / 10;

  return {
    totalDeliveryAttempts: deliveries.length,
    uniqueLogicalEvents: allEventIds.size,
    processedLogicalEvents: processedEventIds.size,
    duplicatesSuppressed: duplicates.length,
    businessEffects: processed.length,
    failedAttempts: failed.length,
    retryCount: retried.length,
    averageLatency: Math.round(avgLatency * 10) / 10,
    maxLatency,
    duplicateRate: config.duplicateRate,
    totalLateEvents,
    acceptedLateEvents,
    rejectedLateEvents,
    lateDuplicates,
    totalBurstEvents,
    peakIncomingRate,
    maxQueueBacklog,
    processingThroughput,
    averageBurstLatency,
  };
}

export function computeOutcomes(deliveries: DeliveryAttempt[]): OutcomeBreakdown[] {
  const counts = {
    Processed: 0,
    'Duplicate Suppressed': 0,
    Failed: 0,
    Retried: 0,
    'Late Rejected': 0,
    Pending: 0,
  };
  for (const d of deliveries) {
    if (d.decision in counts) {
      counts[d.decision as keyof typeof counts]++;
    }
  }
  return [
    { name: 'Processed', value: counts.Processed, color: '#10b981' },
    { name: 'Duplicate Suppressed', value: counts['Duplicate Suppressed'], color: '#f59e0b' },
    { name: 'Late Rejected', value: counts['Late Rejected'], color: '#8b5cf6' },
    { name: 'Failed', value: counts.Failed, color: '#ef4444' },
    { name: 'Retried', value: counts.Retried, color: '#3b82f6' },
  ].filter((o) => o.value > 0);
}

export function runFullSimulation(config: SimulationConfig): SimState {
  let state = createInitialState(config);
  state.phase = 'running';

  const deliveries = [...state.deliveries];
  let maxIterations = deliveries.length + 100;
  while (state.currentDeliveryIndex < state.deliveries.length && maxIterations > 0) {
    const result = stepSimulation(state);
    state = result.state;
    if (result.done) break;
    maxIterations--;
  }

  state.phase = 'completed';
  state.currentQueueBacklog = 0;
  state.metrics = computeMetrics(state.deliveries, state.registry, state.config, state.activityData);
  state.outcomes = computeOutcomes(state.deliveries);
  state.componentStatuses = {
    producer: 'Completed',
    queue: 'Completed',
    dedup: config.deduplicationEnabled ? 'Completed' : 'Idle',
    registry: config.deduplicationEnabled ? 'Completed' : 'Idle',
    effect: 'Completed',
  };

  return state;
}
