'use strict';

// A fake "DynamoDB" that lives in memory, used only by the tests.
// It behaves like the real store.js:
//   - putEventIfNew is ATOMIC (check + write happen together, like a DynamoDB conditional write)
//   - every call takes a little time, like a network call, so concurrent requests really overlap

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function createMemoryStore({ latencyMs = 5 } = {}) {
  const events = new Map();
  let stats = null;

  return {
    events,
    async putEventIfNew(record, nowSeconds) {
      await sleep(latencyMs); // "network"
      // --- atomic section: no await between the check and the write ---
      const existing = events.get(record.eventId);
      if (existing && existing.expiresAt > nowSeconds) return false;
      events.set(record.eventId, { ...record });
      return true;
    },
    async recordDuplicate(eventId, nowIso, nowSeconds) {
      await sleep(latencyMs);
      const existing = events.get(eventId);
      if (!existing || existing.expiresAt <= nowSeconds) return null;
      existing.duplicateCount += 1;
      existing.lastDuplicateAt = nowIso;
      return { ...existing };
    },
    async getEvent(eventId) {
      await sleep(latencyMs);
      const item = events.get(eventId);
      return item ? { ...item } : null;
    },
    async incrementStats(delta) {
      await sleep(latencyMs);
      stats = stats || {};
      for (const [name, value] of Object.entries(delta)) {
        stats[name] = (stats[name] || 0) + value;
      }
    },
    async getStats() {
      await sleep(latencyMs);
      return stats ? { ...stats } : null;
    },
  };
}

module.exports = { createMemoryStore, sleep };
