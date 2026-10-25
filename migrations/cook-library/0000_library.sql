CREATE TABLE `change` (
	`seq` integer PRIMARY KEY NOT NULL,
	`at` integer NOT NULL,
	`by` text NOT NULL,
	`kind` text NOT NULL,
	`payload` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `collection` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`name_key` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `collection_name_key_unique` ON `collection` (`name_key`);--> statement-breakpoint
CREATE TABLE `collection_recipe` (
	`collection_id` integer NOT NULL,
	`recipe_id` text NOT NULL,
	`position` integer NOT NULL,
	PRIMARY KEY(`collection_id`, `recipe_id`)
);
--> statement-breakpoint
CREATE INDEX `collection_recipe_recipe_id` ON `collection_recipe` (`recipe_id`);--> statement-breakpoint
CREATE TABLE `connection` (
	`client_id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`connected_at` integer NOT NULL,
	`disconnected_at` integer
);
--> statement-breakpoint
CREATE TABLE `recipe` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`latest_revision` integer NOT NULL,
	`source` text,
	`source_key` text,
	`trashed_at` integer,
	`purge_at` integer,
	`total_minutes` integer,
	`has_flow` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recipe_source_key_unique` ON `recipe` (`source_key`);--> statement-breakpoint
CREATE INDEX `recipe_purge_at` ON `recipe` (`purge_at`);--> statement-breakpoint
CREATE TABLE `recipe_item` (
	`recipe_id` text NOT NULL,
	`item_key` text NOT NULL,
	PRIMARY KEY(`recipe_id`, `item_key`)
);
--> statement-breakpoint
CREATE INDEX `recipe_item_item_key` ON `recipe_item` (`item_key`);--> statement-breakpoint
CREATE TABLE `recipe_tag` (
	`recipe_id` text NOT NULL,
	`tag_id` integer NOT NULL,
	PRIMARY KEY(`recipe_id`, `tag_id`)
);
--> statement-breakpoint
CREATE INDEX `recipe_tag_tag_id` ON `recipe_tag` (`tag_id`);--> statement-breakpoint
CREATE TABLE `retry` (
	`connection` text NOT NULL,
	`tool` text NOT NULL,
	`args_hash` text NOT NULL,
	`result` text NOT NULL,
	`expires_at` integer NOT NULL,
	PRIMARY KEY(`connection`, `tool`, `args_hash`)
);
--> statement-breakpoint
CREATE TABLE `revision` (
	`recipe_id` text NOT NULL,
	`revision` integer NOT NULL,
	`content` text NOT NULL,
	`was` text NOT NULL,
	`by` text NOT NULL,
	`at` integer NOT NULL,
	`change_seq` integer NOT NULL,
	PRIMARY KEY(`recipe_id`, `revision`)
);
--> statement-breakpoint
CREATE TABLE `smart_collection` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`name_key` text NOT NULL,
	`filter` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `smart_collection_name_key_unique` ON `smart_collection` (`name_key`);--> statement-breakpoint
CREATE TABLE `tag` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`name_key` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tag_name_key_unique` ON `tag` (`name_key`);