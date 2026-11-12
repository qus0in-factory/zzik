CREATE TABLE "usage_event" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "usage_event_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"provider" text NOT NULL,
	"run_at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"raw_sha256" text,
	"envelope" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_snapshot" (
	"provider" text PRIMARY KEY NOT NULL,
	"envelope" jsonb NOT NULL,
	"status" text NOT NULL,
	"run_at" timestamp with time zone NOT NULL,
	"fetched_at" timestamp with time zone,
	"raw_sha256" text,
	"collector_version" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "usage_event_provider_run_at" ON "usage_event" USING btree ("provider","run_at" DESC NULLS LAST);