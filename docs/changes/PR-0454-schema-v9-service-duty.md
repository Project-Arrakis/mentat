# PR Change Summary — Schema v9 (service duty/apply tables)

Lands only the schema from draft #384 on `main` so it matches production's
already-v9 database (mentat#438). Later migrations start at v10.

- `SCHEMA_VERSION` 8 -> 9; tables `service_channels`, `service_duty_status`,
  `service_applications` (partial UNIQUE index); `guild_settings.on_duty_role_id`.
- The v8 -> v9 `ALTER TABLE` now ignores only "duplicate column name" and rethrows
  any other error, so a failed ALTER can no longer leave the database marked v9.
- Tests build a true v8 shape (column and tables dropped) and cover the UNIQUE index.
- Operator action: none for a database already at v9.
- Not included: buttons, handlers, `/dune admin service-setup` (draft #384).
