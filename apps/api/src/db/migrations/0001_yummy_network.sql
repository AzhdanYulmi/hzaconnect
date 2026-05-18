CREATE TYPE "public"."identifier_kind" AS ENUM('player_id', 'email', 'phone', 'username', 'custom');--> statement-breakpoint
CREATE TYPE "public"."identifier_source" AS ENUM('self', 'agent', 'sso');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "deployment_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"identifier_fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"require_before_chat" text DEFAULT 'false' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "session_identifiers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"kind" "identifier_kind" NOT NULL,
	"custom_label" text,
	"value" "citext" NOT NULL,
	"source" "identifier_source" NOT NULL,
	"created_by_agent_id" uuid,
	"superseded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "session_identifiers" ADD CONSTRAINT "session_identifiers_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "session_identifiers" ADD CONSTRAINT "session_identifiers_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "session_identifiers_session_idx" ON "session_identifiers" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "session_identifiers_value_idx" ON "session_identifiers" USING btree ("kind","value");