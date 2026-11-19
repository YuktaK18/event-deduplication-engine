// Client for the AWS backend (API Gateway + Lambda + DynamoDB).
// Nothing in the existing simulator imports this file, preserving all existing simulator features.

import type {
  DeliveryAttempt,
  DeliveryStatus,
  EventType,
  ProcessingDecision,
  SimulationMetrics,
} from '@/sim/types';

// Set VITE_API_BASE_URL in .env.local (development) or in Netlify's environment variables (production).
const RAW_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '';
export const API_BASE_URL = RAW_BASE_URL.trim().replace(/\/+$/, '');
export const isCloudConfigured = API_BASE_URL.length > 0;

// ---------- Types mirroring backend JSON ----------

export interface SubmitEventRequest {
  eventId: string;
  type: EventType;
  payload?: string;
  timestamp?: string | number;
  allowedLatenessSeconds?: number;
  watermark?: number;
  isBurst?: boolean;
}

export interface SubmitEventResponse {
  ok: true;
  eventId: string;
  type: EventType;
  status: 'Processed' | 'Duplicate' | 'Late' | 'Late Rejected';
  decision: 'Processed' | 'Duplicate Suppressed' | 'Late Rejected';
  duplicate: boolean;
  businessEffectApplied: boolean;
  deliveryNumber: number;
  reason: string;
  firstSeenAt: string;
  processedAt: string;
  expiresAt: string;
  processingLatency: number;
  requestId: string;
  latenessSeconds?: number;
  isLate?: boolean;
  isLateRejected?: boolean;
  isBurst?: boolean;
  watermark?: string;
}

export interface SubmitBurstRequest {
  burstId?: string;
  events: SubmitEventRequest[];
}

export interface SubmitBurstResponse {
  ok: true;
  burstId: string;
  receivedEvents: number;
  processedEvents: number;
  duplicatesSuppressed: number;
  lateRejected: number;
  failedEvents: number;
  totalLatencyMs: number;
  averageLatencyMs: number;
  throughputEventsPerSec: number;
  elapsedMs: number;
  results: SubmitEventResponse[];
  requestId?: string;
}

export interface CloudStats {
  totalDeliveryAttempts: number;
  uniqueLogicalEvents: number;
  processedLogicalEvents: number;
  duplicatesSuppressed: number;
  businessEffects: number;
  failedAttempts: number;
  invalidRequests: number;
  averageLatency: number;
  duplicateRate: number;
  retentionHours: number;
  totalLateEvents?: number;
  acceptedLateEvents?: number;
  rejectedLateEvents?: number;
  lateDuplicates?: number;
  totalBurstEvents?: number;
  maxEventTimeMs?: number;
}

export interface StoredEvent {
  eventId: string;
  type: EventType;
  payload: string;
  eventTimestamp: string | null;
  firstSeenAt: string;
  duplicateCount: number;
  lastDuplicateAt: string | null;
  expiresAt: string;
}

interface ErrorBody {
  ok: false;
  error: { code: string; message: string; details?: { field: string; message: string }[] };
  requestId?: string;
}

export class CloudApiError extends Error {
  status: number;
  code: string;
  details?: { field: string; message: string }[];

