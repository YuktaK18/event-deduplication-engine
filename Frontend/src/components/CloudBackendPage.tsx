import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Cloud,
  Send,
  Shuffle,
  Zap,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Layers,
  Activity,
} from 'lucide-react';
import { DeliveryAttempt, EventType } from '@/sim/types';
import {
  API_BASE_URL,
  CloudApiError,
  CloudStats,
  SubmitEventRequest,
  getStats,
  isCloudConfigured,
  submitEvent,
  submitBurst,
  toDeliveryAttempt,
  toFailedAttempt,
  toSimulationMetrics,
} from '@/api/cloudApi';
import { MetricsPanel } from './MetricsPanel';
import { EventTraceTable } from './EventTraceTable';

const EVENT_TYPES: EventType[] = ['payment', 'order', 'inventory', 'notification', 'transfer'];
const CONCURRENCY_OPTIONS = [5, 10, 25, 50];
const BURST_SIZE_OPTIONS = [10, 25, 50, 100];
const MAX_TRACE_ROWS = 200;

type Connection = 'unknown' | 'online' | 'offline';

interface ConcurrencySummary {
  eventId: string;
  sent: number;
  created: number;
  duplicates: number;
  failed: number;
}

interface BurstSummary {
  burstId: string;
  received: number;
  processed: number;
  duplicates: number;
  lateRejected: number;
  failed: number;
  throughput: number;
  averageLatency: number;
}

