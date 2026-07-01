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
  'closed_manual', // admin manual reassignment (Section 18)
]);

export const scoreReasonEnum = pgEnum('score_reason', [
  'system_response_fast', // +10.0 accept <15 min / +7.65 15–30 min (v1.6 §E.3)
  'system_response_good', // +5.0 accept 30–60 min
  'system_response_slow', // +2.0 accept 60 min–3 hours
  'system_no_response', // -1.5 auto-expired
  'system_decline', // -3.0 declined (v1.6 §E.4 / §J)
  'system_closing', // +15.0 lead closed
  'pipeline_contacted', // +2.0 reached Contacted
  'fast_contact_bonus', // +3.0 contacted within 24h of accept
  'pipeline_qualified', // +2.0 reached Qualified
  'stale_48h', // -1.0 no first status update by 48h (v1.6 §E.5)
  'stale_7day', // -1.0 recurring weekly stale penalty (v1.6 §E.5)
  'lead_deleted_reversal', // reversal of a negative event when a lead is deleted (v1.6 §K.3)
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
    score: real('score').notNull().default(50), // v1.6 §E.2/§J: new agents start at 50
    // Admin-controlled membership.
    isActive: boolean('is_active').notNull().default(true),
    // Agent self-controlled availability (Section 16). Both must be true to
    // receive new offers. Toggled from the agent portal.
    isAvailable: boolean('is_available').notNull().default(true),
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
    // District name used to match closings to this city for per-location stats (v1.6 §A.2).
    schoolDistrict: varchar('school_district', { length: 200 }),
    // Social proof + Google review display (Section 3.3 / 3.5).
    socialProofCount: integer('social_proof_count').notNull().default(0),
    googleReviewCount: integer('google_review_count'),
    googleReviewRating: real('google_review_rating'),
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
  // Auto-population from closings (v1.6 §A.4). Manual rows keep these null/false
  // and are never overwritten or deleted by the metrics recompute.
  isAutoPopulated: boolean('is_auto_populated').notNull().default(false),
  closingId: integer('closing_id').references(() => closings.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Closings + upload batches (CSV import → market-stats recompute) — v1.6 §A.2
// ---------------------------------------------------------------------------
export const uploadBatches = pgTable('upload_batches', {
  id: serial('id').primaryKey(),
  agentRole: varchar('agent_role', { length: 20 }).notNull(), // 'listing' | 'buyer'
  fileName: varchar('file_name', { length: 500 }),
  rowsImported: integer('rows_imported').notNull().default(0),
  rowsSkipped: integer('rows_skipped').notNull().default(0),
  rowsErrored: integer('rows_errored').notNull().default(0),
  earliestCloseDate: timestamp('earliest_close_date'),
  latestCloseDate: timestamp('latest_close_date'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const closings = pgTable(
  'closings',
  {
    id: serial('id').primaryKey(),
    mlsNumber: varchar('mls_number', { length: 50 }), // dedup key per agentRole; null = no dedup
    agentRole: varchar('agent_role', { length: 20 }).notNull(), // 'listing' | 'buyer'
    closeDate: timestamp('close_date').notNull(),
    listPrice: integer('list_price'),
    salePrice: integer('sale_price').notNull(),
    daysOnMarket: integer('days_on_market'),
    address: varchar('address', { length: 500 }).notNull(),
    city: varchar('city', { length: 100 }),
    state: varchar('state', { length: 10 }).notNull().default('MI'),
    zipCode: varchar('zip_code', { length: 20 }),
    propertyType: varchar('property_type', { length: 100 }).notNull().default('Single Family'),
    agentName: varchar('agent_name', { length: 200 }),
    schoolDistrict: varchar('school_district', { length: 200 }), // per-location stats matching
    percentOfListPrice: real('percent_of_list_price'), // sale/list ratio as a percentage
    uploadBatchId: integer('upload_batch_id')
      .notNull()
      .references(() => uploadBatches.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    mlsRoleIdx: index('closings_mls_role_idx').on(t.mlsNumber, t.agentRole),
    districtIdx: index('closings_district_idx').on(t.schoolDistrict),
    closeDateIdx: index('closings_close_date_idx').on(t.closeDate),
    batchIdx: index('closings_batch_idx').on(t.uploadBatchId),
  }),
);

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
  totalHomesSold: integer('total_homes_sold'), // all closings, all years
  avgDaysToSell: integer('avg_days_to_sell'),
  avgSalePrice: integer('avg_sale_price'),
  // v1.6 §A.4 — full recompute set.
  homesSold: integer('homes_sold'), // 2025 window count (all-time fallback)
  avgPercentOfList: integer('avg_percent_of_list'),
  pctAboveListPrice: integer('pct_above_list_price'),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Downloadable resources ("guides") — admin-managed PDFs assigned to pages.
// `placement` is a JSON array of page keys (e.g. ["home"] or a city slug) so a
// single download can be shown on one or more pages and managed in one place.
// ---------------------------------------------------------------------------
export const guides = pgTable('guides', {
  id: serial('id').primaryKey(),
  title: varchar('title', { length: 200 }).notNull(), // marketing headline, e.g. "Sell for more, with less stress"
  coverTitle: varchar('cover_title', { length: 200 }), // name on the cover, e.g. "The SE Michigan Home Seller's Guide"
  subtitle: varchar('subtitle', { length: 500 }),
  fileUrl: varchar('file_url', { length: 500 }).notNull(), // the PDF
  coverImageUrl: varchar('cover_image_url', { length: 500 }),
  pagesLabel: varchar('pages_label', { length: 50 }), // e.g. "24 pages"
  bulletsJson: text('bullets_json'), // JSON array of bullet strings
  ctaLabel: varchar('cta_label', { length: 100 }),
  placement: text('placement').notNull().default('[]'), // JSON array of page keys
  isActive: boolean('is_active').notNull().default(true),
  displayOrder: integer('display_order').notNull().default(0),
  createdAt: timestamp('created_at').notNull().defaultNow(),
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
    // 'seo' | 'ads' — which page type captured the lead (Section 3.3).
    pageVariant: varchar('page_variant', { length: 50 }),
    // Attribution (v1.6 §C.2) — captured client-side, persisted per lead.
    utmSource: varchar('utm_source', { length: 200 }),
    utmMedium: varchar('utm_medium', { length: 200 }),
    utmCampaign: varchar('utm_campaign', { length: 200 }),
    utmContent: varchar('utm_content', { length: 200 }),
    utmTerm: varchar('utm_term', { length: 200 }),
    gclid: varchar('gclid', { length: 500 }),
    gbraid: varchar('gbraid', { length: 500 }),
    wbraid: varchar('wbraid', { length: 500 }),
    referrer: varchar('referrer', { length: 1000 }),
    landingPageUrl: varchar('landing_page_url', { length: 1000 }),
    deviceType: varchar('device_type', { length: 20 }), // 'mobile' | 'tablet' | 'desktop'
    firstSeenAt: timestamp('first_seen_at'),
    lastSeenAt: timestamp('last_seen_at'),
    // Normalized property address for cross-session dedup (v1.6 §D.3).
    normalizedAddress: varchar('normalized_address', { length: 500 }),
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
    emailIdx: index('leads_email_idx').on(t.email),
    normalizedAddrIdx: index('leads_normalized_addr_idx').on(t.normalizedAddress),
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
    // Generic responded-at for the offer history timeline (Section 17.2) —
    // set on accept, decline, expiry, or manual close.
    respondedAt: timestamp('responded_at'),
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
  // Score negation on lead delete (v1.6 §E.7 / §K.3). Reversed penalties are
  // flagged here and a paired lead_deleted_reversal row records the give-back.
  isNegated: boolean('is_negated').default(false),
  negatedReason: varchar('negated_reason', { length: 500 }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Lead events — full lifecycle timeline (v1.6 §D.4)
// ---------------------------------------------------------------------------
export const leadEvents = pgTable(
  'lead_events',
  {
    id: serial('id').primaryKey(),
    leadId: integer('lead_id')
      .notNull()
      .references(() => leads.id, { onDelete: 'cascade' }),
    // 'address_entered' | 'valuation_submitted' | 'duplicate_submission' |
    // 'appointment_requested' | 'offer_sent' | 'offer_accepted' | 'offer_declined' |
    // 'offer_expired' | 'manually_assigned' | 'status_updated'
    eventType: varchar('event_type', { length: 100 }).notNull(),
    note: text('note'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    leadIdx: index('lead_events_lead_idx').on(t.leadId),
  }),
);

// ---------------------------------------------------------------------------
// Agent queue — persisted weighted round-robin rotation (v1.6 §G.2)
// ---------------------------------------------------------------------------
export const agentQueue = pgTable('agent_queue', {
  id: serial('id').primaryKey(),
  rotationList: text('rotation_list').notNull(), // JSON array of agent ids (with slot duplicates)
  pointer: integer('pointer').notNull().default(0),
  lastRebuilt: timestamp('last_rebuilt').notNull().defaultNow(),
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
export const apiUsageLogs = pgTable(
  'api_usage_logs',
  {
    id: serial('id').primaryKey(),
    endpoint: varchar('endpoint', { length: 120 }).notNull(),
    ip: varchar('ip', { length: 64 }),
    statusCode: integer('status_code'),
    // Enriched columns for the RentCast usage dashboard (v1.6 §H / §K.7).
    service: varchar('service', { length: 50 }),
    propertyAddress: varchar('property_address', { length: 500 }),
    estimatedValue: integer('estimated_value'),
    priceRangeLow: integer('price_range_low'),
    priceRangeHigh: integer('price_range_high'),
    success: boolean('success'),
    errorMessage: text('error_message'),
    responseTimeMs: integer('response_time_ms'),
    meta: text('meta'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    serviceIdx: index('api_usage_service_idx').on(t.service),
    createdIdx: index('api_usage_created_idx').on(t.createdAt),
  }),
);

// ---------------------------------------------------------------------------
// Neon-backed fixed-window rate limits (Section 3.3 / 8). No Redis.
// Composite unique on (ip, endpoint, windowStart) — the background upsert
// increments hitCount per window. Cron purges rows older than 24h.
// ---------------------------------------------------------------------------
export const rateLimits = pgTable(
  'rate_limits',
  {
    id: serial('id').primaryKey(),
    ip: varchar('ip', { length: 64 }).notNull(),
    endpoint: varchar('endpoint', { length: 100 }).notNull(),
    windowStart: timestamp('window_start').notNull(),
    hitCount: integer('hit_count').notNull().default(1),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    uniq: uniqueIndex('rate_limits_ip_endpoint_window_idx').on(
      t.ip,
      t.endpoint,
      t.windowStart,
    ),
    windowIdx: index('rate_limits_window_idx').on(t.windowStart),
  }),
);

// ---------------------------------------------------------------------------
// MS Graph OAuth token (single row) — persists the token across serverless
// invocations so it isn't silently lost between calls (Section 3.3 / 6.3).
// ---------------------------------------------------------------------------
export const msGraphTokens = pgTable('ms_graph_tokens', {
  id: serial('id').primaryKey(),
  accountEmail: varchar('account_email', { length: 200 }).notNull().unique(),
  accessToken: text('access_token').notNull(),
  refreshToken: text('refresh_token').notNull().default(''), // unused in client-credentials flow
  expiresAt: timestamp('expires_at').notNull(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Email send log — every MS Graph send attempt (Section 3.3 / 6.4).
// Replaces the Resend dashboard; viewable at /admin/email-log.
// ---------------------------------------------------------------------------
export const emailSendLog = pgTable('email_send_log', {
  id: serial('id').primaryKey(),
  toEmail: varchar('to_email', { length: 200 }).notNull(),
  subject: varchar('subject', { length: 500 }).notNull(),
  templateName: varchar('template_name', { length: 100 }).notNull(),
  status: varchar('status', { length: 20 }).notNull(), // 'sent' | 'failed'
  errorMessage: text('error_message'),
  sentAt: timestamp('sent_at').notNull().defaultNow(),
  relatedLeadId: integer('related_lead_id'),
  relatedAgentId: integer('related_agent_id'),
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
  // Attribution (v1.6 §C.2) — mirrors leads.
  utmSource: varchar('utm_source', { length: 200 }),
  utmMedium: varchar('utm_medium', { length: 200 }),
  utmCampaign: varchar('utm_campaign', { length: 200 }),
  utmContent: varchar('utm_content', { length: 200 }),
  utmTerm: varchar('utm_term', { length: 200 }),
  gclid: varchar('gclid', { length: 500 }),
  gbraid: varchar('gbraid', { length: 500 }),
  wbraid: varchar('wbraid', { length: 500 }),
  referrer: varchar('referrer', { length: 1000 }),
  landingPageUrl: varchar('landing_page_url', { length: 1000 }),
  deviceType: varchar('device_type', { length: 20 }),
  firstSeenAt: timestamp('first_seen_at'),
  lastSeenAt: timestamp('last_seen_at'),
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
export type Guide = typeof guides.$inferSelect;
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
export type MsGraphToken = typeof msGraphTokens.$inferSelect;
export type EmailSendLogRow = typeof emailSendLog.$inferSelect;
export type RateLimitRow = typeof rateLimits.$inferSelect;
export type Closing = typeof closings.$inferSelect;
export type NewClosing = typeof closings.$inferInsert;
export type UploadBatch = typeof uploadBatches.$inferSelect;
export type LeadEvent = typeof leadEvents.$inferSelect;
export type AgentQueueRow = typeof agentQueue.$inferSelect;
export type ApiUsageLogRow = typeof apiUsageLogs.$inferSelect;
