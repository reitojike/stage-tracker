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
      event_occurrences: {
        Row: {
          created_at: string
          doors_at: string | null
          ends_at: string | null
          event_id: string
          id: string
          starts_at: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          doors_at?: string | null
          ends_at?: string | null
          event_id: string
          id?: string
          starts_at: string
          updated_at?: string
        }
        Update: {
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
          created_at: string
          ends_on: string
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
          created_at?: string
          ends_on: string
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
          created_at?: string
          ends_on?: string
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
      ticket_acquisitions: {
        Row: {
          created_at: string
          id: string
          memo: string | null
          occurrence_id: string
          owner_id: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          memo?: string | null
          occurrence_id: string
          owner_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          memo?: string | null
          occurrence_id?: string
          owner_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ticket_acquisitions_occurrence_id_fkey"
            columns: ["occurrence_id"]
            isOneToOne: false
            referencedRelation: "event_occurrences"
            referencedColumns: ["id"]
          },
        ]
      }
      ticket_transfers: {
        Row: {
          created_at: string
          id: string
          recipient_id: string
          responded_at: string | null
          sender_id: string
          status: string
          ticket_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          recipient_id: string
          responded_at?: string | null
          sender_id: string
          status?: string
          ticket_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          recipient_id?: string
          responded_at?: string | null
          sender_id?: string
          status?: string
          ticket_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ticket_transfers_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      tickets: {
        Row: {
          acquisition_id: string
          assigned_to_user_id: string | null
          assignee_external_name: string | null
          created_at: string
          id: string
          medium: string | null
          owner_id: string
          queue_number: string | null
          seat_label: string | null
          updated_at: string
        }
        Insert: {
          acquisition_id: string
          assigned_to_user_id?: string | null
          assignee_external_name?: string | null
          created_at?: string
          id?: string
          medium?: string | null
          owner_id: string
          queue_number?: string | null
          seat_label?: string | null
          updated_at?: string
        }
        Update: {
          acquisition_id?: string
          assigned_to_user_id?: string | null
          assignee_external_name?: string | null
          created_at?: string
          id?: string
          medium?: string | null
          owner_id?: string
          queue_number?: string | null
          seat_label?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tickets_acquisition_id_fkey"
            columns: ["acquisition_id"]
            isOneToOne: false
            referencedRelation: "ticket_acquisitions"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_ticket_transfer: {
        Args: { p_transfer_id: string }
        Returns: {
          created_at: string
          id: string
          recipient_id: string
          responded_at: string | null
          sender_id: string
          status: string
          ticket_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "ticket_transfers"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      can_view_ticket_provenance: {
        Args: { p_ticket_id: string }
        Returns: boolean
      }
      cancel_ticket_transfer: {
        Args: { p_transfer_id: string }
        Returns: {
          created_at: string
          id: string
          recipient_id: string
          responded_at: string | null
          sender_id: string
          status: string
          ticket_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "ticket_transfers"
          isOneToOne: true
          isSetofReturn: false
        }
      }
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
          created_at: string
          ends_on: string
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
          created_at: string
          ends_on: string
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
          created_at: string
          ends_on: string
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
      pending_ticket_transfer_offer: {
        Args: { p_transfer_id: string }
        Returns: {
          medium: string
          occurrence_id: string
          queue_number: string
          seat_label: string
          ticket_id: string
          transfer_id: string
        }[]
      }
      request_ticket_transfer: {
        Args: { p_recipient_id: string; p_ticket_id: string }
        Returns: {
          created_at: string
          id: string
          recipient_id: string
          responded_at: string | null
          sender_id: string
          status: string
          ticket_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "ticket_transfers"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      reschedule_event: {
        Args: {
          p_ends_on: string
          p_event_id: string
          p_occurrences?: Json
          p_starts_on: string
        }
        Returns: {
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
      ticket_transfer_recipient_is_eligible: {
        Args: { p_occurrence_id: string; p_recipient_id: string }
        Returns: boolean
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

