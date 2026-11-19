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
            event flow through the pipeline, inspect late-arriving events and high-volume burst streams,
            and compare outcomes with and without de-duplication.
          </p>
        </Section>

        <Section title="Problem Statement">
          <p>
            In distributed systems, network failures and retries cause the same logical event to be
            delivered multiple times. Without de-duplication, each redelivery can trigger a duplicate
            business effect — for example, charging a customer twice for the same payment. The challenge
            is to ensure that each logical event produces exactly one business effect, regardless of how
            many times it is delivered, how late it arrives, or how heavily the traffic spikes.
          </p>
        </Section>

        <Section title="Architecture Explanation">
          <p>
            The simulation models five components in a linear pipeline:
          </p>
          <ul className="list-disc list-inside space-y-1 mt-2">
            <li><strong>Event Producer</strong> — generates logical events, each with a stable unique ID, event timestamp, and payload.</li>
            <li><strong>Message Queue</strong> — holds delivery attempts. Supports duplicate deliveries, reordering, retries, and traffic backlogs.</li>
            <li><strong>De-duplication Engine</strong> — inspects each delivery's event ID against the registry and watermark policy to decide whether to process, suppress, or reject.</li>
            <li><strong>Processed Event Registry</strong> — records the state of each event ID (Pending, Processing, or Processed).</li>
            <li><strong>Business Effect</strong> — the real-world side effect of processing (e.g., a charge, an inventory update).</li>
          </ul>
        </Section>

        <Section title="Event-Processing Workflow">
          <p>The workflow for each delivery attempt is:</p>
          <ol className="list-decimal list-inside space-y-1 mt-2">
            <li>The producer creates a logical event with a stable ID and event time.</li>
            <li>The event enters the message queue as a delivery attempt with an arrival time.</li>
            <li>The dedup engine checks the event's lateness against the current watermark horizon.</li>
            <li>If the event exceeds allowed lateness, it is dropped as <em>Late Rejected</em> to bound processing memory.</li>
            <li>If accepted, the engine checks the registry for the event ID.</li>
            <li>If the event ID is new, it is processed, recorded as Processed, and the business effect is applied.</li>
            <li>If the event ID was already processed, the delivery is suppressed as a duplicate.</li>
            <li>If the worker fails, the delivery is marked as failed and may be retried with the same event ID.</li>
          </ol>
        </Section>

        <Section title="Late-Arriving Events: Event Time vs Arrival Time & Watermarks">
          <p>
            In distributed systems, there is a fundamental distinction between when an event happened and when it arrives:
          </p>
          <ul className="list-disc list-inside space-y-1.5 mt-2">
            <li><strong>Event Time (t_event)</strong> — the timestamp when the event actually occurred on the client device or producer.</li>
            <li><strong>Arrival Time (t_arrival)</strong> — the timestamp when the event reaches the message ingestion broker or processing cluster.</li>
            <li><strong>Lateness (Δ)</strong> — the time difference: <code>Lateness = t_arrival - t_event</code>. Lateness occurs due to network latency, client-side offline caching, mobile reconnects, or queue delays.</li>
          </ul>
          <p className="mt-2">
            <strong>Watermarks & Allowed Lateness:</strong> A stream processing engine cannot keep historical state indefinitely.
            A <em>Watermark</em> represents the engine's time progress: <code>Watermark = max(t_event seen) - Allowed Lateness</code>.
          </p>
          <ul className="list-disc list-inside space-y-1.5 mt-2">
            <li><strong>Accepted Late Event:</strong> An event that arrives late, but within the allowed lateness window (<code>Lateness ≤ Allowed Lateness</code>). If unique, it is processed once; if it is a duplicate, it is suppressed.</li>
            <li><strong>Rejected Late Event:</strong> An event that arrives after the watermark has already advanced past its window (<code>Lateness &gt; Allowed Lateness</code>). It is discarded to protect state window boundaries.</li>
            <li><strong>Late Unique Events vs Duplicates:</strong> A late event is <em>not</em> automatically a duplicate. If an event ID has never been seen before, it is a genuine unique event that simply arrived late. The dedup engine only classifies an event as a duplicate when its ID has already been recorded in the registry.</li>
          </ul>
        </Section>

        <Section title="Burst Stream: Traffic Spikes, Backlog, Throughput & Latency">
          <p>
            Real-world systems frequently experience sudden surges in event volume — such as flash sales, ticket drops, or batch ETL jobs.
          </p>
          <ul className="list-disc list-inside space-y-1.5 mt-2">
            <li><strong>Burst Stream</strong> — a sudden influx of a large number of events arriving within a short time interval (compressed arrival times).</li>
            <li><strong>Queue Backlog</strong> — when the incoming arrival rate exceeds the combined capacity of active workers (<code>Incoming Rate &gt; Workers × Speed</code>), events accumulate in the message queue. Backlog is calculated as: <code>Backlog(t) = Cumulative Arrivals(t) - Cumulative Processed(t)</code>.</li>
            <li><strong>Processing Throughput</strong> — the rate at which workers successfully claim and settle events per time unit (<code>Throughput = Completed Events / Total Elapsed Time</code>).</li>
            <li><strong>Processing Latency Under Load</strong> — as queue backlog grows, incoming events experience queuing delay before being assigned to a worker. Total latency is the sum of queue wait time plus execution time.</li>
            <li><strong>Duplicate Detection During Bursts</strong> — during high-traffic spikes, network retries and producer re-sends also increase. The de-duplication registry ensures that even when hundreds of requests arrive simultaneously, each unique event triggers only one business effect.</li>
          </ul>
        </Section>

        <Section title="De-duplication Algorithm & Idempotency">
          <p>
            The core algorithm uses an atomic registry to track event identity. When a delivery arrives:
          </p>
          <ol className="list-decimal list-inside space-y-1 mt-2">
            <li>Read the delivery's stable event ID.</li>
            <li>Check watermark validity: if <code>Lateness &gt; Allowed Lateness</code>, mark <strong>Late Rejected</strong> and stop.</li>
            <li>Look up the event ID in the registry.</li>
            <li>If not found → <strong>New Event</strong>: mark Processed, record in registry, apply business effect.</li>
            <li>If found and state is Processed → <strong>Duplicate Suppressed</strong>: do not apply business effect.</li>
            <li>If found and state is Processing → <strong>In-Flight Duplicate</strong>: another worker is active, suppress redelivery.</li>
          </ol>
          <p className="mt-2">
            <strong>Idempotency</strong> guarantees that running an operation multiple times produces the exact same outcome as running it once. Stable event IDs provide the identity key that makes idempotent de-duplication possible.
          </p>
        </Section>

        <Section title="Message Queues, Retries, and Out-of-Order Delivery">
          <p>
            Message queues (Kafka, AWS SQS, RabbitMQ) provide at-least-once delivery guarantees. Network timeouts and consumer rebalances cause messages to be re-sent, creating duplicate deliveries.
          </p>
          <p className="mt-2">
            Events can also arrive out-of-order due to multi-partition queues, parallel consumer threads, or differing network routes. Because the de-duplication engine matches on <strong>Event ID</strong> rather than arrival position, duplicate detection remains 100% accurate regardless of delivery ordering.
          </p>
        </Section>

        <Section title="Worker Failures and Crash Recovery">
          <p>
            The simulation models worker crashes under both normal and burst conditions:
          </p>
          <ul className="list-disc list-inside space-y-1 mt-2">
            <li><strong>Crash before processing</strong> — worker crashes prior to state claim. No registry entry is left, and the subsequent retry is processed cleanly.</li>
            <li><strong>Crash after claiming</strong> — worker claims the event, leaving a Processing lock, but crashes before completion. The recovery handler clears stale state and safely completes the retry.</li>
          </ul>
        </Section>

        <Section title="At-Least-Once vs Exactly-Once">
          <div className="space-y-2">
            <p>
              <strong>At-least-once delivery</strong> guarantees every event reaches the queue, but redeliveries may occur.
            </p>
            <p>
              <strong>Exactly-once processing semantics</strong> means that regardless of how many times a message is delivered across the network, the underlying database write or business side effect is executed exactly once.
            </p>
          </div>
        </Section>

        <Section title="Limitations of In-Memory Simulation">
          <div className="bg-amber-50 border border-amber-100 rounded p-3 mt-2">
            <ul className="space-y-1.5">
              <li>
                The browser simulation uses an <strong>in-memory Map</strong>. In production distributed systems, durable datastores (such as Amazon DynamoDB, Apache Cassandra, or Redis) are used to store idempotency keys.
              </li>
              <li>
                For atomic coordination in distributed architectures, conditional writes (<code>attribute_not_exists</code>) or two-phase commits are required so concurrent worker threads cannot race.
              </li>
            </ul>
          </div>
        </Section>

        <Section title="Real-World Applications">
          <ul className="list-disc list-inside space-y-1">
            <li><strong>Payment Gateways (Stripe, Razorpay)</strong> — prevent double charges when customers double-click or network drops mid-transaction.</li>
            <li><strong>E-Commerce Order Processing</strong> — prevent multiple shipments when checkout events are retried during flash-sale bursts.</li>
            <li><strong>Financial Ledger Transfers</strong> — ensure funds are debited and credited exactly once across banking accounts.</li>
            <li><strong>IoT & Telemetry Streams</strong> — filter late sensor readings and duplicate telemetry buffered during network disconnects.</li>
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
