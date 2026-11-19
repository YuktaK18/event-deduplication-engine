import { BookOpen } from 'lucide-react';

export function DocumentationPage() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-8">
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-2">
          <BookOpen size={22} className="text-slate-600" />
          <h1 className="text-xl font-semibold text-slate-800">Documentation</h1>
        </div>
        <p className="text-sm text-slate-500">
          Technical reference for the Exactly-Once Event De-duplication Engine simulation.
        </p>
      </div>

      <div className="space-y-6">
        <Section title="Project Objective">
          <p>
            This virtual lab demonstrates how a de-duplication engine ensures exactly-once processing
            semantics in an event-driven system. Users can configure simulation parameters, observe
            event flow through the pipeline, and compare outcomes with and without de-duplication.
          </p>
        </Section>

        <Section title="Problem Statement">
          <p>
            In distributed systems, network failures and retries cause the same logical event to be
            delivered multiple times. Without de-duplication, each redelivery can trigger a duplicate
            business effect — for example, charging a customer twice for the same payment. The challenge
            is to ensure that each logical event produces exactly one business effect, regardless of how
            many times it is delivered.
          </p>
        </Section>

        <Section title="Architecture Explanation">
          <p>
            The simulation models five components in a linear pipeline:
          </p>
          <ul className="list-disc list-inside space-y-1 mt-2">
            <li><strong>Event Producer</strong> — generates logical events, each with a stable unique ID and a payload.</li>
            <li><strong>Message Queue</strong> — holds delivery attempts. Supports duplicate deliveries, reordering, and retries.</li>
            <li><strong>De-duplication Engine</strong> — inspects each delivery's event ID against the registry and decides whether to process or suppress.</li>
            <li><strong>Processed Event Registry</strong> — records the state of each event ID (Pending, Processing, or Processed).</li>
            <li><strong>Business Effect</strong> — the real-world side effect of processing (e.g., a charge, an inventory update).</li>
          </ul>
        </Section>

        <Section title="Event-Processing Workflow">
          <p>The workflow for each delivery attempt is:</p>
          <ol className="list-decimal list-inside space-y-1 mt-2">
            <li>The producer creates a logical event with a stable ID.</li>
            <li>The event enters the message queue as a delivery attempt.</li>
            <li>The dedup engine receives the delivery and reads its event ID.</li>
            <li>The engine checks the registry for the event ID.</li>
            <li>If the event is new, it is processed, the registry is updated, and the business effect is applied.</li>
            <li>If the event is already processed or being processed, the delivery is suppressed as a duplicate.</li>
            <li>If the worker fails, the delivery is marked as failed and may be retried with the same event ID.</li>
          </ol>
        </Section>

        <Section title="De-duplication Algorithm">
          <p>
            The core algorithm uses a registry (a map from event ID to processing state) to track which
            events have been seen. When a delivery arrives:
          </p>
          <ol className="list-decimal list-inside space-y-1 mt-2">
            <li>Read the delivery's stable event ID.</li>
            <li>Look up the ID in the registry.</li>
            <li>If not found → <strong>new event</strong>: process it, record as Processed in the registry, apply business effect.</li>
            <li>If found and state is Processed → <strong>duplicate</strong>: suppress, do not apply business effect.</li>
            <li>If found and state is Processing → <strong>in-flight duplicate</strong>: suppress, another worker is handling it.</li>
            <li>If the worker crashes during processing → <strong>failed</strong>: the registry entry may be left in Processing state.</li>
          </ol>
          <p className="mt-2">
            When de-duplication is disabled, the registry is bypassed entirely. Every delivery — including
            duplicates — is processed and produces a business effect. This demonstrates the problem that
            de-duplication solves.
          </p>
        </Section>

        <Section title="Event IDs and Idempotency">
          <p>
            An event ID is a stable, unique identifier for a logical event. It does not change across
            delivery attempts. This is the key that makes de-duplication possible: the engine can
            determine that two deliveries refer to the same logical event by comparing their IDs.
          </p>
          <p className="mt-2">
            <strong>Idempotency</strong> means that processing the same event multiple times has the same
            effect as processing it once. The de-duplication engine enforces idempotency by preventing
            reprocessing of already-completed events.
          </p>
        </Section>

        <Section title="Message Queues, Retries, and Duplicate Deliveries">
          <p>
            Message queues buffer events between producers and consumers. In real systems (Kafka, RabbitMQ,
            SQS), queues provide at-least-once delivery guarantees: if a consumer fails to acknowledge a
            message, the queue redelivers it. This means the same event can arrive multiple times.
          </p>
          <p className="mt-2">
            Retries are a related source of duplicates. When a worker fails mid-processing, the system
            may retry the delivery. The retry carries the same event ID, allowing the dedup engine to
            recognize it as a redelivery rather than a new event.
          </p>
        </Section>

        <Section title="Out-of-Order Delivery">
          <p>
            Events may arrive in a different order than they were produced. This simulation demonstrates
            that event identity (the event ID) is separate from arrival order. The dedup engine correctly
            identifies duplicates regardless of delivery order — it matches on event ID, not on sequence
            number.
          </p>
          <p className="mt-2">
            However, de-duplication does not restore ordering. If your business logic requires ordered
            processing, you need a separate ordering mechanism (e.g., sequence numbers, watermarking).
          </p>
        </Section>

        <Section title="Worker Failures and Recovery">
          <p>
            The simulation models two types of worker failures:
          </p>
          <ul className="list-disc list-inside space-y-1 mt-2">
            <li><strong>Crash before processing</strong> — the worker fails before it starts processing the event. No registry entry is created. A retry with the same event ID will be processed normally.</li>
            <li><strong>Crash after claiming</strong> — the worker fails after it has claimed the event and created a registry entry in Processing state, but before completing. The registry may be left in an inconsistent state.</li>
          </ul>
          <p className="mt-2">
            In the simulation, crashed workers eventually recover (transition back to idle). Retries for
            failed deliveries are injected into the queue with the same event ID. If the registry already
            shows the event as Processed (e.g., a concurrent worker completed it), the retry is suppressed.
            If the registry shows Processing (the crashed worker's entry), the behavior depends on the
            cleanup strategy — this simulation models a simple case.
          </p>
        </Section>

        <Section title="At-Least-Once vs Exactly-Once">
          <div className="space-y-2">
            <p>
              <strong>At-least-once delivery</strong> means every event is delivered at least once, but
              possibly more than once. This is the guarantee most message queues provide. It is simple
              and robust, but it requires the consumer to handle duplicates.
            </p>
            <p>
              <strong>Exactly-once processing effects</strong> means each logical event produces exactly
              one business effect, even if it is delivered multiple times. This is achieved through
              de-duplication at the consumer side: the registry prevents duplicate business effects.
            </p>
            <p>
              Note that "exactly-once" here refers to the processing effect, not the delivery. The queue
              may still deliver duplicates; the dedup engine ensures they don't cause duplicate effects.
            </p>
          </div>
        </Section>

        <Section title="Limitations of This Simulation">
          <div className="bg-amber-50 border border-amber-100 rounded p-3 mt-2">
            <ul className="space-y-1.5">
              <li>
                The registry is <strong>in-memory</strong>. In a real system, a crash could lose the
                registry state. Production systems use durable storage (databases, logs) to persist
                registry entries.
              </li>
              <li>
                There is no <strong>transactional coordination</strong> between applying the business
                effect and updating the registry. Real systems use transactions or idempotent operations
                to ensure atomicity.
              </li>
              <li>
                Workers recover automatically. Real systems need health checks, restart policies, and
                state recovery mechanisms.
              </li>
              <li>
                The simulation is <strong>single-node</strong>. Production dedup engines must handle
                concurrent access from multiple nodes, which requires distributed locks or consensus.
              </li>
              <li>
                Latency values are <strong>simulated</strong> and do not reflect real processing times.
              </li>
            </ul>
          </div>
        </Section>

        <Section title="Real-World Applications">
          <ul className="list-disc list-inside space-y-1">
            <li><strong>Payment Processing</strong> — prevent double-charging when a payment request is retried due to a network timeout.</li>
            <li><strong>Order Management</strong> — prevent duplicate order creation when an order confirmation is redelivered.</li>
            <li><strong>Inventory</strong> — prevent stock from being decremented twice for the same reservation event.</li>
            <li><strong>Event Streaming</strong> — Kafka consumers use transactional IDs and offset tracking to achieve exactly-once semantics.</li>
            <li><strong>Notification Systems</strong> — prevent sending the same email or push notification multiple times.</li>
          </ul>
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-5">
      <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-3">{title}</h2>
      <div className="text-sm text-slate-600 leading-relaxed space-y-2">
        {children}
      </div>
    </div>
  );
}
