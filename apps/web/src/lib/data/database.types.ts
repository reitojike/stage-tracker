
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {

  "public": {
          Tables: {
            "catalog_creators": {
                  Row: {
                    "created_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"user_id"?: string
                  }
                  Relationships: [

                  ]
                },"event_groups": {
                  Row: {
                    "created_at": string,"event_id": string,"group_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"event_id": string,"group_id": string
                  }
                  Update: {
                    "created_at"?: string,"event_id"?: string,"group_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "event_groups_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "events"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "event_groups_group_id_fkey"
      columns: ["group_id"]
isOneToOne: false
      referencedRelation: "groups"
      referencedColumns: ["id"]
    }
                  ]
                },"event_occurrences": {
                  Row: {
                    "canceled_at": string | null,"created_at": string,"doors_at": string | null,"ends_at": string | null,"event_id": string,"id": string,"starts_at": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "canceled_at"?: string | null,"created_at"?: string,"doors_at"?: string | null,"ends_at"?: string | null,"event_id": string,"id"?: string,"starts_at": string,"updated_at"?: string
                  }
                  Update: {
                    "canceled_at"?: string | null,"created_at"?: string,"doors_at"?: string | null,"ends_at"?: string | null,"event_id"?: string,"id"?: string,"starts_at"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "event_occurrences_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "events"
      referencedColumns: ["id"]
    }
                  ]
                },"events": {
                  Row: {
                    "canceled_at": string | null,"created_at": string,"ends_on": string,"genre_id": string | null,"id": string,"memo": string | null,"owner_id": string,"source_key": string | null,"source_url": string | null,"starts_on": string,"title": string,"updated_at": string,"venue": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "canceled_at"?: string | null,"created_at"?: string,"ends_on": string,"genre_id"?: string | null,"id"?: string,"memo"?: string | null,"owner_id": string,"source_key"?: string | null,"source_url"?: string | null,"starts_on": string,"title": string,"updated_at"?: string,"venue"?: string | null
                  }
                  Update: {
                    "canceled_at"?: string | null,"created_at"?: string,"ends_on"?: string,"genre_id"?: string | null,"id"?: string,"memo"?: string | null,"owner_id"?: string,"source_key"?: string | null,"source_url"?: string | null,"starts_on"?: string,"title"?: string,"updated_at"?: string,"venue"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "events_genre_id_fkey"
      columns: ["genre_id"]
isOneToOne: false
      referencedRelation: "genres"
      referencedColumns: ["id"]
    }
                  ]
                },"genres": {
                  Row: {
                    "created_at": string,"display_name": string,"id": string,"key": string,"sort_order": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"display_name": string,"id"?: string,"key": string,"sort_order": number,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"display_name"?: string,"id"?: string,"key"?: string,"sort_order"?: number,"updated_at"?: string
                  }
                  Relationships: [

                  ]
                },"groups": {
                  Row: {
                    "created_at": string,"display_name": string,"id": string,"key": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"display_name": string,"id"?: string,"key": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"display_name"?: string,"id"?: string,"key"?: string,"updated_at"?: string
                  }
                  Relationships: [

                  ]
                },"notifications": {
                  Row: {
                    "created_at": string,"id": string,"kind": Database["public"]['Enums']["notification_kind"],"read_at": string | null,"recipient_id": string,"source_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"kind": Database["public"]['Enums']["notification_kind"],"read_at"?: string | null,"recipient_id": string,"source_id": string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"kind"?: Database["public"]['Enums']["notification_kind"],"read_at"?: string | null,"recipient_id"?: string,"source_id"?: string
                  }
                  Relationships: [

                  ]
                },"occurrence_invitations": {
                  Row: {
                    "created_at": string,"id": string,"invitee_id": string,"inviter_id": string,"occurrence_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"invitee_id": string,"inviter_id": string,"occurrence_id": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"invitee_id"?: string,"inviter_id"?: string,"occurrence_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "occurrence_invitations_occurrence_id_fkey"
      columns: ["occurrence_id"]
isOneToOne: false
      referencedRelation: "event_occurrences"
      referencedColumns: ["id"]
    }
                  ]
                },"occurrence_participations": {
                  Row: {
                    "created_at": string,"id": string,"occurrence_id": string,"status": Database["public"]['Enums']["participation_status"],"updated_at": string,"user_id": string,"visibility": Database["public"]['Enums']["participation_visibility"]
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"occurrence_id": string,"status": Database["public"]['Enums']["participation_status"],"updated_at"?: string,"user_id": string,"visibility"?: Database["public"]['Enums']["participation_visibility"]
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"occurrence_id"?: string,"status"?: Database["public"]['Enums']["participation_status"],"updated_at"?: string,"user_id"?: string,"visibility"?: Database["public"]['Enums']["participation_visibility"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "occurrence_participations_occurrence_id_fkey"
      columns: ["occurrence_id"]
isOneToOne: false
      referencedRelation: "event_occurrences"
      referencedColumns: ["id"]
    }
                  ]
                },"official_import_candidates": {
                  Row: {
                    "active_apply_attempt_token": string | null,"active_apply_lease_expires_at": string | null,"applied_at": string | null,"apply_status": string,"candidate_kind": string,"canonical_url": string,"content_hash": string,"created_at": string,"deterministic_match_status": string,"dismissed_at": string | null,"dismissed_by": string | null,"etag": string | null,"evidence_locator": NonNullable<Json>,"failure_classification": string | null,"id": string,"jev_decision_evidence": Json | null,"last_modified": string | null,"observed_at": string,"official_external_id": string | null,"plan_fingerprint": string,"plan_summary": NonNullable<Json>,"proposal": NonNullable<Json>,"proposal_version": string,"recovery_hold_run_id": string | null,"recovery_review_required": boolean,"resolved_event_id": string | null,"resolved_ticket_opportunity_id": string | null,"review_status": string,"reviewed_at": string | null,"reviewer": string | null,"run_id": string,"semantic_match_status": string,"source_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "active_apply_attempt_token"?: string | null,"active_apply_lease_expires_at"?: string | null,"applied_at"?: string | null,"apply_status"?: string,"candidate_kind": string,"canonical_url": string,"content_hash": string,"created_at"?: string,"deterministic_match_status"?: string,"dismissed_at"?: string | null,"dismissed_by"?: string | null,"etag"?: string | null,"evidence_locator"?: NonNullable<Json>,"failure_classification"?: string | null,"id"?: string,"jev_decision_evidence"?: Json | null,"last_modified"?: string | null,"observed_at"?: string,"official_external_id"?: string | null,"plan_fingerprint": string,"plan_summary"?: NonNullable<Json>,"proposal": NonNullable<Json>,"proposal_version": string,"recovery_hold_run_id"?: string | null,"recovery_review_required"?: boolean,"resolved_event_id"?: string | null,"resolved_ticket_opportunity_id"?: string | null,"review_status"?: string,"reviewed_at"?: string | null,"reviewer"?: string | null,"run_id": string,"semantic_match_status"?: string,"source_id": string,"updated_at"?: string
                  }
                  Update: {
                    "active_apply_attempt_token"?: string | null,"active_apply_lease_expires_at"?: string | null,"applied_at"?: string | null,"apply_status"?: string,"candidate_kind"?: string,"canonical_url"?: string,"content_hash"?: string,"created_at"?: string,"deterministic_match_status"?: string,"dismissed_at"?: string | null,"dismissed_by"?: string | null,"etag"?: string | null,"evidence_locator"?: NonNullable<Json>,"failure_classification"?: string | null,"id"?: string,"jev_decision_evidence"?: Json | null,"last_modified"?: string | null,"observed_at"?: string,"official_external_id"?: string | null,"plan_fingerprint"?: string,"plan_summary"?: NonNullable<Json>,"proposal"?: NonNullable<Json>,"proposal_version"?: string,"recovery_hold_run_id"?: string | null,"recovery_review_required"?: boolean,"resolved_event_id"?: string | null,"resolved_ticket_opportunity_id"?: string | null,"review_status"?: string,"reviewed_at"?: string | null,"reviewer"?: string | null,"run_id"?: string,"semantic_match_status"?: string,"source_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "official_import_candidates_recovery_hold_run_id_fkey"
      columns: ["recovery_hold_run_id"]
isOneToOne: false
      referencedRelation: "official_import_runs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "official_import_candidates_resolved_event_id_fkey"
      columns: ["resolved_event_id"]
isOneToOne: false
      referencedRelation: "events"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "official_import_candidates_resolved_ticket_opportunity_id_fkey"
      columns: ["resolved_ticket_opportunity_id"]
isOneToOne: false
      referencedRelation: "ticket_opportunities"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "official_import_candidates_run_id_fkey"
      columns: ["run_id"]
isOneToOne: false
      referencedRelation: "official_import_runs"
      referencedColumns: ["id"]
    }
                  ]
                },"official_import_held_pages": {
                  Row: {
                    "canonical_url": string,"ends_on": string,"official_external_id": string,"reason_code": string,"reported_at": string,"run_id": string,"source_id": string,"starts_on": string,"title": string
                  }
                  ComputedFields: never
                  Insert: {
                    "canonical_url": string,"ends_on": string,"official_external_id": string,"reason_code": string,"reported_at"?: string,"run_id": string,"source_id": string,"starts_on": string,"title": string
                  }
                  Update: {
                    "canonical_url"?: string,"ends_on"?: string,"official_external_id"?: string,"reason_code"?: string,"reported_at"?: string,"run_id"?: string,"source_id"?: string,"starts_on"?: string,"title"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "official_import_held_pages_run_id_fkey"
      columns: ["run_id"]
isOneToOne: false
      referencedRelation: "official_import_runs"
      referencedColumns: ["id"]
    }
                  ]
                },"official_import_runs": {
                  Row: {
                    "active_attempt_lease_expires_at": string | null,"active_attempt_token": string | null,"created_at": string,"failure_classification": string | null,"failure_phase": string | null,"failure_reason": string | null,"failure_url": string | null,"finished_at": string | null,"id": string,"publication_ordinal": number | null,"source_id": string,"started_at": string,"status": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "active_attempt_lease_expires_at"?: string | null,"active_attempt_token"?: string | null,"created_at"?: string,"failure_classification"?: string | null,"failure_phase"?: string | null,"failure_reason"?: string | null,"failure_url"?: string | null,"finished_at"?: string | null,"id"?: string,"publication_ordinal"?: number | null,"source_id": string,"started_at"?: string,"status"?: string,"updated_at"?: string
                  }
                  Update: {
                    "active_attempt_lease_expires_at"?: string | null,"active_attempt_token"?: string | null,"created_at"?: string,"failure_classification"?: string | null,"failure_phase"?: string | null,"failure_reason"?: string | null,"failure_url"?: string | null,"finished_at"?: string | null,"id"?: string,"publication_ordinal"?: number | null,"source_id"?: string,"started_at"?: string,"status"?: string,"updated_at"?: string
                  }
                  Relationships: [

                  ]
                },"official_import_ticket_event_bindings": {
                  Row: {
                    "candidate_id": string,"created_at": string,"event_id": string,"event_source_key": string | null,"reviewer": string,"source_id": string,"ticket_source_key": string
                  }
                  ComputedFields: never
                  Insert: {
                    "candidate_id": string,"created_at"?: string,"event_id": string,"event_source_key"?: string | null,"reviewer": string,"source_id": string,"ticket_source_key": string
                  }
                  Update: {
                    "candidate_id"?: string,"created_at"?: string,"event_id"?: string,"event_source_key"?: string | null,"reviewer"?: string,"source_id"?: string,"ticket_source_key"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "official_import_ticket_event_bindings_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "events"
      referencedColumns: ["id"]
    }
                  ]
                },"personal_schedule_entries": {
                  Row: {
                    "blocking": boolean,"created_at": string,"ends_at": string | null,"ends_on": string | null,"id": string,"is_all_day": boolean,"memo": string | null,"owner_id": string,"starts_at": string | null,"starts_on": string | null,"title": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "blocking": boolean,"created_at"?: string,"ends_at"?: string | null,"ends_on"?: string | null,"id"?: string,"is_all_day": boolean,"memo"?: string | null,"owner_id": string,"starts_at"?: string | null,"starts_on"?: string | null,"title": string,"updated_at"?: string
                  }
                  Update: {
                    "blocking"?: boolean,"created_at"?: string,"ends_at"?: string | null,"ends_on"?: string | null,"id"?: string,"is_all_day"?: boolean,"memo"?: string | null,"owner_id"?: string,"starts_at"?: string | null,"starts_on"?: string | null,"title"?: string,"updated_at"?: string
                  }
                  Relationships: [

                  ]
                },"personal_schedule_shares": {
                  Row: {
                    "contact_id": string | null,"created_at": string,"id": string,"schedule_entry_id": string,"shared_with_user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "contact_id"?: string | null,"created_at"?: string,"id"?: string,"schedule_entry_id": string,"shared_with_user_id": string
                  }
                  Update: {
                    "contact_id"?: string | null,"created_at"?: string,"id"?: string,"schedule_entry_id"?: string,"shared_with_user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "personal_schedule_shares_contact_id_fkey"
      columns: ["contact_id"]
isOneToOne: false
      referencedRelation: "schedule_contacts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "personal_schedule_shares_schedule_entry_id_fkey"
      columns: ["schedule_entry_id"]
isOneToOne: false
      referencedRelation: "personal_schedule_entries"
      referencedColumns: ["id"]
    }
                  ]
                },"schedule_contact_aliases": {
                  Row: {
                    "alias": string,"contact_id": string,"owner_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "alias": string,"contact_id": string,"owner_id": string
                  }
                  Update: {
                    "alias"?: string,"contact_id"?: string,"owner_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "schedule_contact_aliases_contact_id_fkey"
      columns: ["contact_id"]
isOneToOne: false
      referencedRelation: "schedule_contacts"
      referencedColumns: ["id"]
    }
                  ]
                },"schedule_contact_requests": {
                  Row: {
                    "created_at": string,"id": string,"recipient_id": string,"requested_email": string,"requester_id": string,"user_high_id": string | null,"user_low_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"recipient_id": string,"requested_email": string,"requester_id": string,"user_high_id"?: never,"user_low_id"?: never
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"recipient_id"?: string,"requested_email"?: string,"requester_id"?: string,"user_high_id"?: never,"user_low_id"?: never
                  }
                  Relationships: [

                  ]
                },"schedule_contacts": {
                  Row: {
                    "created_at": string,"id": string,"user_high_id": string,"user_low_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"user_high_id": string,"user_low_id": string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"user_high_id"?: string,"user_low_id"?: string
                  }
                  Relationships: [

                  ]
                },"ticket_opportunities": {
                  Row: {
                    "created_at": string,"display_name": string,"event_id": string,"id": string,"memo": string | null,"source_key": string,"source_url": string | null,"target_scope": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"display_name": string,"event_id": string,"id"?: string,"memo"?: string | null,"source_key": string,"source_url"?: string | null,"target_scope": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"display_name"?: string,"event_id"?: string,"id"?: string,"memo"?: string | null,"source_key"?: string,"source_url"?: string | null,"target_scope"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "ticket_opportunities_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "events"
      referencedColumns: ["id"]
    }
                  ]
                },"ticket_opportunity_milestones": {
                  Row: {
                    "at": string | null,"created_at": string,"date_value": string | null,"ends_at": string | null,"id": string,"milestone_type": string,"opportunity_id": string,"starts_at": string | null,"temporal_precision": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "at"?: string | null,"created_at"?: string,"date_value"?: string | null,"ends_at"?: string | null,"id"?: string,"milestone_type": string,"opportunity_id": string,"starts_at"?: string | null,"temporal_precision": string,"updated_at"?: string
                  }
                  Update: {
                    "at"?: string | null,"created_at"?: string,"date_value"?: string | null,"ends_at"?: string | null,"id"?: string,"milestone_type"?: string,"opportunity_id"?: string,"starts_at"?: string | null,"temporal_precision"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "ticket_opportunity_milestones_opportunity_id_fkey"
      columns: ["opportunity_id"]
isOneToOne: false
      referencedRelation: "ticket_opportunities"
      referencedColumns: ["id"]
    }
                  ]
                },"ticket_opportunity_target_occurrences": {
                  Row: {
                    "created_at": string,"occurrence_id": string,"opportunity_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"occurrence_id": string,"opportunity_id": string
                  }
                  Update: {
                    "created_at"?: string,"occurrence_id"?: string,"opportunity_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "ticket_opportunity_target_occurrences_occurrence_id_fkey"
      columns: ["occurrence_id"]
isOneToOne: false
      referencedRelation: "event_occurrences"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ticket_opportunity_target_occurrences_opportunity_id_fkey"
      columns: ["opportunity_id"]
isOneToOne: false
      referencedRelation: "ticket_opportunities"
      referencedColumns: ["id"]
    }
                  ]
                },"user_ticket_opportunity_states": {
                  Row: {
                    "created_at": string,"id": string,"opportunity_id": string,"status": string,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"opportunity_id": string,"status": string,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"opportunity_id"?: string,"status"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "user_ticket_opportunity_states_opportunity_id_fkey"
      columns: ["opportunity_id"]
isOneToOne: false
      referencedRelation: "ticket_opportunities"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "accept_schedule_contact_request":
{ Args: { "p_request_id": string }; Returns: undefined
                           },
"apply_import_event_plan":
{ Args: { "p_action": string,"p_ends_on": string,"p_event_id": string,"p_genre_key": string,"p_groups": Json,"p_memo": string,"p_occurrence_fixes": Json,"p_occurrences": Json,"p_owner_id": string,"p_set_genre": boolean,"p_set_groups": boolean,"p_source_key": string,"p_source_url": string,"p_starts_on": string,"p_title": string,"p_venue": string }; Returns: {
              "canceled_at": string | null,
"created_at": string,
"ends_on": string,
"genre_id": string | null,
"id": string,
"memo": string | null,
"owner_id": string,
"source_key": string | null,
"source_url": string | null,
"starts_on": string,
"title": string,
"updated_at": string,
"venue": string | null
            }
                          SetofOptions: {
        from: "*"
        to: "events"
        isOneToOne: true
        isSetofReturn: false
      } },
"apply_official_import_kabuki_event_candidate":
{ Args: { "p_action": string,"p_attempt_token": string,"p_candidate_id": string,"p_ends_on": string,"p_event_id": string,"p_expected_current": Json,"p_expected_proposed_groups": Json,"p_genre_key": string,"p_groups": Json,"p_memo": string,"p_occurrence_fixes": Json,"p_occurrences": Json,"p_owner_id": string,"p_set_genre": boolean,"p_set_groups": boolean,"p_source_key": string,"p_source_url": string,"p_starts_on": string,"p_title": string,"p_venue": string }; Returns: string
                           },
"apply_reviewed_import_event_plan":
{ Args: { "p_action": string,"p_ends_on": string,"p_event_id": string,"p_expected_current": Json,"p_expected_proposed_groups"?: Json,"p_genre_key": string,"p_groups": Json,"p_memo": string,"p_occurrence_fixes": Json,"p_occurrences": Json,"p_owner_id": string,"p_set_genre": boolean,"p_set_groups": boolean,"p_source_key": string,"p_source_url": string,"p_starts_on": string,"p_title": string,"p_venue": string }; Returns: {
              "canceled_at": string | null,
"created_at": string,
"ends_on": string,
"genre_id": string | null,
"id": string,
"memo": string | null,
"owner_id": string,
"source_key": string | null,
"source_url": string | null,
"starts_on": string,
"title": string,
"updated_at": string,
"venue": string | null
            }
                          SetofOptions: {
        from: "*"
        to: "events"
        isOneToOne: true
        isSetofReturn: false
      } },
"apply_reviewed_ticket_opportunity":
{ Args: { "p_action": string,"p_display_name": string,"p_event_id": string,"p_expected_current": Json,"p_memo": string,"p_milestones": Json,"p_occurrence_ids": (string)[],"p_source_key": string,"p_source_url": string,"p_target_scope": string }; Returns: {
              "created_at": string,
"display_name": string,
"event_id": string,
"id": string,
"memo": string | null,
"source_key": string,
"source_url": string | null,
"target_scope": string,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "ticket_opportunities"
        isOneToOne: true
        isSetofReturn: false
      } },
"bind_official_import_ticket_candidate":
{ Args: { "p_candidate_id": string,"p_event_id": string }; Returns: {
              "active_apply_attempt_token": string | null,
"active_apply_lease_expires_at": string | null,
"applied_at": string | null,
"apply_status": string,
"candidate_kind": string,
"canonical_url": string,
"content_hash": string,
"created_at": string,
"deterministic_match_status": string,
"dismissed_at": string | null,
"dismissed_by": string | null,
"etag": string | null,
"evidence_locator": NonNullable<Json>,
"failure_classification": string | null,
"id": string,
"jev_decision_evidence": Json | null,
"last_modified": string | null,
"observed_at": string,
"official_external_id": string | null,
"plan_fingerprint": string,
"plan_summary": NonNullable<Json>,
"proposal": NonNullable<Json>,
"proposal_version": string,
"recovery_hold_run_id": string | null,
"recovery_review_required": boolean,
"resolved_event_id": string | null,
"resolved_ticket_opportunity_id": string | null,
"review_status": string,
"reviewed_at": string | null,
"reviewer": string | null,
"run_id": string,
"semantic_match_status": string,
"source_id": string,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "official_import_candidates"
        isOneToOne: true
        isSetofReturn: false
      } },
"cancel_schedule_contact_request_by_email":
{ Args: { "p_recipient_email": string }; Returns: undefined
                           },
"claim_official_import_candidate_apply":
{ Args: { "p_attempt_token": string,"p_candidate_id": string,"p_lease_seconds": number }; Returns: string
                           },
"claim_official_import_run_attempt":
{ Args: { "p_attempt_token": string,"p_lease_seconds": number,"p_run_id": string,"p_source_id": string }; Returns: string
                           },
"commit_official_import_candidate_batch":
{ Args: { "p_candidates": Json,"p_run_id": string,"p_source_id": string }; Returns: number
                           },
"commit_owned_official_import_candidate_batch":
{ Args: { "p_attempt_token": string,"p_candidates": Json,"p_run_id": string,"p_source_id": string }; Returns: number
                           },
"commit_owned_official_import_partial_batch":
{ Args: { "p_attempt_token": string,"p_candidates": Json,"p_held_pages": Json,"p_run_id": string,"p_source_id": string }; Returns: number
                           },
"complete_official_import_candidate_apply":
{ Args: { "p_attempt_token": string,"p_candidate_id": string }; Returns: string
                           },
"create_event":
{ Args: { "p_doors_at"?: string,"p_ends_at"?: string,"p_ends_on": string,"p_memo"?: string,"p_source_url"?: string,"p_starts_at"?: string,"p_starts_on": string,"p_title": string,"p_venue"?: string }; Returns: {
              "canceled_at": string | null,
"created_at": string,
"ends_on": string,
"genre_id": string | null,
"id": string,
"memo": string | null,
"owner_id": string,
"source_key": string | null,
"source_url": string | null,
"starts_on": string,
"title": string,
"updated_at": string,
"venue": string | null
            }
                          SetofOptions: {
        from: "*"
        to: "events"
        isOneToOne: true
        isSetofReturn: false
      } },
"decline_occurrence_invitation":
{ Args: { "p_invitation_id": string }; Returns: {
              "created_at": string,
"id": string,
"invitee_id": string,
"inviter_id": string,
"occurrence_id": string,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "occurrence_invitations"
        isOneToOne: true
        isSetofReturn: false
      } },
"decline_schedule_contact_request":
{ Args: { "p_request_id": string }; Returns: undefined
                           },
"delete_event":
{ Args: { "p_event_id": string }; Returns: undefined
                           },
"delete_event_occurrence":
{ Args: { "p_occurrence_id": string }; Returns: undefined
                           },
"dismiss_failed_official_import_candidate":
{ Args: { "p_candidate_id": string }; Returns: boolean
                           },
"event_occurrence_is_effectively_canceled":
{ Args: { "p_occurrence_id": string }; Returns: boolean
                           },
"fail_official_import_candidate_apply":
{ Args: { "p_attempt_token": string,"p_candidate_id": string,"p_failure_classification": string }; Returns: string
                           },
"fail_official_import_run_attempt":
{ Args: { "p_attempt_token": string,"p_failure_classification": string,"p_run_id": string,"p_source_id": string }; Returns: string
                           } |
{ Args: { "p_attempt_token": string,"p_failure_classification": string,"p_failure_phase": string,"p_failure_reason": string,"p_failure_url": string,"p_run_id": string,"p_source_id": string }; Returns: string
                           },
"import_event_classification":
{ Args: { "p_event_id": string,"p_genre_key"?: string,"p_groups"?: Json,"p_set_genre"?: boolean,"p_set_groups"?: boolean }; Returns: {
              "canceled_at": string | null,
"created_at": string,
"ends_on": string,
"genre_id": string | null,
"id": string,
"memo": string | null,
"owner_id": string,
"source_key": string | null,
"source_url": string | null,
"starts_on": string,
"title": string,
"updated_at": string,
"venue": string | null
            }
                          SetofOptions: {
        from: "*"
        to: "events"
        isOneToOne: true
        isSetofReturn: false
      } },
"import_event_with_occurrences":
{ Args: { "p_ends_on": string,"p_memo"?: string,"p_occurrences": Json,"p_owner_id": string,"p_source_key": string,"p_source_url"?: string,"p_starts_on": string,"p_title": string,"p_venue"?: string }; Returns: {
              "canceled_at": string | null,
"created_at": string,
"ends_on": string,
"genre_id": string | null,
"id": string,
"memo": string | null,
"owner_id": string,
"source_key": string | null,
"source_url": string | null,
"starts_on": string,
"title": string,
"updated_at": string,
"venue": string | null
            }
                          SetofOptions: {
        from: "*"
        to: "events"
        isOneToOne: true
        isSetofReturn: false
      } },
"import_ticket_opportunity":
{ Args: { "p_display_name": string,"p_event_id": string,"p_memo"?: string,"p_milestones"?: Json,"p_occurrence_ids"?: (string)[],"p_source_key": string,"p_source_url"?: string,"p_target_scope": string }; Returns: {
              "created_at": string,
"display_name": string,
"event_id": string,
"id": string,
"memo": string | null,
"source_key": string,
"source_url": string | null,
"target_scope": string,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "ticket_opportunities"
        isOneToOne: true
        isSetofReturn: false
      } },
"import_update_event":
{ Args: { "p_ends_on": string,"p_event_id": string,"p_memo"?: string,"p_new_occurrences"?: Json,"p_occurrence_fixes"?: Json,"p_source_url"?: string,"p_starts_on": string,"p_title": string,"p_venue"?: string }; Returns: {
              "canceled_at": string | null,
"created_at": string,
"ends_on": string,
"genre_id": string | null,
"id": string,
"memo": string | null,
"owner_id": string,
"source_key": string | null,
"source_url": string | null,
"starts_on": string,
"title": string,
"updated_at": string,
"venue": string | null
            }
                          SetofOptions: {
        from: "*"
        to: "events"
        isOneToOne: true
        isSetofReturn: false
      } },
"invite_to_occurrence":
{ Args: { "p_invitee_id": string,"p_occurrence_id": string }; Returns: undefined
                           },
"invite_to_occurrence_by_email":
{ Args: { "p_invitee_email": string,"p_occurrence_id": string }; Returns: undefined
                           },
"is_personal_schedule_entry_owner":
{ Args: { "p_entry_id": string }; Returns: boolean
                           },
"list_received_schedule_contact_requests":
{ Args: Record<PropertyKey, never>; Returns: {
              "request_id": string,"requested_at": string,"requester_email": string
            }[]
                           },
"list_schedule_contacts":
{ Args: Record<PropertyKey, never>; Returns: {
              "accepted_at": string,"contact_id": string,"counterpart_email": string,"own_alias": string
            }[]
                           },
"list_schedule_share_recipient_emails":
{ Args: { "p_schedule_entry_id": string }; Returns: {
              "recipient_email": string,"share_id": string,"shared_at": string
            }[]
                           },
"mark_notification_read":
{ Args: { "p_notification_id": string }; Returns: {
              "created_at": string,
"id": string,
"kind": Database["public"]['Enums']["notification_kind"],
"read_at": string | null,
"recipient_id": string,
"source_id": string
            }
                          SetofOptions: {
        from: "*"
        to: "notifications"
        isOneToOne: true
        isSetofReturn: false
      } },
"release_official_import_run_attempt":
{ Args: { "p_attempt_token": string,"p_run_id": string,"p_source_id": string }; Returns: string
                           },
"request_schedule_contact_by_email":
{ Args: { "p_recipient_email": string }; Returns: undefined
                           },
"reschedule_event":
{ Args: { "p_ends_on": string,"p_event_id": string,"p_occurrences"?: Json,"p_starts_on": string }; Returns: {
              "canceled_at": string | null,
"created_at": string,
"doors_at": string | null,
"ends_at": string | null,
"event_id": string,
"id": string,
"starts_at": string,
"updated_at": string
            }[]
                          SetofOptions: {
        from: "*"
        to: "event_occurrences"
        isOneToOne: false
        isSetofReturn: true
      } },
"review_official_import_candidate":
{ Args: { "p_candidate_id": string,"p_review_status": string }; Returns: {
              "active_apply_attempt_token": string | null,
"active_apply_lease_expires_at": string | null,
"applied_at": string | null,
"apply_status": string,
"candidate_kind": string,
"canonical_url": string,
"content_hash": string,
"created_at": string,
"deterministic_match_status": string,
"dismissed_at": string | null,
"dismissed_by": string | null,
"etag": string | null,
"evidence_locator": NonNullable<Json>,
"failure_classification": string | null,
"id": string,
"jev_decision_evidence": Json | null,
"last_modified": string | null,
"observed_at": string,
"official_external_id": string | null,
"plan_fingerprint": string,
"plan_summary": NonNullable<Json>,
"proposal": NonNullable<Json>,
"proposal_version": string,
"recovery_hold_run_id": string | null,
"recovery_review_required": boolean,
"resolved_event_id": string | null,
"resolved_ticket_opportunity_id": string | null,
"review_status": string,
"reviewed_at": string | null,
"reviewer": string | null,
"run_id": string,
"semantic_match_status": string,
"source_id": string,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "official_import_candidates"
        isOneToOne: true
        isSetofReturn: false
      } },
"schedule_contact_registration_enabled":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"set_schedule_contact_alias":
{ Args: { "p_alias": string,"p_contact_id": string }; Returns: undefined
                           },
"share_schedule_entry_by_email":
{ Args: { "p_recipient_email": string,"p_schedule_entry_id": string }; Returns: {
              "contact_id": string | null,
"created_at": string,
"id": string,
"schedule_entry_id": string,
"shared_with_user_id": string
            }
                          SetofOptions: {
        from: "*"
        to: "personal_schedule_shares"
        isOneToOne: true
        isSetofReturn: false
      } },
"share_schedule_entry_with_contact":
{ Args: { "p_contact_id": string,"p_schedule_entry_id": string }; Returns: {
              "contact_id": string | null,
"created_at": string,
"id": string,
"schedule_entry_id": string,
"shared_with_user_id": string
            }
                          SetofOptions: {
        from: "*"
        to: "personal_schedule_shares"
        isOneToOne: true
        isSetofReturn: false
      } },
"unlink_schedule_contact":
{ Args: { "p_contact_id": string }; Returns: undefined
                           }
          }
          Enums: {
            "notification_kind": "invitation_received","participation_status": "considering"|"attending","participation_visibility": "private"|"public"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "public": {
          Enums: {
            "notification_kind": ["invitation_received"],"participation_status": ["considering", "attending"],"participation_visibility": ["private", "public"]
          }
        }
} as const
