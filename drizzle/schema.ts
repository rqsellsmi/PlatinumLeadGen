/**
 * Database schema — PostgreSQL via Drizzle (drizzle-orm/pg-core).
 *
 * Migrated from the old MySQL schema per Section 3.2:
 *   mysqlTable -> pgTable, int() -> integer(), tinyint() -> boolean(),
 *   mysqlEnum -> pgEnum, float() -> real(), varchar(n) -> varchar({ length: n }),
 *   autoincrement() -> serial(), bigint timestamps -> timestamp().
 *
 * Removed: users table, config table (Section 3.3).
 * Added: api_keys, agents.passwordHash/passwordResetToken,
 *        locations SEO fields + guideUrl, notificationSettings.
 */
import {
  pgTable,
  pgEnum,
  serial,
  integer,
  real,
  varchar,
  text,
  boolean,
  timestamp,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------
export const leadTypeEnum = pgEnum('lead_type', ['valuation', 'seller_guide', 'webhook']);

export const leadStatusEnum = pgEnum('lead_status', [
  'new',
  'contacted',
  'qualified',
  'closed',
  'lost',
]);

export const offerStatusEnum = pgEnum('offer_status', [
  'offered',
  'accepted',
  'declined',
  'expired',
  'reassigned',
]);

export const scoreReasonEnum = pgEnum('score_reason', [
  'system_response_fast', // +7.5 accept within 30 min
  'system_response_good', // +5.0 accept within 1 hour
  'system_response_slow', // +2.0 accept within 3 hours
  'system_no_response', // -1.5 auto-expired
  'system_decline', // -1.0 declined
  'system_closing', // +15.0 lead closed
  'pipeline_contacted', // +2.0 reached Contacted
  'fast_contact_bonus', // +3.0 contacted within 24h of accept
  'pipeline_qualified', // +2.0 reached Qualified
  'manual_adjustment', // variable (requires reason)
]);

export const scriptPositionEnum = pgEnum('script_position', ['head', 'body']);

// ---------------------------------------------------------------------------
// Offices
// ---------------------------------------------------------------------------
export const offices = pgTable('offices', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 200 }).notNull(),
  address: varchar('address', { length: 300 }),
  city: varchar('city', { length: 120 }),
  state: varchar('state', { length: 10 }),
  zip: varchar('zip', { length: 20 }),
  phone: varchar('phone', { length: 40 }),
  latitude: real('latitude'),
  longitude: real('longitude'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------
export const agents = pgTable(
  'agents',
  {
    id: serial('id').primaryKey(),
    firstName: varchar('first_name', { length: 120 }).notNull(),
    lastName: varchar('last_name', { length: 120 }).notNull(),
    email: varchar('email', { length: 200 }).notNull(),
    phone: varchar('phone', { length: 40 }),
    officeId: integer('office_id').references(() => offices.id),
    // Own coordinates preferred; office coordinates used as fallback in routing.
    latitude: real('latitude'),
    longitude: real('longitude'),
    score: real('score').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    // Magic link auth: 64-char hex token, 30-day expiry, refreshed on every email.
    magicLinkToken: varchar('magic_link_token', { length: 128 }),
    magicLinkExpiresAt: timestamp('magic_link_expires_at'),
    // Password auth (set by admin only) — Section 3.3 additions.
    passwordHash: varchar('password_hash', { length: 200 }),
    passwordResetToken: varchar('password_reset_token', { length: 128 }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    emailIdx: uniqueIndex('agents_email_idx').on(t.email),
    magicTokenIdx: index('agents_magic_token_idx').on(t.magicLinkToken),
  }),
);

// ---------------------------------------------------------------------------
// Locations (city lead-gen pages)
// ---------------------------------------------------------------------------
export const locations = pgTable(
  'locations',
  {
    id: serial('id').primaryKey(),
    slug: varchar('slug', { length: 120 }).notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    state: varchar('state', { length: 10 }).notNull().default('MI'),
    latitude: real('latitude'),
    longitude: real('longitude'),
    // SEO copy (Section 3.3) — editable in admin without redeploy.
    metaTitle: varchar('meta_title', { length: 200 }),
    metaDescription: varchar('meta_description', { length: 500 }),
    heroHeadline: varchar('hero_headline', { length: 300 }),
    heroSubheadline: varchar('hero_subheadline', { length: 500 }),
    faqJson: text('faq_json'), // JSON string: [{ question, answer }]
    guideUrl: varchar('guide_url', { length: 500 }), // seller guide PDF (Section 4.3 #6)
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    slugIdx: uniqueIndex('locations_slug_idx').on(t.slug),
  }),
);

