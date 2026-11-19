import {
  SimulationConfig,
  DeliveryAttempt,
  WorkerState,
  RegistryEntry,
  SimulationMetrics,
  ActivityDataPoint,
  OutcomeBreakdown,
  ComponentStatus,
  LogicalEvent,
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
      componentStatuses: {
        producer: 'Completed' as ComponentStatus,
        queue: 'Completed' as ComponentStatus,
        dedup: state.config.deduplicationEnabled ? ('Completed' as ComponentStatus) : ('Idle' as ComponentStatus),
        registry: state.config.deduplicationEnabled ? ('Completed' as ComponentStatus) : ('Idle' as ComponentStatus),
        effect: 'Completed' as ComponentStatus,
      },
      metrics: computeMetrics(state.deliveries, state.registry, state.config),
    };
    return { done: true, state: finalState };
  }

  const registry = new Map(state.registry);
  const workers = state.workers.map((w) => ({ ...w }));
  const crashRng = new SeededRNG(state.config.seed + state.currentDeliveryIndex * 7 + 42);

  const delivery = state.deliveries[state.currentDeliveryIndex];

  const result = processDelivery(
    delivery,
    state.currentDeliveryIndex,
    registry,
    workers,
    state.config,
    crashRng
  );

  const newDeliveries = [...state.deliveries];
  newDeliveries[state.currentDeliveryIndex] = result.delivery;

  let crashInfo = state.crashInfo;
  let retryInserted = false;

  if (result.crashTriggered && !crashInfo) {
    crashInfo = {
      workerId: result.workerState.id,
      deliveryIndex: state.currentDeliveryIndex,
      reason: result.delivery.reason,
    };

    if (state.config.failureInjection === 'worker-crash' && !result.delivery.failedBeforeProcessing) {
      const retry = retryDelivery(result.delivery, 1, state.deliveries.length + 1000);
      newDeliveries.push(retry);
      retryInserted = true;
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

  const activeWorkerBusy = updatedWorkers.some((w) => w.status === 'busy');

  const componentStatuses: Record<string, ComponentStatus> = {
    producer: 'Active',
    queue: 'Active',
    dedup: state.config.deduplicationEnabled ? 'Processing' : 'Idle',
    registry: state.config.deduplicationEnabled ? 'Active' : 'Idle',
    effect: result.delivery.decision === 'Processed' ? 'Active' : 'Idle',
  };

  const activityData = [...state.activityData];
  const lastPoint = activityData[activityData.length - 1];
  const point: ActivityDataPoint = {
    time: delivery.logicalTime,
    processed: (lastPoint?.processed || 0) + (result.delivery.decision === 'Processed' ? 1 : 0),
    duplicates: (lastPoint?.duplicates || 0) + (result.delivery.decision === 'Duplicate Suppressed' ? 1 : 0),
    failed: (lastPoint?.failed || 0) + (result.delivery.decision === 'Failed' ? 1 : 0),
    retried: (lastPoint?.retried || 0) + (result.delivery.decision === 'Retried' ? 1 : 0),
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
    metrics: computeMetrics(newDeliveries, registry, state.config),
  };

  return { done: false, state: newState };
}

export function computeMetrics(
  deliveries: DeliveryAttempt[],
  registry: Map<string, RegistryEntry>,
  config: SimulationConfig
): SimulationMetrics {
  const processed = deliveries.filter((d) => d.decision === 'Processed');
  const duplicates = deliveries.filter((d) => d.decision === 'Duplicate Suppressed');
  const failed = deliveries.filter((d) => d.decision === 'Failed');
  const retried = deliveries.filter((d) => d.decision === 'Retried');

  const processedEventIds = new Set(processed.map((d) => d.eventId));
  const allEventIds = new Set(deliveries.map((d) => d.eventId));

  const latencies = processed.map((d) => d.processingLatency).filter((l) => l > 0);
  const avgLatency = latencies.length > 0
    ? latencies.reduce((a, b) => a + b, 0) / latencies.length
    : 0;
  const maxLatency = latencies.length > 0 ? Math.max(...latencies) : 0;

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
  };
}

export function computeOutcomes(deliveries: DeliveryAttempt[]): OutcomeBreakdown[] {
  const counts = {
    Processed: 0,
    'Duplicate Suppressed': 0,
    Failed: 0,
    Retried: 0,
    Pending: 0,
  };
  for (const d of deliveries) {
    counts[d.decision]++;
  }
  return [
    { name: 'Processed', value: counts.Processed, color: '#10b981' },
    { name: 'Duplicate Suppressed', value: counts['Duplicate Suppressed'], color: '#f59e0b' },
    { name: 'Failed', value: counts.Failed, color: '#ef4444' },
    { name: 'Retried', value: counts.Retried, color: '#3b82f6' },
  ].filter((o) => o.value > 0);
}

export function runFullSimulation(config: SimulationConfig): SimState {
  let state = createInitialState(config);
  state.phase = 'running';

  // Mark retried deliveries
  const deliveries = [...state.deliveries];

  let maxIterations = deliveries.length + 50;
  while (state.currentDeliveryIndex < state.deliveries.length && maxIterations > 0) {
    const result = stepSimulation(state);
    state = result.state;
    if (result.done) break;
    maxIterations--;
  }

  state.phase = 'completed';
  state.metrics = computeMetrics(state.deliveries, state.registry, state.config);
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
