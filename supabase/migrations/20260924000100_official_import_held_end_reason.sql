-- Issue #634: distinguish an official end disappearing from an unreadable page.
-- Migration ordering: additive. Existing readers keep receiving only the
-- original reason until a later runtime change starts publishing the new one.
alter table public.official_import_held_pages
  drop constraint official_import_held_pages_reason_code_check;

alter table public.official_import_held_pages
  add constraint official_import_held_pages_reason_code_check
  check (reason_code in ('source_parse', 'published_end_missing'));
