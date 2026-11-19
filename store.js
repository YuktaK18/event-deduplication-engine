'use strict';

// The ONLY file that talks to Amazon DynamoDB.
// The AWS SDK v3 is already included in the Lambda Node.js runtime, so no npm install is needed.
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient,
  PutCommand,
  UpdateCommand,
  GetCommand,
} = require('@aws-sdk/lib-dynamodb');

// Table layout: one table, partition key "pk" (a string).
//   pk = "EVENT#<eventId>"  -> one item per event ID  (has expiresAt, so DynamoDB TTL deletes it later)
//   pk = "STATS#global"     -> one item holding atomic counters (no expiresAt, never deleted)
const STATS_KEY = 'STATS#global';
const eventKey = (eventId) => `EVENT#${eventId}`;

// Counters that may be incremented on the statistics item.
const STAT_FIELDS = [
  'totalDeliveryAttempts',
  'uniqueLogicalEvents',
  'duplicatesSuppressed',
  'failedAttempts',
  'invalidRequests',
  'totalLatencyMs',
];

const isConditionFailure = (err) => err && err.name === 'ConditionalCheckFailedException';

function createStore(tableName, client) {
  // Created once per Lambda container and reused by later requests (faster).
  const db =
    client ||
    DynamoDBDocumentClient.from(new DynamoDBClient({}), {
      marshallOptions: { removeUndefinedValues: true },
    });

  return {
    // THE KEY STEP: an atomic "insert only if this event ID is not already stored".
    // DynamoDB checks the condition and writes in ONE operation, so if 20 identical requests
    // arrive at the same moment, exactly one of them succeeds. The rest get a condition failure.
    // An item that has passed its expiry time (but TTL has not removed yet) counts as "not there".
    // Returns true if this call created the record, false if the event was already stored.
    async putEventIfNew(record, nowSeconds) {
      try {
        await db.send(
          new PutCommand({
            TableName: tableName,
            Item: { pk: eventKey(record.eventId), ...record },
            ConditionExpression: 'attribute_not_exists(pk) OR expiresAt <= :now',
            ExpressionAttributeValues: { ':now': nowSeconds },
          })
        );
        return true;
      } catch (err) {
        if (isConditionFailure(err)) return false;
        throw err;
      }
    },

    // Called when an event turned out to be a duplicate: atomically bumps its duplicate counter
    // and returns the stored item. Returns null if the item vanished/expired in the meantime.
    async recordDuplicate(eventId, nowIso, nowSeconds) {
      try {
        const result = await db.send(
          new UpdateCommand({
            TableName: tableName,
            Key: { pk: eventKey(eventId) },
            UpdateExpression: 'SET lastDuplicateAt = :at ADD duplicateCount :one',
            ConditionExpression: 'attribute_exists(pk) AND expiresAt > :now',
            ExpressionAttributeValues: { ':at': nowIso, ':one': 1, ':now': nowSeconds },
            ReturnValues: 'ALL_NEW',
          })
        );
        return result.Attributes || null;
      } catch (err) {
        if (isConditionFailure(err)) return null;
        throw err;
      }
    },

    // Reads one event record (strongly consistent). Returns the item or null.
    async getEvent(eventId) {
      const result = await db.send(
        new GetCommand({
          TableName: tableName,
          Key: { pk: eventKey(eventId) },
          ConsistentRead: true,
        })
      );
      return result.Item || null;
    },

    // Atomically adds numbers to the statistics counters, e.g. { totalDeliveryAttempts: 1 }.
    async incrementStats(delta) {
      const names = Object.keys(delta).filter((name) => STAT_FIELDS.includes(name) && delta[name]);
      if (names.length === 0) return;

      const values = {};
      const parts = names.map((name, i) => {
        values[`:v${i}`] = delta[name];
        return `${name} :v${i}`;
      });

      await db.send(
        new UpdateCommand({
          TableName: tableName,
          Key: { pk: STATS_KEY },
          UpdateExpression: `ADD ${parts.join(', ')}`,
          ExpressionAttributeValues: values,
        })
      );
    },

    // Reads the statistics item. Returns null if nothing has been counted yet.
    async getStats() {
      const result = await db.send(
        new GetCommand({
          TableName: tableName,
          Key: { pk: STATS_KEY },
          ConsistentRead: true,
        })
      );
      return result.Item || null;
    },
  };
}

module.exports = { createStore, STATS_KEY, eventKey };
