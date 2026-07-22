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

// Buyer/Seller classification (migration 0026). Label only — no routing impact.
// All current capture flows are seller-side, so this defaults to 'seller';
// 'unknown' is for leads whose intent isn't known.
export const leadIntentEnum = pgEnum('lead_intent', ['seller', 'buyer', 'unknown']);

export const leadStatusEnum = pgEnum('lead_status', [
  'new',
  'attempted_contact', // reached out, no live conversation yet
  // --- Scoring v4 Seller Track (migration 0027) ---
  'connected', // live conversation established (v4; replaces 'contacted')
  'nurturing', // actively worked, no appointment yet (v4; replaces 'qualified'/'working')
  'appointment_set', // listing appointment booked (v4)
  'signed', // listing agreement signed (v4)
  // --- v2 statuses, retired but kept (Postgres can't drop enum values) ---
  'contacted',
  'qualified',
  'working',
  'closed',
  'lost',
  'reopened', // a Lost lead whose contact resubmitted (behaves like New in v4)
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
  'pipeline_attempted', // +1.0 reached Attempted Contact (spec v2 §2)
  'pipeline_contacted', // +2.0 reached Contacted
  'fast_contact_bonus', // +3.0 contacted within 24h of accept
  'pipeline_qualified', // +2.0 reached Qualified
  'stale_48h', // -2.0 no first status update by 48h (spec v2 §2)
  'stale_7day', // -2.0 recurring weekly stale penalty (spec v2 §2)
  'pipeline_stalled', // -3.0 Qualified lead idle 30d, recurring (spec v2 §4.3)
  'lead_deleted_reversal', // reversal of a negative event when a lead is deleted (v1.6 §K.3)
  'manual_adjustment', // variable (requires reason)
  'starting_credit', // +50 one-time queue head start on first activation (rolling-365 only)
  // --- Scoring v4 (migration 0027). Old reasons above (stale_48h/7day,
  // pipeline_stalled, fast_contact_bonus, pipeline_qualified) are retired but kept. ---
  'fast_engagement', // variable +4/+3/+2/+1 for first Attempted/Connected log speed (v4 §4.2)
  'milestone_appointment_set', // +4 first Appointment Set (v4 §4.3)
  'milestone_signed', // +10 first Signed (v4 §4.3)
  'missed_update_checkin', // -2 unified update-clock penalty (v4 §5)
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
  // Each office has its own Google Business Profile, so reviews are fetched
  // per-office by Place ID. The rating/count/fetchedAt are cached from the last
  // Places Details call (google_reviews holds the individual review rows).
  googlePlaceId: varchar('google_place_id', { length: 200 }),
  googleReviewRating: real('google_review_rating'),
  googleReviewCount: integer('google_review_count'),
  googleReviewsFetchedAt: timestamp('google_reviews_fetched_at'),
  // Last fetch error for this office (null = last fetch succeeded), so the admin
  // can see WHY a fetch returned nothing instead of failing silently.
  googleReviewsError: varchar('google_reviews_error', { length: 500 }),
  telnyxNumber: varchar('telnyx_number', { length: 20 }),
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
    // Proximity anchor for lead routing: 'office' (use the agent's office
    // coordinates) or 'custom' (use the geocoded personal location below).
    proximityAnchor: varchar('proximity_anchor', { length: 10 }).notNull().default('office'),
    // Personal location the agent accepts leads around, entered as a city name
    // and geocoded into latitude/longitude on save (used when anchor='custom').
    locationCity: varchar('location_city', { length: 200 }),
    latitude: real('latitude'),
    longitude: real('longitude'),
    // How far (miles) the agent will accept leads from their anchor. Null falls
    // back to the brokerage default (notification_settings.proximityRadiusMiles).
    proximityRadiusMiles: real('proximity_radius_miles'),
    // Scoring v2 — four tracks written together by applyScore (spec v2 §1).
    // `score` is kept as a mirror of scoreLifetime for backward-compat reads.
    score: real('score').notNull().default(50),
    scoreLifetime: real('score_lifetime').notNull().default(50), // never resets; tier label
    scoreYtd: real('score_ytd').notNull().default(0), // resets Jan 1
    scoreMonthly: real('score_monthly').notNull().default(0), // resets 1st of month
    scoreRolling365: real('score_rolling_365').notNull().default(0), // trailing 365d; drives routing slots
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
    smsOptOut: boolean('sms_opt_out').notNull().default(false),
    smsOptOutAt: timestamp('sms_opt_out_at'),
    // Set the first time this agent activates (isAvailable=true); guards the
    // one-time +50 rolling-365 "starting credit" queue head start so it is
    // never re-granted on later toggles (see lib/scoring.ts).
    startingCreditGrantedAt: timestamp('starting_credit_granted_at'),
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
    // Comma-separated mailing cities this location covers (matches closings.city).
    // Null/empty → fall back to the location's own short name.
    matchCities: text('match_cities'),
    // Social proof + Google review display (Section 3.3 / 3.5).
    socialProofCount: integer('social_proof_count').notNull().default(0),
    googleReviewCount: integer('google_review_count'),
    googleReviewRating: real('google_review_rating'),
    // Office whose Google Business Profile powers this city page's reviews.
    // Null = fall back to a mix of all offices' reviews.
    officeId: integer('office_id').references(() => offices.id),
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
    // Optional showcase photo for a sale that appears on a recent-sales tile (§import).
    photoUrl: varchar('photo_url', { length: 500 }),
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
    // Buyer/Seller classification (migration 0026) — label only, no routing impact.
    intent: leadIntentEnum('intent').notNull().default('seller'),
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
    // Lifecycle v2 (spec v2 §4): Contacted precondition for Lost, Lost reason,
    // 30-day stall recurrence clock, and reopen tracking.
    contactedAt: timestamp('contacted_at'),
    lostReason: varchar('lost_reason', { length: 40 }),
    lostAt: timestamp('lost_at'),
    stallPenaltyAt: timestamp('stall_penalty_at'), // retired in v4 (unified clock)
    reopenedAt: timestamp('reopened_at'),
    // Scoring v4 (migration 0027). Unified update clock + once-only milestone
    // guards + reactivation counter (Lost→Reopened). See docs/agent-rating-system.md.
    updateDeadline: timestamp('update_deadline'), // null once Closed/Lost — clock stops (v4 §5)
    firstEngagementLogged: boolean('first_engagement_logged').notNull().default(false),
    milestoneAttemptedContact: boolean('milestone_attempted_contact').notNull().default(false),
    milestoneConnected: boolean('milestone_connected').notNull().default(false),
    milestoneAppointmentSet: boolean('milestone_appointment_set').notNull().default(false),
    milestoneSigned: boolean('milestone_signed').notNull().default(false),
    reactivationCount: integer('reactivation_count').notNull().default(0),
    // IDX market report (IDX spec §5.3 / §8.3): durable signed token for the
    // homeowner's report link, plus view tracking for the admin access log.
    reportToken: varchar('report_token', { length: 64 }),
    reportFirstAccessedAt: timestamp('report_first_accessed_at'),
    reportViewCount: integer('report_view_count').notNull().default(0),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    sessionIdx: index('leads_session_idx').on(t.sessionId),
    statusIdx: index('leads_status_idx').on(t.status),
    createdIdx: index('leads_created_idx').on(t.createdAt),
    emailIdx: index('leads_email_idx').on(t.email),
    reportTokenIdx: index('leads_report_token_idx').on(t.reportToken),
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
// Valuations — the two-tier gated report store.
// A row is written when a visitor enters an address (pre-contact). The browser
// only ever receives the widened ±8% teaser range + basics + `token`. The
// precise estimate, actual provider range, confidence, and sale history stay
// server-side. On lead submit we set `leadId`; the report page only reveals the
// full detail once `leadId` is set — so the gate is enforced server-side and
// can't be bypassed from the client.
// ---------------------------------------------------------------------------
export const valuations = pgTable(
  'valuations',
  {
    id: serial('id').primaryKey(),
    token: varchar('token', { length: 64 }).notNull(),
    provider: varchar('provider', { length: 20 }).notNull().default('rentcast'),
    address: varchar('address', { length: 300 }),
    estimatedValue: integer('estimated_value'),
    priceRangeLow: integer('price_range_low'), // actual (tight) provider range
    priceRangeHigh: integer('price_range_high'),
    teaserRangeLow: integer('teaser_range_low'), // widened ±8%, shown pre-contact
    teaserRangeHigh: integer('teaser_range_high'),
    confidenceScore: integer('confidence_score'),
    beds: real('beds'),
    baths: real('baths'),
    sqft: integer('sqft'),
    yearBuilt: integer('year_built'),
    lotSizeSqft: integer('lot_size_sqft'),
    propertyType: varchar('property_type', { length: 80 }),
    saleHistory: text('sale_history'), // JSON array of { date, price }
    attomId: varchar('attom_id', { length: 40 }), // ATTOM property id (comps)
    areaGeoId: varchar('area_geo_id', { length: 40 }), // ATTOM ZIP geo id (trends)
    latitude: real('latitude'),
    longitude: real('longitude'),
    leadId: integer('lead_id').references(() => leads.id), // set on conversion; reveal gate
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    tokenIdx: uniqueIndex('valuations_token_idx').on(t.token),
    leadIdx: index('valuations_lead_idx').on(t.leadId),
    createdIdx: index('valuations_created_idx').on(t.createdAt),
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
// SMS message log — Telnyx agent texting (Phase 1)
// ---------------------------------------------------------------------------
export const smsMessages = pgTable(
  'sms_messages',
  {
    id: serial('id').primaryKey(),
    direction: varchar('direction', { length: 10 }).notNull(), // 'outbound' | 'inbound'
    agentId: integer('agent_id').references(() => agents.id),
    leadId: integer('lead_id').references(() => leads.id),
    officeId: integer('office_id').references(() => offices.id),
    fromNumber: varchar('from_number', { length: 20 }).notNull(),
    toNumber: varchar('to_number', { length: 20 }).notNull(),
    body: text('body').notNull(),
    kind: varchar('kind', { length: 30 }).notNull(),
    telnyxMessageId: varchar('telnyx_message_id', { length: 100 }),
    status: varchar('status', { length: 20 }).notNull(),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    agentIdx: index('sms_messages_agent_idx').on(t.agentId),
    leadIdx: index('sms_messages_lead_idx').on(t.leadId),
    telnyxIdx: index('sms_messages_telnyx_id_idx').on(t.telnyxMessageId),
  }),
);

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
  // Testimonials source (Section — reviews): 'manual' | 'google' | 'both'.
  testimonialSource: varchar('testimonial_source', { length: 10 }).notNull().default('manual'),
  googlePlaceId: varchar('google_place_id', { length: 200 }), // for Google reviews
  // Shared code an agent must enter on /agent/set-password before setting/
  // resetting their password (migration 0029). Null/empty = setup page closed.
  agentSetupCode: varchar('agent_setup_code', { length: 60 }),
  // Scoring v2 periodic-reset guards (so the maintenance cron resets each track
  // only once per boundary). Store the period key that was last reset.
  scoreMonthlyResetKey: varchar('score_monthly_reset_key', { length: 7 }), // 'YYYY-MM'
  scoreYtdResetKey: varchar('score_ytd_reset_key', { length: 4 }), // 'YYYY'
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Cached Google Places reviews. The Places API returns up to 5 reviews per
// place; we cache them here so public pages don't hit (and pay for) the API on
// every request. Refreshed by an admin button (and optionally a cron).
// ---------------------------------------------------------------------------
export const googleReviews = pgTable(
  'google_reviews',
  {
    id: serial('id').primaryKey(),
    placeId: varchar('place_id', { length: 200 }).notNull(),
    authorName: varchar('author_name', { length: 200 }),
    rating: integer('rating'), // 1-5
    text: text('text'),
    relativeTime: varchar('relative_time', { length: 100 }), // "2 months ago"
    profilePhotoUrl: varchar('profile_photo_url', { length: 500 }),
    reviewTime: integer('review_time'), // unix seconds — ordering/dedup
    fetchedAt: timestamp('fetched_at').notNull().defaultNow(),
  },
  (t) => ({
    placeIdx: index('google_reviews_place_idx').on(t.placeId),
  }),
);

// ---------------------------------------------------------------------------
// IDX / Realcomp integration (IDX spec §1–§2)
// ---------------------------------------------------------------------------

/**
 * Persisted Realcomp OAuth token — single row (keyed by `provider`) so every
 * Vercel serverless invocation shares one token instead of re-authenticating.
 * Same pattern as ms_graph_tokens (IDX spec §1.3).
 */
export const realcompTokens = pgTable('realcomp_tokens', {
  id: serial('id').primaryKey(),
  provider: varchar('provider', { length: 50 }).notNull().unique().default('realcomp'),
  accessToken: text('access_token').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

/**
 * Local mirror of Realcomp listings, synced hourly (IDX spec §2.2). Powers the
 * Similar Homes + Market Report features and (office deals) the brokerage
 * metrics. Upsert key: listingKey. `isOfficeListing` is computed on upsert.
 */
export const idxListings = pgTable(
  'idx_listings',
  {
    id: serial('id').primaryKey(),
    listingKey: varchar('listing_key', { length: 100 }).notNull().unique(), // upsert key
    // Office keys (numeric Realcomp ids) — drive isOfficeListing, not display.
    listOfficeKey: varchar('list_office_key', { length: 100 }),
    buyerOfficeKey: varchar('buyer_office_key', { length: 100 }),
    coListOfficeKey: varchar('co_list_office_key', { length: 100 }),
    coBuyerOfficeKey: varchar('co_buyer_office_key', { length: 100 }),
    // IDX compliance display flags. false = restrict (see public query filters).
    internetAddressDisplayYN: boolean('internet_address_display_yn'),
    internetEntireListingDisplayYN: boolean('internet_entire_listing_display_yn'),
    // Status / pricing.
    mlsNumber: varchar('mls_number', { length: 50 }),
    mlsStatus: varchar('mls_status', { length: 30 }),
    standardStatus: varchar('standard_status', { length: 30 }).notNull(),
    listPrice: integer('list_price'),
    closePrice: integer('close_price'),
    closeDate: timestamp('close_date'),
    daysOnMarket: integer('days_on_market'),
    cumulativeDaysOnMarket: integer('cumulative_days_on_market'),
    originalListPrice: integer('original_list_price'),
    // text (not varchar): RESO property-type strings have no reliable max length.
    propertyType: text('property_type'),
    propertySubType: text('property_sub_type'),
    // Location. text on the enum-derived fields (0016) — the live feed overflowed
    // varchar(100) (county-suffixed city enums, long area names).
    address: text('address'),
    city: text('city'),
    postalCity: text('postal_city'),
    originalCity: text('original_city'),
    originalPostalCity: text('original_postal_city'),
    countyOrParish: text('county_or_parish'),
    township: text('township'), // approximated; no direct OData field
    subdivisionName: text('subdivision_name'),
    mlsAreaMajor: text('mls_area_major'),
    stateOrProvince: varchar('state_or_province', { length: 10 }),
    postalCode: varchar('postal_code', { length: 20 }),
    latitude: real('latitude'),
    longitude: real('longitude'),
    // Property detail.
    bedsTotal: integer('beds_total'),
    bathsTotal: real('baths_total'), // BathroomsTotalInteger; decimal (2.5 = 2 full + 1 half)
    livingArea: integer('living_area'),
    yearBuilt: integer('year_built'),
    lotSizeAcres: real('lot_size_acres'),
    garageSpaces: integer('garage_spaces'),
    basement: text('basement'), // multi-value enum serialized to a comma list
    schoolDistrict: text('school_district'),
    // Waterfront.
    waterfrontYN: boolean('waterfront_yn'),
    waterfrontFeatures: text('waterfront_features'), // serialized comma-list from enum multi-value
    waterBodyName: text('water_body_name'),
    waterFrontageFeet: real('water_frontage_feet'),
    // Buyer-relevant detail (0021) — the "data sheet" fields buyers search on.
    // All text columns are serialized comma-lists from RESO enum multi-values
    // (Heating, Appliances, etc.); numeric/bool are scalar RESO fields. text
    // (not varchar) per the external-feed rule — lengths aren't ours to bound.
    architecturalStyle: text('architectural_style'),
    levels: text('levels'), // "One", "Two", "Tri-Level" (RESO Levels enum)
    storiesTotal: integer('stories_total'),
    roomsTotal: integer('rooms_total'),
    heating: text('heating'),
    cooling: text('cooling'),
    fireplacesTotal: integer('fireplaces_total'),
    fireplaceFeatures: text('fireplace_features'),
    laundryFeatures: text('laundry_features'),
    interiorFeatures: text('interior_features'),
    exteriorFeatures: text('exterior_features'),
    appliances: text('appliances'),
    flooring: text('flooring'),
    constructionMaterials: text('construction_materials'),
    roof: text('roof'),
    foundationDetails: text('foundation_details'),
    parkingFeatures: text('parking_features'),
    attachedGarageYN: boolean('attached_garage_yn'),
    poolPrivateYN: boolean('pool_private_yn'),
    poolFeatures: text('pool_features'),
    patioAndPorchFeatures: text('patio_and_porch_features'),
    lotFeatures: text('lot_features'),
    lotSizeDimensions: text('lot_size_dimensions'),
    view: text('view'),
    waterSource: text('water_source'),
    sewer: text('sewer'),
    utilities: text('utilities'),
    newConstructionYN: boolean('new_construction_yn'),
    zoning: text('zoning'),
    // HOA / association + costs.
    associationYN: boolean('association_yn'),
    associationFee: real('association_fee'),
    associationFeeFrequency: text('association_fee_frequency'), // "Monthly", "Annually"
    associationFeeIncludes: text('association_fee_includes'),
    associationAmenities: text('association_amenities'),
    taxAnnualAmount: real('tax_annual_amount'),
    taxYear: integer('tax_year'),
    // Media / marketing.
    photoUrl: text('photo_url'), // primary photo (lowest Order); text — external URL, unbounded (0017)
    photosCount: integer('photos_count'),
    virtualTourUrl: text('virtual_tour_url'), // unbranded only; text — external URL (0017)
    publicRemarks: text('public_remarks'),
    // IDX-required display credit.
    listingOfficeName: text('listing_office_name'),
    listingOfficePhone: varchar('listing_office_phone', { length: 50 }),
    originatingSystemName: text('originating_system_name'),
    // Sync bookkeeping.
    modificationTimestamp: timestamp('modification_timestamp').notNull(), // incremental cursor
    isOfficeListing: boolean('is_office_listing').notNull().default(false), // computed on upsert
    lastSyncedAt: timestamp('last_synced_at').notNull().defaultNow(),
  },
  (t) => ({
    listingKeyIdx: uniqueIndex('idx_listings_listing_key_idx').on(t.listingKey),
    statusIdx: index('idx_listings_status_idx').on(t.standardStatus),
    cityIdx: index('idx_listings_city_idx').on(t.city),
    countyIdx: index('idx_listings_county_idx').on(t.countyOrParish),
    officeIdx: index('idx_listings_office_idx').on(t.isOfficeListing),
    modIdx: index('idx_listings_mod_idx').on(t.modificationTimestamp),
    priceIdx: index('idx_listings_price_idx').on(t.listPrice),
    closeDateIdx: index('idx_listings_close_date_idx').on(t.closeDate),
  }),
);

/**
 * All photos for a listing (IDX spec: pull the full Media set via $expand=Media).
 * Display gating lives in the UI: full gallery for Active listings only;
 * Pending/Closed show the primary photo only (IDX Rules §18.10).
 */
export const idxListingPhotos = pgTable(
  'idx_listing_photos',
  {
    id: serial('id').primaryKey(),
    listingKey: varchar('listing_key', { length: 100 })
      .notNull()
      .references(() => idxListings.listingKey, { onDelete: 'cascade' }),
    mediaUrl: text('media_url').notNull(), // text — external Realcomp URL, unbounded (0017)
    sortOrder: integer('sort_order').notNull().default(0), // Realcomp Media "Order"
    mediaCategory: varchar('media_category', { length: 50 }),
  },
  (t) => ({
    listingIdx: index('idx_listing_photos_listing_idx').on(t.listingKey),
    orderIdx: index('idx_listing_photos_order_idx').on(t.listingKey, t.sortOrder),
  }),
);

/** One row per sync run, with separate Query 1 / Query 2 counts (IDX spec §2.3). */
export const idxSyncLog = pgTable('idx_sync_log', {
  id: serial('id').primaryKey(),
  syncStartedAt: timestamp('sync_started_at').notNull(),
  syncCompletedAt: timestamp('sync_completed_at'),
  query1RecordsFetched: integer('query1_records_fetched'),
  query1RecordsUpserted: integer('query1_records_upserted'),
  query2RecordsFetched: integer('query2_records_fetched'),
  query2RecordsUpserted: integer('query2_records_upserted'),
  status: varchar('status', { length: 20 }).notNull(), // running | success | failed
  errorMessage: text('error_message'),
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
/**
 * Cached AVM-provider property records (owner, features, tax, sale history),
 * keyed by normalized address so multiple leads at the same address and the
 * admin lookup tool share one cached fetch instead of re-billing the provider.
 */
export const propertyRecords = pgTable(
  'property_records',
  {
    id: serial('id').primaryKey(),
    normalizedAddress: varchar('normalized_address', { length: 500 }).notNull(),
    address: varchar('address', { length: 300 }),
    provider: varchar('provider', { length: 20 }).notNull().default('rentcast'),
    rawJson: text('raw_json'), // full provider response for this address
    fetchedAt: timestamp('fetched_at').notNull().defaultNow(),
  },
  (t) => ({
    addrIdx: uniqueIndex('property_records_addr_idx').on(t.normalizedAddress),
  }),
);
export type PropertyRecordRow = typeof propertyRecords.$inferSelect;
export type NewPropertyRecordRow = typeof propertyRecords.$inferInsert;

/**
 * Cached AI-written market-report narratives, keyed by lower(city). Regenerated
 * only when the underlying stats change (tracked by `signature`), so the report
 * isn't calling the model on every page render.
 */
export const marketNarratives = pgTable(
  'market_narratives',
  {
    id: serial('id').primaryKey(),
    cityKey: varchar('city_key', { length: 200 }).notNull(),
    narrative: text('narrative'),
    signature: varchar('signature', { length: 120 }),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    cityIdx: uniqueIndex('market_narratives_city_idx').on(t.cityKey),
  }),
);
export type MarketNarrativeRow = typeof marketNarratives.$inferSelect;

/**
 * Cached "neighborhood highlights" (nearby restaurants, parks, coffee, groceries,
 * golf, etc.) from Google Places Nearby Search, keyed by a coarse coordinate grid
 * cell (~110 m) so listings in the same block reuse one lookup and repeat views
 * never re-bill Google. `payloadJson` holds the POIs with their own coordinates,
 * so exact per-home distances are recomputed at render from the actual listing
 * lat/lng. School POIs are intentionally never fetched or stored.
 */
export const areaPoiCache = pgTable(
  'area_poi_cache',
  {
    id: serial('id').primaryKey(),
    geoKey: varchar('geo_key', { length: 40 }).notNull(), // "lat.toFixed(3),lng.toFixed(3)"
    latitude: real('latitude'),
    longitude: real('longitude'),
    payloadJson: text('payload_json'), // JSON array of { category, name, lat, lng, vicinity }
    error: text('error'),
    fetchedAt: timestamp('fetched_at').notNull().defaultNow(),
  },
  (t) => ({
    geoIdx: uniqueIndex('area_poi_cache_geo_idx').on(t.geoKey),
  }),
);
export type AreaPoiCacheRow = typeof areaPoiCache.$inferSelect;

/**
 * Resumable-backfill checkpoints. Keyed by a job key (e.g. "active" or
 * "sold:ListOfficeMlsId:2024-01-01:2025-01-01"), holding the newest
 * ModificationTimestamp processed so far. A failed initial-sync run leaves the
 * checkpoint behind so the next run resumes from there (the query orders by
 * ModificationTimestamp ascending); a successful run clears it.
 */
export const idxBackfillCheckpoints = pgTable(
  'idx_backfill_checkpoints',
  {
    id: serial('id').primaryKey(),
    jobKey: varchar('job_key', { length: 200 }).notNull(),
    lastModTs: timestamp('last_mod_ts'),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    jobIdx: uniqueIndex('idx_backfill_checkpoints_job_idx').on(t.jobKey),
  }),
);
export type IdxBackfillCheckpointRow = typeof idxBackfillCheckpoints.$inferSelect;

export type Closing = typeof closings.$inferSelect;
export type NewClosing = typeof closings.$inferInsert;
export type UploadBatch = typeof uploadBatches.$inferSelect;
export type LeadEvent = typeof leadEvents.$inferSelect;
export type AgentQueueRow = typeof agentQueue.$inferSelect;
export type ApiUsageLogRow = typeof apiUsageLogs.$inferSelect;
export type Valuation = typeof valuations.$inferSelect;
export type NewValuation = typeof valuations.$inferInsert;
export type GoogleReviewRow = typeof googleReviews.$inferSelect;
export type RealcompToken = typeof realcompTokens.$inferSelect;
export type SmsMessage = typeof smsMessages.$inferSelect;
export type NewSmsMessage = typeof smsMessages.$inferInsert;
export type IdxListing = typeof idxListings.$inferSelect;
export type NewIdxListing = typeof idxListings.$inferInsert;
export type IdxListingPhoto = typeof idxListingPhotos.$inferSelect;
export type NewIdxListingPhoto = typeof idxListingPhotos.$inferInsert;
export type IdxSyncLogRow = typeof idxSyncLog.$inferSelect;
