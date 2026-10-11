CREATE TABLE "sliper"."profile_photos" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"object_key" varchar(41) NOT NULL,
	"content_type" varchar(40) NOT NULL,
	"bytes" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profile_photos_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "profile_photos_object_key_unique" UNIQUE("object_key"),
	CONSTRAINT "profile_photo_object_key" CHECK ("sliper"."profile_photos"."object_key" = "sliper"."profile_photos"."id"::text || '.webp'),
	CONSTRAINT "profile_photo_content_type" CHECK ("sliper"."profile_photos"."content_type" = 'image/webp'),
	CONSTRAINT "profile_photo_byte_size" CHECK ("sliper"."profile_photos"."bytes" between 1 and 2097152)
);
--> statement-breakpoint
ALTER TABLE "sliper"."profile_photos" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sliper"."profile_photos" ADD CONSTRAINT "profile_photos_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "sliper"."profiles"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
REVOKE ALL ON TABLE sliper.profile_photos FROM PUBLIC, anon, authenticated;
