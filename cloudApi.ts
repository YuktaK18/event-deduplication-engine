// Client for the AWS backend (API Gateway + Lambda + DynamoDB).
// Nothing in the existing simulator imports this file, so the simulator is untouched.

import type {
  DeliveryAttempt,
  DeliveryStatus,
  EventType,
  ProcessingDecision,
  SimulationMetrics,
} from '@/sim/types';

// Set VITE_API_BASE_URL in .env.local (development) or in Netlify's environment variables (production).
// Vite copies it into the build, so after changing it on Netlify you must trigger a new deploy.
const RAW_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '';
export const API_BASE_URL = RAW_BASE_URL.trim().replace(/\/+$/, '');
export const isCloudConfigured = API_BASE_URL.length > 0;

// ---------- Types that mirror the backend's JSON ----------

export interface SubmitEventRequest {
  eventId: string;
  type: EventType;
  payload?: string;
  timestamp?: string | number;
}

export interface SubmitEventResponse {
  ok: true;
  eventId: string;
  type: EventType;
  status: 'Processed' | 'Duplicate'; // same words as the frontend's DeliveryStatus
  decision: 'Processed' | 'Duplicate Suppressed'; // same words as the frontend's ProcessingDecision
  duplicate: boolean;
  businessEffectApplied: boolean;
  deliveryNumber: number;
  reason: string;
  firstSeenAt: string;
  processedAt: string;
  expiresAt: string;
  processingLatency: number;
  requestId: string;
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

// One error type for everything that can go wrong (bad input, server error, network down, timeout).
export class CloudApiError extends Error {
  status: number; // HTTP status, or 0 when the server could not be reached
  code: string; // e.g. VALIDATION_ERROR, INTERNAL_ERROR, NETWORK_ERROR, TIMEOUT
  details?: { field: string; message: string }[];

  constructor(status: number, code: string, message: string, details?: { field: string; message: string }[]) {
    super(message);
    this.name = 'CloudApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

// ---------- Low-level request helper ----------

async function request<T>(path: string, init?: RequestInit, timeoutMs = 10000): Promise<{ status: number; data: T }> {
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
      // The body was not JSON; handled below.
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
      'Could not reach the cloud backend. Check the API URL, your internet connection and the CORS setting.'
    );
  } finally {
    clearTimeout(timer);
  }
}

// ---------- The three API calls ----------

// POST /events  ->  201 (new) or 200 (duplicate). Both resolve; bad input / server problems throw CloudApiError.
export async function submitEvent(event: SubmitEventRequest): Promise<SubmitEventResponse> {
  const { data } = await request<SubmitEventResponse>('/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(event),
  });
  return data;
}

// GET /stats
export async function getStats(): Promise<CloudStats> {
  const { data } = await request<{ ok: true; stats: CloudStats }>('/stats');
  return data.stats;
}

// GET /events/{eventId}  (throws CloudApiError with status 404 if unknown or expired)
export async function getStoredEvent(eventId: string): Promise<StoredEvent> {
  const { data } = await request<{ ok: true; event: StoredEvent }>(`/events/${encodeURIComponent(eventId)}`);
  return data.event;
}

// ---------- Converters: cloud results -> the shapes the existing UI components already understand ----------

// So the existing <MetricsPanel> can display cloud statistics.
export function toSimulationMetrics(stats: CloudStats): SimulationMetrics {
  return {
    totalDeliveryAttempts: stats.totalDeliveryAttempts,
    uniqueLogicalEvents: stats.uniqueLogicalEvents,
    processedLogicalEvents: stats.processedLogicalEvents,
    duplicatesSuppressed: stats.duplicatesSuppressed,
    businessEffects: stats.businessEffects,
    failedAttempts: stats.failedAttempts,
    retryCount: 0, // the cloud API does not retry anything
    averageLatency: stats.averageLatency,
    maxLatency: 0, // not tracked by the backend
    duplicateRate: stats.duplicateRate,
  };
}

// So the existing <EventTraceTable> can list real API responses.
export function toDeliveryAttempt(
  request: SubmitEventRequest,
  response: SubmitEventResponse,
  sequence: number
): DeliveryAttempt {
  return {
    uid: `cloud-${sequence}-${response.requestId}`,
    eventId: response.eventId,
    type: response.type,
    sequence,
    deliveryNumber: response.deliveryNumber,
    isDuplicate: response.duplicate,
    workerId: null, // Lambda has no numbered workers
    status: response.status as DeliveryStatus,
    decision: response.decision as ProcessingDecision,
    reason: response.reason,
    timestamp: Date.parse(response.processedAt),
    logicalTime: sequence,
    processingLatency: response.processingLatency,
    payload: request.payload ?? '',
    createdAt: Date.parse(response.firstSeenAt),
    isOriginal: !response.duplicate,
    failedBeforeProcessing: false,
    wasRetried: false,
  };
}

// A request that never produced a normal response (validation error, network error, ...).
export function toFailedAttempt(request: SubmitEventRequest, error: CloudApiError, sequence: number): DeliveryAttempt {
  return {
    uid: `cloud-${sequence}-failed`,
    eventId: request.eventId,
    type: request.type,
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
    payload: request.payload ?? '',
    createdAt: Date.now(),
    isOriginal: false,
    failedBeforeProcessing: true,
    wasRetried: false,
  };
}
