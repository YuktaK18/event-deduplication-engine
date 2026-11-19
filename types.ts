export type EventType = 'payment' | 'order' | 'inventory' | 'notification' | 'transfer';

export type ProcessingDecision =
  | 'Processed'
  | 'Duplicate Suppressed'
  | 'Failed'
  | 'Retried'
  | 'Pending';

export type DeliveryStatus =
  | 'Pending'
  | 'Processing'
  | 'Processed'
  | 'Duplicate'
  | 'Failed'
  | 'Retried';

export type ComponentStatus = 'Idle' | 'Active' | 'Processing' | 'Completed' | 'Failed';

export interface LogicalEvent {
  id: string;
  type: EventType;
  sequence: number;
  payload: string;
  createdAt: number;
}

export interface DeliveryAttempt {
  uid: string;
  eventId: string;
  type: EventType;
  sequence: number;
  deliveryNumber: number;
  isDuplicate: boolean;
  workerId: number | null;
  status: DeliveryStatus;
  decision: ProcessingDecision;
  reason: string;
  timestamp: number;
  logicalTime: number;
  processingLatency: number;
  payload: string;
  createdAt: number;
  isOriginal: boolean;
  failedBeforeProcessing: boolean;
  wasRetried: boolean;
}

export interface WorkerState {
  id: number;
  status: 'idle' | 'busy' | 'crashed';
  currentEventId: string | null;
  processedCount: number;
  failedCount: number;
}

export interface RegistryEntry {
  eventId: string;
  state: 'Pending' | 'Processing' | 'Processed';
  processedBy: number | null;
  processedAt: number | null;
  businessEffectApplied: boolean;
}

export interface SimulationConfig {
  totalEvents: number;
  duplicateRate: number;
  workerCount: number;
  deduplicationEnabled: boolean;
  ordering: 'ordered' | 'out-of-order';
  failureInjection: 'none' | 'worker-crash';
  speed: 'slow' | 'normal' | 'fast';
  seed: number;
}

export interface SimulationMetrics {
  totalDeliveryAttempts: number;
  uniqueLogicalEvents: number;
  processedLogicalEvents: number;
  duplicatesSuppressed: number;
  businessEffects: number;
  failedAttempts: number;
  retryCount: number;
  averageLatency: number;
  maxLatency: number;
  duplicateRate: number;
}

export interface ActivityDataPoint {
  time: number;
  processed: number;
  duplicates: number;
  failed: number;
  retried: number;
}

export interface OutcomeBreakdown {
  name: string;
  value: number;
  color: string;
}

export interface ComparisonResult {
  configWithout: SimulationConfig;
  configWith: SimulationConfig;
  metricsWithout: SimulationMetrics;
  metricsWith: SimulationMetrics;
  eventsGenerated: number;
  duplicateDeliveries: number;
}

export interface ExperimentPreset {
  id: string;
  name: string;
  description: string;
  hypothesis: string;
  config: SimulationConfig;
}

export type SimPhase = 'idle' | 'running' | 'paused' | 'completed';

export interface SimState {
  phase: SimPhase;
  config: SimulationConfig;
  deliveries: DeliveryAttempt[];
  workers: WorkerState[];
  registry: Map<string, RegistryEntry>;
  metrics: SimulationMetrics;
  activityData: ActivityDataPoint[];
  outcomes: OutcomeBreakdown[];
  componentStatuses: Record<string, ComponentStatus>;
  currentDeliveryIndex: number;
  logicalEvents: LogicalEvent[];
  crashInfo: { workerId: number; deliveryIndex: number; reason: string; retryEventId: string | null } | null;
}
