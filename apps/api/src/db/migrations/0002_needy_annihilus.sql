CREATE TABLE IF NOT EXISTS "conversation_tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"applied_by_agent_id" uuid,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tag_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"label_en" text NOT NULL,
	"label_tr" text,
	"color" text DEFAULT '#374151' NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conversation_tags" ADD CONSTRAINT "conversation_tags_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conversation_tags" ADD CONSTRAINT "conversation_tags_tag_id_tag_definitions_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tag_definitions"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conversation_tags" ADD CONSTRAINT "conversation_tags_applied_by_agent_id_agents_id_fk" FOREIGN KEY ("applied_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "conversation_tags_active_unique" ON "conversation_tags" USING btree ("conversation_id","tag_id") WHERE "conversation_tags"."removed_at" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversation_tags_conv_idx" ON "conversation_tags" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversation_tags_tag_idx" ON "conversation_tags" USING btree ("tag_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tag_definitions_slug_unique" ON "tag_definitions" USING btree ("slug");