export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      active_subscriptions: {
        Row: {
          created_at: string
          devices: number
          expiry: string
          id: string
          package: string
          phone: string
          price: number
          source: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          devices?: number
          expiry: string
          id?: string
          package: string
          phone: string
          price?: number
          source?: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          devices?: number
          expiry?: string
          id?: string
          package?: string
          phone?: string
          price?: number
          source?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "active_subscriptions_phone_fkey"
            columns: ["phone"]
            isOneToOne: false
            referencedRelation: "prepaid_accounts"
            referencedColumns: ["phone"]
          },
        ]
      }
      admin_account: {
        Row: {
          created_at: string
          id: number
          iterations: number
          password_hash: string
          password_salt: string
          session_version: number
          updated_at: string
          username: string
        }
        Insert: {
          created_at?: string
          id?: number
          iterations: number
          password_hash: string
          password_salt: string
          session_version?: number
          updated_at?: string
          username: string
        }
        Update: {
          created_at?: string
          id?: number
          iterations?: number
          password_hash?: string
          password_salt?: string
          session_version?: number
          updated_at?: string
          username?: string
        }
        Relationships: []
      }
      admin_login_attempts: {
        Row: {
          created_at: string
          id: string
          ip: string
          success: boolean
        }
        Insert: {
          created_at?: string
          id?: string
          ip: string
          success?: boolean
        }
        Update: {
          created_at?: string
          id?: string
          ip?: string
          success?: boolean
        }
        Relationships: []
      }
      blocked_macs: {
        Row: {
          created_at: string
          mac: string
          reason: string | null
        }
        Insert: {
          created_at?: string
          mac: string
          reason?: string | null
        }
        Update: {
          created_at?: string
          mac?: string
          reason?: string | null
        }
        Relationships: []
      }
      free_wifi_claims: {
        Row: {
          created_at: string
          day: string
          mac: string
          phone: string
        }
        Insert: {
          created_at?: string
          day: string
          mac: string
          phone: string
        }
        Update: {
          created_at?: string
          day?: string
          mac?: string
          phone?: string
        }
        Relationships: []
      }
      phone_otps: {
        Row: {
          attempts: number
          code_hash: string
          expires_at: string
          last_sent_at: string
          phone: string
          sends_in_window: number
          window_start: string
        }
        Insert: {
          attempts?: number
          code_hash: string
          expires_at: string
          last_sent_at?: string
          phone: string
          sends_in_window?: number
          window_start?: string
        }
        Update: {
          attempts?: number
          code_hash?: string
          expires_at?: string
          last_sent_at?: string
          phone?: string
          sends_in_window?: number
          window_start?: string
        }
        Relationships: []
      }
      prepaid_accounts: {
        Row: {
          created_at: string
          credit: number
          name: string | null
          net_points: number
          phone: string
          session_version: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          credit?: number
          name?: string | null
          net_points?: number
          phone: string
          session_version?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          credit?: number
          name?: string | null
          net_points?: number
          phone?: string
          session_version?: number
          updated_at?: string
        }
        Relationships: []
      }
      subscription_devices: {
        Row: {
          created_at: string
          mac: string
          subscription_id: string
        }
        Insert: {
          created_at?: string
          mac: string
          subscription_id: string
        }
        Update: {
          created_at?: string
          mac?: string
          subscription_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscription_devices_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "active_subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      transactions: {
        Row: {
          amount: number
          callback_token: string
          checkout_request_id: string | null
          created_at: string
          id: string
          is_mock: boolean
          last_query_at: string | null
          mac: string
          merchant_request_id: string | null
          mpesa_code: string | null
          package: string
          phone: string
          purpose: string
          result_desc: string | null
          status: string
          updated_at: string
        }
        Insert: {
          amount: number
          callback_token: string
          checkout_request_id?: string | null
          created_at?: string
          id?: string
          is_mock?: boolean
          last_query_at?: string | null
          mac: string
          merchant_request_id?: string | null
          mpesa_code?: string | null
          package: string
          phone: string
          purpose?: string
          result_desc?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          amount?: number
          callback_token?: string
          checkout_request_id?: string | null
          created_at?: string
          id?: string
          is_mock?: boolean
          last_query_at?: string | null
          mac?: string
          merchant_request_id?: string | null
          mpesa_code?: string | null
          package?: string
          phone?: string
          purpose?: string
          result_desc?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      users: {
        Row: {
          created_at: string
          expiry: string
          id: string
          mac: string
          package: string
          phone: string | null
          source: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          expiry: string
          id?: string
          mac: string
          package: string
          phone?: string | null
          source?: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          expiry?: string
          id?: string
          mac?: string
          package?: string
          phone?: string | null
          source?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      vouchers: {
        Row: {
          batch: string | null
          code: string
          created_at: string
          id: string
          package: string
          used: boolean
          used_at: string | null
          used_by_mac: string | null
        }
        Insert: {
          batch?: string | null
          code: string
          created_at?: string
          id?: string
          package: string
          used?: boolean
          used_at?: string | null
          used_by_mac?: string | null
        }
        Update: {
          batch?: string | null
          code?: string
          created_at?: string
          id?: string
          package?: string
          used?: boolean
          used_at?: string | null
          used_by_mac?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      add_credit: { Args: { _amount: number; _phone: string }; Returns: number }
      spend_credit: {
        Args: { _amount: number; _phone: string }
        Returns: number
      }
    }
    Enums: {
      [_ in never]: never
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