function makeEventId(prefix = 'web'): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function CloudBackendPage() {
  const [eventId, setEventId] = useState(() => makeEventId());
  const [eventType, setEventType] = useState<EventType>('payment');
  const [payload, setPayload] = useState('$29.99');

  // Late-arriving event controls
  const [simulateLate, setSimulateLate] = useState(false);
  const [arrivalDelaySeconds, setArrivalDelaySeconds] = useState(60);
  const [allowedLatenessSeconds, setAllowedLatenessSeconds] = useState(30);

  // Concurrency controls
  const [concurrentCount, setConcurrentCount] = useState(10);
  const [summary, setSummary] = useState<ConcurrencySummary | null>(null);

  // Burst Stream controls
  const [burstSize, setBurstSize] = useState(25);
  const [burstDuplicateRate, setBurstDuplicateRate] = useState(20);
  const [burstSummary, setBurstSummary] = useState<BurstSummary | null>(null);

  const [trace, setTrace] = useState<DeliveryAttempt[]>([]);
  const [stats, setStats] = useState<CloudStats | null>(null);
  const [connection, setConnection] = useState<Connection>('unknown');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sequence = useRef(0);

  const refreshStats = useCallback(async () => {
    if (!isCloudConfigured) return;
    try {
      setStats(await getStats());
      setConnection('online');
      setError(null);
    } catch (err) {
      setConnection('offline');
      setError(err instanceof CloudApiError ? err.message : 'Could not load statistics.');
    }
  }, []);

  useEffect(() => {
    refreshStats();
  }, [refreshStats]);

  const sendAndTrace = useCallback(async (req: SubmitEventRequest): Promise<DeliveryAttempt> => {
    const seq = ++sequence.current;
    try {
      const response = await submitEvent(req);
      return toDeliveryAttempt(req, response, seq);
    } catch (err) {
      const apiError = err instanceof CloudApiError ? err : new CloudApiError(0, 'UNKNOWN', 'Unexpected error');
      return toFailedAttempt(req, apiError, seq);
    }
  }, []);

  const addToTrace = (attempts: DeliveryAttempt[]) => {
    setTrace((prev) => [...[...attempts].reverse(), ...prev].slice(0, MAX_TRACE_ROWS));
  };

  // Button 1: Send single event (with optional late arrival timestamp and watermark threshold)
  const handleSend = async () => {
    setBusy(true);
    setSummary(null);
    setBurstSummary(null);

    const nowMs = Date.now();
    const eventTimestamp = simulateLate
      ? new Date(nowMs - arrivalDelaySeconds * 1000).toISOString()
      : new Date(nowMs).toISOString();

    const request: SubmitEventRequest = {
      eventId: eventId.trim(),
      type: eventType,
      payload,
      timestamp: eventTimestamp,
      allowedLatenessSeconds: simulateLate ? allowedLatenessSeconds : undefined,
    };

    const attempt = await sendAndTrace(request);
    addToTrace([attempt]);
    if (attempt.decision === 'Failed') setError(attempt.reason);
    else setError(null);
    await refreshStats();
    setBusy(false);
  };

  // Button 2: Concurrency test (firing identical requests simultaneously)
  const handleConcurrent = async () => {
    setBusy(true);
    setError(null);
    setBurstSummary(null);
    const freshId = makeEventId('race');
    const request: SubmitEventRequest = { eventId: freshId, type: eventType, payload };
    const attempts = await Promise.all(Array.from({ length: concurrentCount }, () => sendAndTrace(request)));
    addToTrace(attempts);
    setSummary({
      eventId: freshId,
      sent: attempts.length,
      created: attempts.filter((a) => a.decision === 'Processed').length,
      duplicates: attempts.filter((a) => a.decision === 'Duplicate Suppressed').length,
      failed: attempts.filter((a) => a.decision === 'Failed').length,
    });
    await refreshStats();
    setBusy(false);
  };

  // Button 3: Real Backend Burst Stream Test
  const handleBurstStream = async () => {
    setBusy(true);
    setError(null);
    setSummary(null);

    const burstEvents: SubmitEventRequest[] = [];
    const uniqueCount = Math.max(1, Math.floor(burstSize * (1 - burstDuplicateRate / 100)));
    const uniqueIds = Array.from({ length: uniqueCount }, () => makeEventId('burst'));

    for (let i = 0; i < burstSize; i++) {
      const selectedId = i < uniqueCount ? uniqueIds[i] : uniqueIds[i % uniqueCount];
      burstEvents.push({
        eventId: selectedId,
        type: EVENT_TYPES[i % EVENT_TYPES.length],
        payload: `Burst item #${i + 1}`,
        isBurst: true,
      });
    }

    try {
      const burstResponse = await submitBurst({ events: burstEvents });
      const attempts = burstResponse.results.map((res, idx) =>
        toDeliveryAttempt(burstEvents[idx], res, ++sequence.current)
      );
      addToTrace(attempts);

      setBurstSummary({
        burstId: burstResponse.burstId,
        received: burstResponse.receivedEvents,
        processed: burstResponse.processedEvents,
        duplicates: burstResponse.duplicatesSuppressed,
        lateRejected: burstResponse.lateRejected,
        failed: burstResponse.failedEvents,
        throughput: burstResponse.throughputEventsPerSec,
        averageLatency: burstResponse.averageLatencyMs,
      });
      await refreshStats();
    } catch (err) {
      setError(err instanceof CloudApiError ? `${err.code}: ${err.message}` : 'Burst stream request failed.');
    } finally {
      setBusy(false);
    }
  };

  const disabled = busy || !isCloudConfigured;
  const inputClass =
    'w-full px-3 py-1.5 text-xs border border-slate-200 rounded-md focus:outline-none focus:border-slate-400 bg-white disabled:bg-slate-50';
  const buttonClass =
    'inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

  return (
    <div className="max-w-6xl mx-auto px-6 py-8 overflow-y-auto max-h-screen">
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-2">
          <Cloud size={24} className="text-slate-700" />
          <h1 className="text-xl font-semibold text-slate-800">Cloud Backend Integration</h1>
        </div>
        <p className="text-sm text-slate-500 max-w-3xl">
          Direct integration with the serverless backend (API Gateway → AWS Lambda → Amazon DynamoDB).
          Test single event de-duplication, late-arriving event watermark evaluation, race condition concurrency,
          and high-throughput Burst Stream batch processing.
        </p>
      </div>

      {/* Connection Banner */}
      <div className="bg-white border border-slate-200 rounded-lg p-4 mb-5 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-xs font-semibold text-slate-700 uppercase tracking-wide mb-1">Backend API Endpoint</h3>
            {isCloudConfigured ? (
              <p className="text-xs text-slate-600 font-mono truncate" title={API_BASE_URL}>
                {API_BASE_URL}
              </p>
            ) : (
              <p className="text-xs text-amber-700 flex items-start gap-1.5">
                <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
                <span>
                  No API URL configured. Set <code className="font-mono">VITE_API_BASE_URL</code> in{' '}
                  <code className="font-mono">.env.local</code> (e.g. <code className="font-mono">http://localhost:3001</code>).
                </span>
              </p>
            )}
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            <div className="text-xs text-slate-500 flex items-center gap-1.5">
              <span
                className={`inline-block w-2.5 h-2.5 rounded-full ${
                  connection === 'online' ? 'bg-emerald-500' : connection === 'offline' ? 'bg-red-500' : 'bg-slate-300'
                }`}
              />
              <span className="capitalize font-medium">{connection === 'unknown' ? 'Checking…' : connection}</span>
            </div>
            <button
              onClick={refreshStats}
              disabled={disabled}
              className={`${buttonClass} border border-slate-200 text-slate-700 hover:bg-slate-50`}
            >
              <RefreshCw size={12} className={busy ? 'animate-spin' : ''} />
              Refresh
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg p-3 mb-5 flex items-start gap-2">
          <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Action Panels */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-5">
        {/* Panel 1: Single Event / Late Event */}
        <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <Send size={14} className="text-slate-600" />
              <h3 className="text-xs font-semibold text-slate-700 uppercase tracking-wide">Single & Late Event</h3>
            </div>
            <p className="text-[11px] text-slate-500 mb-3">
              Send an event. Send the same ID again to test duplicate suppression, or enable late arrival to test watermark rejection.
            </p>

            <div className="space-y-2.5">
              <div>
                <label className="block text-[11px] font-medium text-slate-600 mb-1">Event ID</label>
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    value={eventId}
                    onChange={(e) => setEventId(e.target.value)}
                    disabled={disabled}
                    className={`${inputClass} font-mono`}
                  />
                  <button
                    onClick={() => setEventId(makeEventId())}
                    disabled={disabled}
                    title="Generate new ID"
                    className={`${buttonClass} border border-slate-200 text-slate-700 hover:bg-slate-50 px-2`}
                  >
                    <Shuffle size={12} />
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] font-medium text-slate-600 mb-1">Type</label>
                  <select
                    value={eventType}
                    onChange={(e) => setEventType(e.target.value as EventType)}
                    disabled={disabled}
                    className={inputClass}
                  >
                    {EVENT_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-600 mb-1">Payload</label>
                  <input
                    type="text"
                    value={payload}
                    onChange={(e) => setPayload(e.target.value)}
                    disabled={disabled}
                    className={inputClass}
                  />
                </div>
              </div>

              {/* Late event toggle */}
              <div className="pt-2 border-t border-slate-100">
                <label className="flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer mb-2">
                  <input
                    type="checkbox"
                    checked={simulateLate}
                    onChange={(e) => setSimulateLate(e.target.checked)}
                    disabled={disabled}
                    className="rounded text-emerald-600 focus:ring-emerald-500"
                  />
                  <Clock size={12} className="text-purple-600" />
                  <span className="font-medium">Simulate Late Arrival</span>
                </label>

                {simulateLate && (
                  <div className="grid grid-cols-2 gap-2 bg-purple-50/50 p-2 rounded border border-purple-100">
                    <div>
                      <label className="block text-[10px] text-purple-800 mb-0.5">Delay (seconds)</label>
                      <input
                        type="number"
                        min="5"
                        max="300"
                        value={arrivalDelaySeconds}
                        onChange={(e) => setArrivalDelaySeconds(Number(e.target.value))}
                        disabled={disabled}
                        className={inputClass}
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-purple-800 mb-0.5">Watermark Window</label>
                      <input
                        type="number"
                        min="5"
                        max="300"
                        value={allowedLatenessSeconds}
                        onChange={(e) => setAllowedLatenessSeconds(Number(e.target.value))}
                        disabled={disabled}
                        className={inputClass}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          <button
            onClick={handleSend}
            disabled={disabled || eventId.trim().length === 0}
            className={`${buttonClass} w-full mt-3 bg-slate-800 text-white hover:bg-slate-900`}
          >
            <Send size={12} />
            {busy ? 'Sending…' : 'Send Event'}
          </button>
        </div>

        {/* Panel 2: Concurrency Race Test */}
        <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <Zap size={14} className="text-amber-500" />
              <h3 className="text-xs font-semibold text-slate-700 uppercase tracking-wide">Concurrency Race Test</h3>
            </div>
            <p className="text-[11px] text-slate-500 mb-3">
              Fires N identical requests simultaneously. DynamoDB&apos;s atomic conditional write guarantees exactly one succeeds.
            </p>

            <div className="space-y-3">
              <div>
                <label className="block text-[11px] font-medium text-slate-600 mb-1">Simultaneous Requests</label>
                <select
                  value={concurrentCount}
                  onChange={(e) => setConcurrentCount(Number(e.target.value))}
                  disabled={disabled}
                  className={inputClass}
                >
                  {CONCURRENCY_OPTIONS.map((n) => (
                    <option key={n} value={n}>
                      {n} Parallel Requests
                    </option>
                  ))}
                </select>
              </div>

              {summary && (
                <div
                  className={`rounded-md border p-2.5 text-xs ${
                    summary.created === 1 && summary.failed === 0
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                      : 'bg-amber-50 border-amber-200 text-amber-800'
                  }`}
                >
                  <p className="font-semibold flex items-center gap-1.5 mb-0.5">
                    {summary.created === 1 && summary.failed === 0 ? (
                      <CheckCircle2 size={13} />
                    ) : (
                      <AlertTriangle size={13} />
                    )}
                    Race Outcome: {summary.created === 1 ? 'PASS (1 Unique)' : 'FAIL'}
                  </p>
                  <p className="text-[11px] tabular-nums">
                    {summary.created} processed · {summary.duplicates} suppressed · {summary.failed} failed
                  </p>
                </div>
              )}
            </div>
          </div>

          <button
            onClick={handleConcurrent}
            disabled={disabled}
            className={`${buttonClass} w-full mt-3 bg-amber-600 text-white hover:bg-amber-700`}
          >
            <Zap size={12} />
            {busy ? 'Firing…' : `Fire ${concurrentCount} Concurrent Requests`}
          </button>
        </div>

        {/* Panel 3: Real Backend Burst Stream */}
        <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <Layers size={14} className="text-emerald-600" />
              <h3 className="text-xs font-semibold text-slate-700 uppercase tracking-wide">Burst Stream Processing</h3>
            </div>
            <p className="text-[11px] text-slate-500 mb-3">
              Submits a rapid batch to the backend burst API (/events/burst) to measure throughput and duplicate suppression under traffic spikes.
            </p>

            <div className="space-y-2.5">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] font-medium text-slate-600 mb-1">Burst Size</label>
                  <select
                    value={burstSize}
                    onChange={(e) => setBurstSize(Number(e.target.value))}
                    disabled={disabled}
                    className={inputClass}
                  >
                    {BURST_SIZE_OPTIONS.map((n) => (
                      <option key={n} value={n}>
                        {n} Events
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-600 mb-1">Duplicate Rate</label>
                  <select
                    value={burstDuplicateRate}
                    onChange={(e) => setBurstDuplicateRate(Number(e.target.value))}
                    disabled={disabled}
                    className={inputClass}
                  >
                    <option value={0}>0% (All unique)</option>
                    <option value={20}>20% Duplicates</option>
                    <option value={50}>50% Duplicates</option>
                  </select>
                </div>
              </div>

              {burstSummary && (
                <div className="rounded-md border border-emerald-200 bg-emerald-50 p-2.5 text-xs text-emerald-800">
                  <p className="font-semibold flex items-center gap-1.5 mb-0.5">
                    <Activity size={13} />
                    Throughput: {burstSummary.throughput} events/s
                  </p>
                  <p className="text-[11px] tabular-nums">
                    {burstSummary.processed} processed · {burstSummary.duplicates} suppressed · {burstSummary.averageLatency}ms avg latency
                  </p>
                </div>
              )}
            </div>
          </div>

          <button
            onClick={handleBurstStream}
            disabled={disabled}
            className={`${buttonClass} w-full mt-3 bg-emerald-600 text-white hover:bg-emerald-700`}
          >
            <Layers size={12} />
            {busy ? 'Processing Burst…' : `Send ${burstSize} Burst Events`}
          </button>
        </div>
      </div>

      {/* Live Statistics from DynamoDB */}
      {stats && (
        <div className="mb-5">
          <MetricsPanel metrics={toSimulationMetrics(stats)} deduplicationEnabled={true} />
          <p className="text-[11px] text-slate-400 mt-1 px-1">
            Live metrics from DynamoDB (pk: <code className="font-mono">STATS#global</code>). Event TTL retention: {stats.retentionHours} hours.
          </p>
        </div>
      )}

      {/* Live Event Trace Table */}
      {trace.length > 0 ? (
        <EventTraceTable deliveries={trace} />
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg p-8 text-center text-xs text-slate-400">
          Backend API responses and execution traces will appear here.
        </div>
      )}
    </div>
  );
}
