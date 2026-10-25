-- account rule 7: one invitation, one account, 14 days. Times are epoch milliseconds.
create table "invitation" (
  "id" text not null primary key,
  "token_hash" text not null unique,
  "name" text not null,
  "email" text not null,
  "created_at" integer not null,
  "expires_at" integer not null,
  "used_at" integer,
  "user_id" text references "user" ("id") on delete set null
);
