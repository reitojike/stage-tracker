export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      catalog_creators: {
        Row: {
          created_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          user_id?: string
        }
        Relationships: []
      }
      event_groups: {
        Row: {
          created_at: string
          event_id: string
          group_id: string
        }
        Insert: {
          created_at?: string
          event_id: string
          group_id: string
        }
        Update: {
          created_at?: string
          event_id?: string
          group_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_groups_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_groups_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
        ]
      }
      event_occurrences: {
        Row: {
          canceled_at: string | null
          created_at: string
          doors_at: string | null
          ends_at: string | null
          event_id: string
          id: string
          starts_at: string
          updated_at: string
        }
        Insert: {
          canceled_at?: string | null
          created_at?: string
          doors_at?: string | null
          ends_at?: string | null
          event_id: string
          id?: string
          starts_at: string
          updated_at?: string
        }
        Update: {
          canceled_at?: string | null
          created_at?: string
          doors_at?: string | null
          ends_at?: string | null
          event_id?: string
          id?: string
          starts_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_occurrences_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          canceled_at: string | null
          created_at: string
          ends_on: string
          genre_id: string | null
          id: string
          memo: string | null
          owner_id: string
          source_key: string | null
          source_url: string | null
          starts_on: string
          title: string
          updated_at: string
          venue: string | null
        }
        Insert: {
          canceled_at?: string | null
          created_at?: string
          ends_on: string
          genre_id?: string | null
          id?: string
          memo?: string | null
          owner_id: string
          source_key?: string | null
          source_url?: string | null
          starts_on: string
          title: string
          updated_at?: string
          venue?: string | null
        }
        Update: {
          canceled_at?: string | null
          created_at?: string
          ends_on?: string
          genre_id?: string | null
          id?: string
          memo?: string | null
          owner_id?: string
          source_key?: string | null
          source_url?: string | null
          starts_on?: string
          title?: string
          updated_at?: string
          venue?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "events_genre_id_fkey"
            columns: ["genre_id"]
            isOneToOne: false
            referencedRelation: "genres"
            referencedColumns: ["id"]
          },
        ]
      }
      genres: {
        Row: {
          created_at: string
          display_name: string
          id: string
          key: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name: string
          id?: string
          key: string
          sort_order: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string
          id?: string
          key?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      groups: {
        Row: {
          created_at: string
          display_name: string
          id: string
          key: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name: string
          id?: string
          key: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string
          id?: string
          key?: string
          updated_at?: string
        }
        Relationships: []
      }
      occurrence_invitations: {
        Row: {
          created_at: string
          declined_at: string | null
          id: string
          invitee_id: string
          inviter_id: string
          occurrence_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          declined_at?: string | null
          id?: string
          invitee_id: string
          inviter_id: string
          occurrence_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          declined_at?: string | null
          id?: string
          invitee_id?: string
          inviter_id?: string
          occurrence_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "occurrence_invitations_occurrence_id_fkey"
            columns: ["occurrence_id"]
            isOneToOne: false
            referencedRelation: "event_occurrences"
            referencedColumns: ["id"]
          },
        ]
      }
      occurrence_participations: {
        Row: {
          created_at: string
          id: string
          occurrence_id: string
          status: Database["public"]["Enums"]["participation_status"]
          updated_at: string
          user_id: string
          visibility: Database["public"]["Enums"]["participation_visibility"]
        }
        Insert: {
          created_at?: string
          id?: string
          occurrence_id: string
          status: Database["public"]["Enums"]["participation_status"]
          updated_at?: string
          user_id: string
          visibility?: Database["public"]["Enums"]["participation_visibility"]
        }
        Update: {
          created_at?: string
          id?: string
          occurrence_id?: string
          status?: Database["public"]["Enums"]["participation_status"]
          updated_at?: string
          user_id?: string
          visibility?: Database["public"]["Enums"]["participation_visibility"]
        }
        Relationships: [
          {
            foreignKeyName: "occurrence_participations_occurrence_id_fkey"
            columns: ["occurrence_id"]
            isOneToOne: false
            referencedRelation: "event_occurrences"
            referencedColumns: ["id"]
          },
        ]
      }
      personal_schedule_entries: {
        Row: {
          blocking: boolean
          created_at: string
          ends_at: string | null
          ends_on: string | null
          id: string
          is_all_day: boolean
          memo: string | null
          owner_id: string
          starts_at: string | null
          starts_on: string | null
          title: string
          updated_at: string
        }
        Insert: {
          blocking: boolean
          created_at?: string
          ends_at?: string | null
          ends_on?: string | null
          id?: string
          is_all_day: boolean
          memo?: string | null
          owner_id: string
          starts_at?: string | null
          starts_on?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          blocking?: boolean
          created_at?: string
          ends_at?: string | null
          ends_on?: string | null
          id?: string
          is_all_day?: boolean
          memo?: string | null
          owner_id?: string
          starts_at?: string | null
          starts_on?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      personal_schedule_shares: {
        Row: {
          created_at: string
          id: string
          schedule_entry_id: string
          shared_with_user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          schedule_entry_id: string
          shared_with_user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          schedule_entry_id?: string
          shared_with_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "personal_schedule_shares_schedule_entry_id_fkey"
            columns: ["schedule_entry_id"]
            isOneToOne: false
            referencedRelation: "personal_schedule_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      ticket_opportunities: {
        Row: {
          created_at: string
          display_name: string
          event_id: string
          id: string
          memo: string | null
          source_key: string
          source_url: string | null
          target_scope: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name: string
          event_id: string
          id?: string
          memo?: string | null
          source_key: string
          source_url?: string | null
          target_scope: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string
          event_id?: string
          id?: string
          memo?: string | null
          source_key?: string
          source_url?: string | null
          target_scope?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ticket_opportunities_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      ticket_opportunity_milestones: {
        Row: {
          at: string | null
          created_at: string
          date_value: string | null
          ends_at: string | null
          id: string
          milestone_type: string
          opportunity_id: string
          starts_at: string | null
          temporal_precision: string
          updated_at: string
        }
        Insert: {
          at?: string | null
          created_at?: string
          date_value?: string | null
          ends_at?: string | null
          id?: string
          milestone_type: string
          opportunity_id: string
          starts_at?: string | null
          temporal_precision: string
          updated_at?: string
        }
        Update: {
          at?: string | null
          created_at?: string
          date_value?: string | null
          ends_at?: string | null
          id?: string
          milestone_type?: string
          opportunity_id?: string
          starts_at?: string | null
          temporal_precision?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ticket_opportunity_milestones_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "ticket_opportunities"
            referencedColumns: ["id"]
          },
        ]
      }
      ticket_opportunity_target_occurrences: {
        Row: {
          created_at: string
          occurrence_id: string
          opportunity_id: string
        }
        Insert: {
          created_at?: string
          occurrence_id: string
          opportunity_id: string
        }
        Update: {
          created_at?: string
          occurrence_id?: string
          opportunity_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ticket_opportunity_target_occurrences_occurrence_id_fkey"
            columns: ["occurrence_id"]
            isOneToOne: false
            referencedRelation: "event_occurrences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ticket_opportunity_target_occurrences_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "ticket_opportunities"
            referencedColumns: ["id"]
          },
        ]
      }
      user_ticket_opportunity_states: {
        Row: {
          created_at: string
          id: string
          opportunity_id: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          opportunity_id: string
          status: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          opportunity_id?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_ticket_opportunity_states_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "ticket_opportunities"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      create_event: {
        Args: {
          p_doors_at?: string
          p_ends_at?: string
          p_ends_on: string
          p_memo?: string
          p_source_url?: string
          p_starts_at?: string
          p_starts_on: string
          p_title: string
          p_venue?: string
        }
        Returns: {
          canceled_at: string | null
          created_at: string
          ends_on: string
          genre_id: string | null
          id: string
          memo: string | null
          owner_id: string
          source_key: string | null
          source_url: string | null
          starts_on: string
          title: string
          updated_at: string
          venue: string | null
        }
        SetofOptions: {
          from: "*"
          to: "events"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      decline_occurrence_invitation: {
        Args: { p_invitation_id: string }
        Returns: {
          created_at: string
          declined_at: string | null
          id: string
          invitee_id: string
          inviter_id: string
          occurrence_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "occurrence_invitations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      delete_event: { Args: { p_event_id: string }; Returns: undefined }
      delete_event_occurrence: {
        Args: { p_occurrence_id: string }
        Returns: undefined
      }
      event_occurrence_is_effectively_canceled: {
        Args: { p_occurrence_id: string }
        Returns: boolean
      }
      import_event_classification: {
        Args: {
          p_event_id: string
          p_genre_key?: string
          p_groups?: Json
          p_set_genre?: boolean
          p_set_groups?: boolean
        }
        Returns: {
          canceled_at: string | null
          created_at: string
          ends_on: string
          genre_id: string | null
          id: string
          memo: string | null
          owner_id: string
          source_key: string | null
          source_url: string | null
          starts_on: string
          title: string
          updated_at: string
          venue: string | null
        }
        SetofOptions: {
          from: "*"
          to: "events"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      import_event_with_occurrences: {
        Args: {
          p_ends_on: string
          p_memo?: string
          p_occurrences: Json
          p_owner_id: string
          p_source_key: string
          p_source_url?: string
          p_starts_on: string
          p_title: string
          p_venue?: string
        }
        Returns: {
          canceled_at: string | null
          created_at: string
          ends_on: string
          genre_id: string | null
          id: string
          memo: string | null
          owner_id: string
          source_key: string | null
          source_url: string | null
          starts_on: string
          title: string
          updated_at: string
          venue: string | null
        }
        SetofOptions: {
          from: "*"
          to: "events"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      import_ticket_opportunity: {
        Args: {
          p_display_name: string
          p_event_id: string
          p_memo?: string
          p_milestones?: Json
          p_occurrence_ids?: string[]
          p_source_key: string
          p_source_url?: string
          p_target_scope: string
        }
        Returns: {
          created_at: string
          display_name: string
          event_id: string
          id: string
          memo: string | null
          source_key: string
          source_url: string | null
          target_scope: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "ticket_opportunities"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      import_update_event: {
        Args: {
          p_ends_on: string
          p_event_id: string
          p_memo?: string
          p_new_occurrences?: Json
          p_occurrence_fixes?: Json
          p_source_url?: string
          p_starts_on: string
          p_title: string
          p_venue?: string
        }
        Returns: {
          canceled_at: string | null
          created_at: string
          ends_on: string
          genre_id: string | null
          id: string
          memo: string | null
          owner_id: string
          source_key: string | null
          source_url: string | null
          starts_on: string
          title: string
          updated_at: string
          venue: string | null
        }
        SetofOptions: {
          from: "*"
          to: "events"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      invite_to_occurrence: {
        Args: { p_invitee_id: string; p_occurrence_id: string }
        Returns: undefined
      }
      invite_to_occurrence_by_email: {
        Args: { p_invitee_email: string; p_occurrence_id: string }
        Returns: undefined
      }
      is_personal_schedule_entry_owner: {
        Args: { p_entry_id: string }
        Returns: boolean
      }
      list_schedule_share_recipient_emails: {
        Args: { p_schedule_entry_id: string }
        Returns: {
          recipient_email: string
          share_id: string
          shared_at: string
        }[]
      }
      reschedule_event: {
        Args: {
          p_ends_on: string
          p_event_id: string
          p_occurrences?: Json
          p_starts_on: string
        }
        Returns: {
          canceled_at: string | null
          created_at: string
          doors_at: string | null
          ends_at: string | null
          event_id: string
          id: string
          starts_at: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "event_occurrences"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      share_schedule_entry_by_email: {
        Args: { p_recipient_email: string; p_schedule_entry_id: string }
        Returns: {
          created_at: string
          id: string
          schedule_entry_id: string
          shared_with_user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "personal_schedule_shares"
          isOneToOne: true
          isSetofReturn: false
        }
      }
    }
    Enums: {
      participation_status: "considering" | "attending"
      participation_visibility: "private" | "public"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

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
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      participation_status: ["considering", "attending"],
      participation_visibility: ["private", "public"],
    },
  },
} as const
