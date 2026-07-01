-- ---------------------------------------------------------------------------
-- Downloadable resources ("guides") — admin-managed PDF downloads that can be
-- assigned to one or more pages (e.g. "home", or a city slug). Powers the
-- homepage seller-guide block and any future buyer/seller download blocks.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "guides" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" varchar(200) NOT NULL,
	"cover_title" varchar(200),
	"subtitle" varchar(500),
	"file_url" varchar(500) NOT NULL,
	"cover_image_url" varchar(500),
	"pages_label" varchar(50),
	"bullets_json" text,
	"cta_label" varchar(100),
	"placement" text DEFAULT '[]' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "guides_active_idx" ON "guides" ("is_active");
