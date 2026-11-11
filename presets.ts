import { ExperimentPreset, SimulationConfig } from './types';

export const DEFAULT_CONFIG: SimulationConfig = {
  totalEvents: 100,
  duplicateRate: 30,
  workerCount: 2,
  deduplicationEnabled: true,
  ordering: 'ordered',
  failureInjection: 'none',
  speed: 'normal',
  seed: 42,
};

export const EXPERIMENT_PRESETS: ExperimentPreset[] = [
  {
    id: 'duplicate-payments',
    name: 'A: Duplicate Payments',
    description:
      'Generate 50 payment events with 40% duplicate delivery rate. Run with de-duplication enabled and disabled to see how many business effects (charges) are applied in each case.',
    hypothesis:
      'With dedup disabled, 70 deliveries produce 70 charges. With dedup enabled, only 50 unique charges are applied and 20 duplicates are suppressed.',
    config: {
      totalEvents: 50,
      duplicateRate: 40,
      workerCount: 2,
      deduplicationEnabled: true,
      ordering: 'ordered',
      failureInjection: 'none',
      speed: 'fast',
      seed: 100,
    },
  },
  {
    id: 'out-of-order',
    name: 'B: Out-of-Order Events',
    description:
      'Deliver 60 events in shuffled order. The event ID (not the arrival sequence) determines identity — de-duplication still works correctly regardless of arrival order.',
    hypothesis:
      'Even with shuffled delivery, the registry correctly identifies duplicates by event ID. Ordering is a delivery property, not an identity property.',
    config: {
      totalEvents: 60,
      duplicateRate: 25,
      workerCount: 3,
      deduplicationEnabled: true,
      ordering: 'out-of-order',
      failureInjection: 'none',
      speed: 'fast',
      seed: 200,
    },
  },
  {
    id: 'worker-crash',
    name: 'C: Worker Crash & Recovery',
    description:
      'Inject a deterministic worker crash. Observe the failed attempt, the registry state left behind, and how a retry with the same event ID is handled by the dedup engine.',
    hypothesis:
      'If a worker crashes after claiming an event, the registry may be left in a Processing state. A retry with the same event ID is either suppressed (if processed) or re-attempted.',
    config: {
      totalEvents: 40,
      duplicateRate: 20,
      workerCount: 2,
      deduplicationEnabled: true,
      ordering: 'ordered',
      failureInjection: 'worker-crash',
      speed: 'fast',
      seed: 300,
    },
  },
];