  constructor(status: number, code: string, message: string, details?: { field: string; message: string }[]) {
    super(message);
    this.name = 'CloudApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

// ---------- Low-level HTTP helper ----------

async function request<T>(path: string, init?: RequestInit, timeoutMs = 15000): Promise<{ status: number; data: T }> {
  if (!isCloudConfigured) {
    throw new CloudApiError(0, 'NOT_CONFIGURED', 'VITE_API_BASE_URL is not set, so the cloud backend cannot be reached.');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${API_BASE_URL}${path}`, { ...init, signal: controller.signal });

    let data: unknown = null;
    try {
      data = await response.json();
    } catch {
      // Non-JSON response handled below
    }

    if (!response.ok) {
      const body = data as Partial<ErrorBody> | null;
      throw new CloudApiError(
        response.status,
        body?.error?.code ?? `HTTP_${response.status}`,
        body?.error?.message ?? `The server answered with status ${response.status}`,
        body?.error?.details
      );
    }

    return { status: response.status, data: data as T };
  } catch (err) {
    if (err instanceof CloudApiError) throw err;
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new CloudApiError(0, 'TIMEOUT', `The server did not answer within ${timeoutMs / 1000} seconds.`);
    }
    throw new CloudApiError(
      0,
      'NETWORK_ERROR',
      'Could not reach the cloud backend. Check that the backend server is running and CORS is enabled.'
    );
  } finally {
    clearTimeout(timer);
  }
}

// ---------- API Calls ----------

export async function submitEvent(event: SubmitEventRequest): Promise<SubmitEventResponse> {
  const { data } = await request<SubmitEventResponse>('/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(event),
  });
  return data;
}

export async function submitBurst(burst: SubmitBurstRequest): Promise<SubmitBurstResponse> {
  const { data } = await request<SubmitBurstResponse>('/events/burst', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(burst),
  });
  return data;
}

export async function getStats(): Promise<CloudStats> {
  const { data } = await request<{ ok: true; stats: CloudStats }>('/stats');
  return data.stats;
}

export async function getStoredEvent(eventId: string): Promise<StoredEvent> {
  const { data } = await request<{ ok: true; event: StoredEvent }>(`/events/${encodeURIComponent(eventId)}`);
  return data.event;
}

// ---------- Converters to UI Shapes ----------

export function toSimulationMetrics(stats: CloudStats): SimulationMetrics {
  return {
    totalDeliveryAttempts: stats.totalDeliveryAttempts,
    uniqueLogicalEvents: stats.uniqueLogicalEvents,
    processedLogicalEvents: stats.processedLogicalEvents,
    duplicatesSuppressed: stats.duplicatesSuppressed,
    businessEffects: stats.businessEffects,
    failedAttempts: stats.failedAttempts,
    retryCount: 0,
    averageLatency: stats.averageLatency,
    maxLatency: 0,
    duplicateRate: stats.duplicateRate,
    totalLateEvents: stats.totalLateEvents ?? 0,
    acceptedLateEvents: stats.acceptedLateEvents ?? 0,
    rejectedLateEvents: stats.rejectedLateEvents ?? 0,
    lateDuplicates: stats.lateDuplicates ?? 0,
    totalBurstEvents: stats.totalBurstEvents ?? 0,
    peakIncomingRate: 0,
    maxQueueBacklog: 0,
    processingThroughput: 0,
    averageBurstLatency: 0,
  };
}

export function toDeliveryAttempt(
  requestPayload: SubmitEventRequest,
  response: SubmitEventResponse,
  sequence: number
): DeliveryAttempt {
  const isLate = Boolean(response.isLate || (response.latenessSeconds && response.latenessSeconds > 0));
  const eventTime = requestPayload.timestamp
    ? (typeof requestPayload.timestamp === 'number' ? requestPayload.timestamp : Date.parse(requestPayload.timestamp) || sequence)
    : sequence;
  const arrivalTime = Date.parse(response.firstSeenAt) || sequence;

  return {
    uid: `cloud-${sequence}-${response.requestId || Date.now()}`,
    eventId: response.eventId,
    type: response.type,
    sequence,
    deliveryNumber: response.deliveryNumber,
    isDuplicate: response.duplicate,
    workerId: null,
    status: (response.status || (response.duplicate ? 'Duplicate' : 'Processed')) as DeliveryStatus,
    decision: (response.decision || (response.duplicate ? 'Duplicate Suppressed' : 'Processed')) as ProcessingDecision,
    reason: response.reason,
    timestamp: Date.parse(response.processedAt) || Date.now(),
    logicalTime: sequence,
    processingLatency: response.processingLatency,
    payload: requestPayload.payload ?? '',
    createdAt: Date.parse(response.firstSeenAt) || Date.now(),
    isOriginal: !response.duplicate,
    failedBeforeProcessing: false,
    wasRetried: false,
    eventTime,
    arrivalTime,
    lateness: response.latenessSeconds ?? 0,
    isLate,
    isBurst: Boolean(response.isBurst),
    watermarkAtArrival: 0,
    queueWaitTime: 0,
  };
}

export function toFailedAttempt(requestPayload: SubmitEventRequest, error: CloudApiError, sequence: number): DeliveryAttempt {
  const eventTime = requestPayload.timestamp
    ? (typeof requestPayload.timestamp === 'number' ? requestPayload.timestamp : Date.parse(requestPayload.timestamp) || sequence)
    : sequence;

  return {
    uid: `cloud-${sequence}-failed`,
    eventId: requestPayload.eventId,
    type: requestPayload.type,
    sequence,
    deliveryNumber: 1,
    isDuplicate: false,
    workerId: null,
    status: 'Failed',
    decision: 'Failed',
    reason: `${error.code}: ${error.message}`,
    timestamp: Date.now(),
    logicalTime: sequence,
    processingLatency: 0,
    payload: requestPayload.payload ?? '',
    createdAt: Date.now(),
    isOriginal: false,
    failedBeforeProcessing: true,
    wasRetried: false,
    eventTime,
    arrivalTime: sequence,
    lateness: 0,
    isLate: false,
    isBurst: Boolean(requestPayload.isBurst),
    watermarkAtArrival: 0,
    queueWaitTime: 0,
  };
}
