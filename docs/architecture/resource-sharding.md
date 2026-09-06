# Resource-sharded D1 layout

## Why this layout

The early normalized-size projection exceeded one D1 database. The published D1 limit is 10 GB per database and D1 is intended to scale horizontally across smaller databases. We therefore retain raw CSV versions in R2, keep one control database for catalog/coverage/indexes, and place normalized rows for one source resource in one deterministic data shard.

`resourceId -> FNV-1a -> DATA_SHARD_00..15`

All versions of a resource route to the same shard. A resource is never split between shards, making row ledger checks, rebuilds from R2 and source lineage local and repeatable.

## Data ownership

| Store | Owns |
| --- | --- |
| Control D1 | source catalog, coverage, raw-capture manifests, shard registry, global aggregate/index records and data-gate evidence |
| Data shard D1 | source-resource mirror, sync run, raw record, project, contract, supplier, award, matches, review decisions and ingestion errors for routed resources |
| R2 | immutable byte chunks and source manifests |

## Safe migration sequence

1. Pause only single-D1 normalization; keep raw R2 capture running. This repository uses `.bit-gov-shard-migration-required` as that explicit guard.
2. Provision 16 empty D1 data shards and apply all migrations to each.
3. Add the control/shard bindings and route write/read operations; write a compact global index to control D1.
4. Rehydrate each completed raw capture from R2 into its routed shard. Check the row ledger and aggregate index after each resource.
5. Query filtered project pages from eligible shards with bounded fan-out; source detail and review writes route by `project_id` prefix/index. Build central market/company aggregates incrementally instead of scanning every shard for every dashboard load.
6. Measure every shard after representative resources. If any approaches 8 GB, increase the shard count before continuing; changing the modulus after writes would change routes, so use an explicit registry override rather than changing the function.

## Non-goals for the first migration commit

This document and routing module do not claim the cross-shard API has shipped. They establish the durable routing contract and stop the old single D1 from growing while the control/index and cross-shard write path are implemented.

## Staging evidence — 2026-09-06

Sixteen APAC staging D1 shards (`DATA_SHARD_00` through `DATA_SHARD_15`) were provisioned and migrated through `0006_source_version_and_shard_registry.sql`. The ingestion staging Worker was redeployed with all shard bindings and `SHARDING_ENABLED=1`.

The first rehydrated FY2568 CSV routed to `DATA_SHARD_05`; its first observed shard batch recorded 2,200 source/accepted rows and 1,916 projects. The control database retained zero normalized rows for that in-progress run, as intended: it receives the accounting summary only when the shard's complete row ledger passes. This is an ingestion-path check, not a data-completeness claim.
