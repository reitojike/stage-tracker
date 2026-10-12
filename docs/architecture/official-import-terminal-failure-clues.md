# Official import terminal failure clues

Issue [#761](https://github.com/reitojike/stage-tracker/issues/761), under
[#634](https://github.com/reitojike/stage-tracker/issues/634), adds three nullable
scalars to an existing failed run: phase, bounded reason, and safe official URL.
The existing classification and finished timestamp remain authoritative.

The original four-argument failure RPC is unchanged. A seven-argument overload
has no defaults and performs the same source/status/token/lease gate and terminal
UPDATE. Optional values are normalized after that gate and written in the same
UPDATE. Invalid phase/reason combinations are discarded; unsupported URLs become
NULL. No diagnostic request, wait, lease renewal, retry or acquisition is added.
Transient release/retry behavior remains unchanged and has no durable clue.

Both signatures remain service-role-only, SECURITY INVOKER with an empty search
path. Existing creator SELECT RLS and client write restrictions apply. A narrow
run guard permits non-null clues only on the owned failure transition, using the
existing trusted service-role/attempt scope. It does not defend against trusted
service-role SQL deliberately forging that scope. Terminal runs and clues remain
immutable, and existing claimed/terminal deletion guards are unchanged.

URLs are limited to source-specific official page shapes for Kabuki/Shochiku and
the two main Takarazuka theaters. Runtime validation also checks the source
registry and removes query/fragment; credentials, encoded/free-form paths and
foreign origins are excluded. Publication failures have no individual-page
attribution. There is no raw content, exception text, image, item ID, ownership
token, generic JSON, candidate count, coverage claim or transient-attempt history.

## Deployment and rollback gate

Schema and runtime remain separate Drafts to satisfy the artifact sequencing
fence. Apply the schema through the authorized migration path, refresh/verify the
PostgREST schema cache, and exercise both four-key and seven-key requests before
activating the new runtime. Old workers remain compatible and leave clues NULL.
The new caller must not be activated against an unapplied schema. No schema probe
or optimistic seven-key failure followed by a four-key retry is permitted: that
extra wait would reintroduce the lease-expiry defect. Retarget/reconcile runtime
to main and repeat exact-head checks/review after schema merge.

Runtime rollback leaves the three nullable fields/overload harmless. No down
migration or historical-data removal is supplied. This task does not authorize
merge, production migration/activation, candidate approval/application, partial
success, weekly cadence restoration or Takarazuka scheduling.

The guarantee concerns ingestion semantics: the same ownership gate and terminal
transition with bounded optional fields. It excludes arbitrary process stops,
transaction/transport failures and identical wall-clock timing. Server-late
execution still uses the authoritative gate; committed terminal replay does not
acquire sources again. Existing cancellation/lost-response behavior is retained.