// ---------------------------------------------------------------------------
// Market stats (one current row per location)
// ---------------------------------------------------------------------------
export const marketStats = pgTable('market_stats', {
  id: serial('id').primaryKey(),
  locationId: integer('location_id')
    .notNull()
    .references(() => locations.id, { onDelete: 'cascade' }),
  avgSalePrice: integer('avg_sale_price'),
  daysToSell: integer('days_to_sell'),
  homesSold: integer('homes_sold'), // last 12 months
  percentOfListPrice: integer('percent_of_list_price'), // e.g. 99 = 99% of asking
  percentAboveList: integer('percent_above_list'), // e.g. 34 = 34% sold above list
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Recent sales
// ---------------------------------------------------------------------------
export const recentSales = pgTable('recent_sales', {
  id: serial('id').primaryKey(),
  locationId: integer('location_id')
    .notNull()
    .references(() => locations.id, { onDelete: 'cascade' }),
  address: varchar('address', { length: 300 }).notNull(),
  soldPrice: integer('sold_price'),
  daysOnMarket: integer('days_on_market'),
  closeDate: timestamp('close_date'),
  photoUrl: varchar('photo_url', { length: 500 }),
  displayOrder: integer('display_order').notNull().default(0),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Testimonials
// ---------------------------------------------------------------------------
export const testimonials = pgTable('testimonials', {
  id: serial('id').primaryKey(),
  locationId: integer('location_id')
    .notNull()
    .references(() => locations.id, { onDelete: 'cascade' }),
  clientName: varchar('client_name', { length: 200 }).notNull(),
  neighborhood: varchar('neighborhood', { length: 200 }),
  quote: text('quote').notNull(),
  saleDetails: varchar('sale_details', { length: 200 }), // badge: "Sold in 9 days · $15K over asking"
  photoUrl: varchar('photo_url', { length: 500 }),
  isActive: boolean('is_active').notNull().default(true),
  isFeatured: boolean('is_featured').notNull().default(false), // homepage selection
  displayOrder: integer('display_order').notNull().default(0),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Neighborhood links (internal linking / long-tail SEO)
// ---------------------------------------------------------------------------
export const neighborhoodLinks = pgTable('neighborhood_links', {
  id: serial('id').primaryKey(),
  locationId: integer('location_id')
    .notNull()
    .references(() => locations.id, { onDelete: 'cascade' }),
  label: varchar('label', { length: 200 }).notNull(),
  url: varchar('url', { length: 500 }).notNull(),
  displayOrder: integer('display_order').notNull().default(0),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Homepage aggregate metrics (single row)
// ---------------------------------------------------------------------------
export const homePageMetrics = pgTable('home_page_metrics', {
  id: serial('id').primaryKey(),
  totalHomesSold: integer('total_homes_sold'),
  avgDaysToSell: integer('avg_days_to_sell'),
  avgSalePrice: integer('avg_sale_price'),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Tracking scripts (GTM and others). locationId null = global / all pages.
// ---------------------------------------------------------------------------
export const trackingScripts = pgTable('tracking_scripts', {
  id: serial('id').primaryKey(),
  locationId: integer('location_id').references(() => locations.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 200 }).notNull(),
  position: scriptPositionEnum('position').notNull().default('body'),
  scriptContent: text('script_content').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Leads
// ---------------------------------------------------------------------------
export const leads = pgTable(
  'leads',
  {
    id: serial('id').primaryKey(),
    sessionId: varchar('session_id', { length: 128 }), // upsert key for partial->complete
    leadType: leadTypeEnum('lead_type').notNull().default('valuation'),
    status: leadStatusEnum('status').notNull().default('new'),
    firstName: varchar('first_name', { length: 120 }),
    lastName: varchar('last_name', { length: 120 }),
    email: varchar('email', { length: 200 }),
    phone: varchar('phone', { length: 40 }),
    propertyAddress: varchar('property_address', { length: 300 }),
    propertyCity: varchar('property_city', { length: 120 }),
    propertyState: varchar('property_state', { length: 10 }),
    propertyZip: varchar('property_zip', { length: 20 }),
    propertyLat: real('property_lat'),
    propertyLng: real('property_lng'),
    timeframe: varchar('timeframe', { length: 80 }),
    estimatedValue: integer('estimated_value'),
    priceRangeLow: integer('price_range_low'),
    priceRangeHigh: integer('price_range_high'),
    locationId: integer('location_id').references(() => locations.id),
    source: varchar('source', { length: 80 }).notNull().default('website'),
    isDeleted: boolean('is_deleted').notNull().default(false), // soft delete
    // Timestamps that were bigint in the old MySQL schema (Section 3.2 fix).
    acceptedAt: timestamp('accepted_at'),
    lastStatusChangedAt: timestamp('last_status_changed_at'),
    staleWarningSentAt: timestamp('stale_warning_sent_at'),
    lastPenaltyAt: timestamp('last_penalty_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    sessionIdx: index('leads_session_idx').on(t.sessionId),
    statusIdx: index('leads_status_idx').on(t.status),
    createdIdx: index('leads_created_idx').on(t.createdAt),
  }),
);

// ---------------------------------------------------------------------------
// Lead offers (routing engine output)
// ---------------------------------------------------------------------------
export const leadOffers = pgTable(
  'lead_offers',
  {
    id: serial('id').primaryKey(),
    leadId: integer('lead_id')
      .notNull()
      .references(() => leads.id, { onDelete: 'cascade' }),
    agentId: integer('agent_id')
      .notNull()
      .references(() => agents.id),
    status: offerStatusEnum('status').notNull().default('offered'),
    offerToken: varchar('offer_token', { length: 128 }).notNull(),
    tokenExpiresAt: timestamp('token_expires_at'),
    tokenUsedAt: timestamp('token_used_at'), // accept marks used; decline idempotent
    offerSentAt: timestamp('offer_sent_at'), // null until email actually sent
    acceptedAt: timestamp('accepted_at'),
    declinedAt: timestamp('declined_at'),
    expiredAt: timestamp('expired_at'),
    firstUpdateDue: timestamp('first_update_due'), // offerSentAt + 48h
    firstUpdateSubmittedAt: timestamp('first_update_submitted_at'),
    escalationSentAt: timestamp('escalation_sent_at'),
    nextReminderDue: timestamp('next_reminder_due'),
    distanceMiles: real('distance_miles'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    tokenIdx: uniqueIndex('lead_offers_token_idx').on(t.offerToken),
    leadIdx: index('lead_offers_lead_idx').on(t.leadId),
    agentIdx: index('lead_offers_agent_idx').on(t.agentId),
    statusIdx: index('lead_offers_status_idx').on(t.status),
  }),
);

// ---------------------------------------------------------------------------
// Lead status update history (agent portal)
// ---------------------------------------------------------------------------
export const statusUpdates = pgTable('status_updates', {
  id: serial('id').primaryKey(),
  leadOfferId: integer('lead_offer_id')
    .notNull()
    .references(() => leadOffers.id, { onDelete: 'cascade' }),
  leadId: integer('lead_id')
    .notNull()
    .references(() => leads.id, { onDelete: 'cascade' }),
  agentId: integer('agent_id')
    .notNull()
    .references(() => agents.id),
  newStatus: leadStatusEnum('new_status').notNull(),
  note: text('note'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Agent score log
// ---------------------------------------------------------------------------
export const agentScoreLog = pgTable('agent_score_log', {
  id: serial('id').primaryKey(),
  agentId: integer('agent_id')
    .notNull()
    .references(() => agents.id, { onDelete: 'cascade' }),
  delta: real('delta').notNull(),
  reason: scoreReasonEnum('reason').notNull(),
  note: text('note'), // required for manual_adjustment
  leadId: integer('lead_id').references(() => leads.id),
  leadOfferId: integer('lead_offer_id').references(() => leadOffers.id),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Agent lead ordering (drag-and-drop in portal)
// ---------------------------------------------------------------------------
export const agentLeadOrder = pgTable(
  'agent_lead_order',
  {
    id: serial('id').primaryKey(),
    agentId: integer('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    leadOfferId: integer('lead_offer_id')
      .notNull()
      .references(() => leadOffers.id, { onDelete: 'cascade' }),
    position: integer('position').notNull().default(0),
  },
  (t) => ({
    uniq: uniqueIndex('agent_lead_order_uniq').on(t.agentId, t.leadOfferId),
  }),
);

// ---------------------------------------------------------------------------
// API usage logs (valuation calls etc.)
// ---------------------------------------------------------------------------
export const apiUsageLogs = pgTable('api_usage_logs', {
  id: serial('id').primaryKey(),
  endpoint: varchar('endpoint', { length: 120 }).notNull(),
  ip: varchar('ip', { length: 64 }),
  statusCode: integer('status_code'),
  meta: text('meta'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Appointment requests (thank-you page + webhook)
// ---------------------------------------------------------------------------
export const appointmentRequests = pgTable('appointment_requests', {
  id: serial('id').primaryKey(),
  leadId: integer('lead_id').references(() => leads.id),
  name: varchar('name', { length: 200 }).notNull(),
  phone: varchar('phone', { length: 40 }),
  email: varchar('email', { length: 200 }),
  preferredTime: varchar('preferred_time', { length: 200 }),
  notes: text('notes'),
  source: varchar('source', { length: 80 }).notNull().default('thank-you'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// API keys (external webhook consumers) — Section 7
// ---------------------------------------------------------------------------
export const apiKeys = pgTable('api_keys', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 200 }).notNull(), // source label
  keyHash: varchar('key_hash', { length: 200 }).notNull(), // bcrypt hash
  keyPrefix: varchar('key_prefix', { length: 20 }).notNull(), // shown for identification
  isActive: boolean('is_active').notNull().default(true),
  lastUsedAt: timestamp('last_used_at'),
  revokedAt: timestamp('revoked_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Notification settings (single-row config) — replaces old `config` table
// ---------------------------------------------------------------------------
export const notificationSettings = pgTable('notification_settings', {
  id: serial('id').primaryKey(),
  notificationEmail: varchar('notification_email', { length: 200 }),
  offerWindowStartHour: integer('offer_window_start_hour').notNull().default(7),
  offerWindowEndHour: integer('offer_window_end_hour').notNull().default(20),
  proximityRadiusMiles: integer('proximity_radius_miles').notNull().default(20),
  queuePointer: integer('queue_pointer').notNull().default(0), // round-robin pointer
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------
export type Office = typeof offices.$inferSelect;
export type Agent = typeof agents.$inferSelect;
export type Location = typeof locations.$inferSelect;
export type MarketStat = typeof marketStats.$inferSelect;
export type RecentSale = typeof recentSales.$inferSelect;
export type Testimonial = typeof testimonials.$inferSelect;
export type NeighborhoodLink = typeof neighborhoodLinks.$inferSelect;
export type TrackingScript = typeof trackingScripts.$inferSelect;
export type Lead = typeof leads.$inferSelect;
export type NewLead = typeof leads.$inferInsert;
export type LeadOffer = typeof leadOffers.$inferSelect;
export type StatusUpdate = typeof statusUpdates.$inferSelect;
export type AgentScoreLogRow = typeof agentScoreLog.$inferSelect;
export type ApiKey = typeof apiKeys.$inferSelect;
export type AppointmentRequest = typeof appointmentRequests.$inferSelect;
export type NotificationSettings = typeof notificationSettings.$inferSelect;
export type HomePageMetrics = typeof homePageMetrics.$inferSelect;
