import { useCallback, useEffect, useRef, useState } from 'react';
import { Cloud, Send, Shuffle, Zap, RefreshCw, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { DeliveryAttempt, EventType } from '@/sim/types';
import {
  API_BASE_URL,
  CloudApiError,
  CloudStats,
  SubmitEventRequest,
  getStats,
  isCloudConfigured,
  submitEvent,
  toDeliveryAttempt,
  toFailedAttempt,
  toSimulationMetrics,
} from '@/api/cloudApi';
import { MetricsPanel } from './MetricsPanel';
import { EventTraceTable } from './EventTraceTable';

const EVENT_TYPES: EventType[] = ['payment', 'order', 'inventory', 'notification', 'transfer'];
const CONCURRENCY_OPTIONS = [5, 10, 25, 50];
const MAX_TRACE_ROWS = 200;

type Connection = 'unknown' | 'online' | 'offline';

interface ConcurrencySummary {
  eventId: string;
  sent: number;
  created: number;
  duplicates: number;
  failed: number;
}

// A short, readable, unique-enough event ID for demos.
function makeEventId(): string {
  return `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function CloudBackendPage() {
  const [eventId, setEventId] = useState(makeEventId);
  const [eventType, setEventType] = useState<EventType>('payment');
  const [payload, setPayload] = useState('$29.99');
  const [concurrentCount, setConcurrentCount] = useState(10);

  const [trace, setTrace] = useState<DeliveryAttempt[]>([]);
  const [stats, setStats] = useState<CloudStats | null>(null);
  const [connection, setConnection] = useState<Connection>('unknown');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<ConcurrencySummary | null>(null);

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

  // Load the counters once when the page opens (this also tests the connection).
  useEffect(() => {
    refreshStats();
  }, [refreshStats]);

  // Sends one event and turns the answer (or the error) into a row for the trace table.
  const sendAndTrace = useCallback(async (request: SubmitEventRequest): Promise<DeliveryAttempt> => {
    const seq = ++sequence.current;
    try {
      const response = await submitEvent(request);
      return toDeliveryAttempt(request, response, seq);
    } catch (err) {
      const apiError = err instanceof CloudApiError ? err : new CloudApiError(0, 'UNKNOWN', 'Unexpected error');
      return toFailedAttempt(request, apiError, seq);
    }
  }, []);

  const addToTrace = (attempts: DeliveryAttempt[]) => {
    // newest first
    setTrace((prev) => [...[...attempts].reverse(), ...prev].slice(0, MAX_TRACE_ROWS));
  };

  // Button 1: send the event using the ID in the box. Sending the SAME ID twice creates a duplicate.
  const handleSend = async () => {
    setBusy(true);
    setSummary(null);
    const request: SubmitEventRequest = { eventId: eventId.trim(), type: eventType, payload };
    const attempt = await sendAndTrace(request);
    addToTrace([attempt]);
    if (attempt.decision === 'Failed') setError(attempt.reason);
    else setError(null);
    await refreshStats();
    setBusy(false);
  };

  // Button 2: fire N identical requests at the same moment with a fresh ID.
  // The atomic DynamoDB write should let exactly ONE of them through.
  const handleConcurrent = async () => {
    setBusy(true);
    setError(null);
    const freshId = makeEventId();
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

  const disabled = busy || !isCloudConfigured;
  const inputClass =
    'w-full px-3 py-1.5 text-xs border border-slate-200 rounded-md focus:outline-none focus:border-slate-400 bg-white disabled:bg-slate-50';
  const buttonClass =
    'inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-2">
          <Cloud size={22} className="text-slate-600" />
          <h1 className="text-xl font-semibold text-slate-800">Cloud Backend</h1>
        </div>
        <p className="text-sm text-slate-500 max-w-2xl">
          Send real events to the AWS backend (API Gateway → Lambda → DynamoDB) and watch duplicate detection
          happen in the cloud. The Simulator, Experiments and Results pages are not affected.
        </p>
      </div>

      {/* Connection */}
      <div className="bg-white border border-slate-200 rounded-lg p-4 mb-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-1">Connection</h3>
            {isCloudConfigured ? (
              <p className="text-xs text-slate-500 font-mono truncate" title={API_BASE_URL}>
                {API_BASE_URL}
              </p>
            ) : (
              <p className="text-xs text-amber-700 flex items-start gap-1.5">
                <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
                <span>
                  No API URL configured. Set <code className="font-mono">VITE_API_BASE_URL</code> in{' '}
                  <code className="font-mono">.env.local</code> (development) or in Netlify&apos;s environment
                  variables (production), then rebuild.
                </span>
              </p>
            )}
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            <div className="text-xs text-slate-500 flex items-center gap-1.5">
              <span
                className={`inline-block w-2 h-2 rounded-full ${
                  connection === 'online' ? 'bg-emerald-500' : connection === 'offline' ? 'bg-red-500' : 'bg-slate-300'
                }`}
              />
              <span className="capitalize">{connection === 'unknown' ? 'not checked' : connection}</span>
            </div>
            <button
              onClick={refreshStats}
              disabled={disabled}
              className={`${buttonClass} border border-slate-200 text-slate-700 hover:bg-slate-50`}
            >
              <RefreshCw size={12} />
              Refresh stats
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg p-3 mb-4 flex items-start gap-2">
          <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        {/* Send one event */}
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-1">Send an event</h3>
          <p className="text-xs text-slate-500 mb-3">
            Press <strong>Send</strong> twice without changing the ID to see a duplicate being suppressed.
          </p>

          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Event ID</label>
              <div className="flex gap-2">
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
                  title="Generate a new event ID"
                  className={`${buttonClass} border border-slate-200 text-slate-700 hover:bg-slate-50`}
                >
                  <Shuffle size={12} />
                  New ID
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Type</label>
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
                <label className="block text-xs font-medium text-slate-600 mb-1">Payload</label>
                <input
                  type="text"
                  value={payload}
                  onChange={(e) => setPayload(e.target.value)}
                  disabled={disabled}
                  className={inputClass}
                />
              </div>
            </div>

            <button
              onClick={handleSend}
              disabled={disabled || eventId.trim().length === 0}
              className={`${buttonClass} w-full bg-slate-800 text-white hover:bg-slate-900`}
            >
              <Send size={12} />
              {busy ? 'Sending…' : 'Send event'}
            </button>
          </div>
        </div>

        {/* Concurrency test */}
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-1">Concurrency test</h3>
          <p className="text-xs text-slate-500 mb-3">
            Sends the same new event many times at the same moment. Thanks to DynamoDB&apos;s atomic conditional
            write, exactly one should be processed.
          </p>

          <div className="flex items-end gap-2 mb-3">
            <div className="flex-1">
              <label className="block text-xs font-medium text-slate-600 mb-1">Simultaneous requests</label>
              <select
                value={concurrentCount}
                onChange={(e) => setConcurrentCount(Number(e.target.value))}
                disabled={disabled}
                className={inputClass}
              >
                {CONCURRENCY_OPTIONS.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
            <button
              onClick={handleConcurrent}
              disabled={disabled}
              className={`${buttonClass} bg-emerald-600 text-white hover:bg-emerald-700`}
            >
              <Zap size={12} />
              {busy ? 'Running…' : 'Fire!'}
            </button>
          </div>

          {summary && (
            <div
              className={`rounded-md border p-3 text-xs ${
                summary.created === 1 && summary.failed === 0
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  : 'bg-amber-50 border-amber-200 text-amber-800'
              }`}
            >
              <p className="font-semibold flex items-center gap-1.5 mb-1">
                {summary.created === 1 && summary.failed === 0 ? (
                  <CheckCircle2 size={14} />
                ) : (
                  <AlertTriangle size={14} />
                )}
                {summary.sent} requests for <span className="font-mono">{summary.eventId}</span>
              </p>
              <p className="tabular-nums">
                {summary.created} processed · {summary.duplicates} suppressed as duplicates · {summary.failed} failed
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Live statistics from DynamoDB */}
      {stats && (
        <div className="mb-4">
          <MetricsPanel metrics={toSimulationMetrics(stats)} deduplicationEnabled={true} />
          <p className="text-[11px] text-slate-400 mt-1.5 px-1">
            Live counters from DynamoDB. Event IDs are remembered for {stats.retentionHours} hours.
          </p>
        </div>
      )}

      {/* Responses received in this browser session */}
      {trace.length > 0 ? (
        <EventTraceTable deliveries={trace} />
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg p-8 text-center text-xs text-slate-400">
          Responses from the cloud backend will appear here.
        </div>
      )}
    </div>
  );
}
