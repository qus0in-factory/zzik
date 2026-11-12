import { pgTable, text, jsonb, timestamp, bigint, index } from 'drizzle-orm/pg-core'
import type { UsageEnvelope } from '../usage-contract'

export const usageSnapshot = pgTable('usage_snapshot', {
  provider: text('provider').primaryKey(),
  envelope: jsonb('envelope').$type<UsageEnvelope>().notNull(),
  status: text('status').notNull(),
  runAt: timestamp('run_at', { withTimezone: true }).notNull(),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }),
  rawSha256: text('raw_sha256'),
  collectorVersion: text('collector_version').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const usageEvent = pgTable('usage_event', {
  id: bigint('id', { mode: 'bigint' }).primaryKey().generatedAlwaysAsIdentity(),
  provider: text('provider').notNull(),
  runAt: timestamp('run_at', { withTimezone: true }).notNull(),
  status: text('status').notNull(),
  rawSha256: text('raw_sha256'),
  envelope: jsonb('envelope').$type<UsageEnvelope>().notNull(),
}, table => [index('usage_event_provider_run_at').on(table.provider, table.runAt.desc())])
