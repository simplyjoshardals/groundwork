export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: {
        Args: { extensions?: Json; operationName?: string; query?: string; variables?: Json };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      app_config: {
        Row: {
          description: string;
          key: string;
          updated_at: string;
          value: number;
        };
        ComputedFields: never;
        Insert: {
          description: string;
          key: string;
          updated_at?: string;
          value: number;
        };
        Update: {
          description?: string;
          key?: string;
          updated_at?: string;
          value?: number;
        };
        Relationships: [];
      };
      chunks: {
        Row: {
          char_end: number;
          char_start: number;
          chunk_index: number;
          content: string;
          created_at: string;
          document_id: string;
          embedding: string;
          embedding_model: string;
          id: number;
          is_public: boolean;
          owner_id: string | null;
          page_number: number;
          token_count: number | null;
        };
        ComputedFields: never;
        Insert: {
          char_end: number;
          char_start: number;
          chunk_index: number;
          content: string;
          created_at?: string;
          document_id: string;
          embedding: string;
          embedding_model: string;
          id?: never;
          is_public?: boolean;
          owner_id?: string | null;
          page_number: number;
          token_count?: number | null;
        };
        Update: {
          char_end?: number;
          char_start?: number;
          chunk_index?: number;
          content?: string;
          created_at?: string;
          document_id?: string;
          embedding?: string;
          embedding_model?: string;
          id?: never;
          is_public?: boolean;
          owner_id?: string | null;
          page_number?: number;
          token_count?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "chunks_document_id_fkey";
            columns: ["document_id"];
            isOneToOne: false;
            referencedRelation: "documents";
            referencedColumns: ["id"];
          },
        ];
      };
      documents: {
        Row: {
          chunk_count: number;
          created_at: string;
          embedding_model: string | null;
          error_reason: string | null;
          id: string;
          is_public: boolean;
          mime_type: string;
          original_filename: string;
          owner_id: string | null;
          page_count: number | null;
          pipeline_version: number;
          processing_started_at: string | null;
          size_bytes: number;
          status: string;
          storage_path: string;
          title: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          chunk_count?: number;
          created_at?: string;
          embedding_model?: string | null;
          error_reason?: string | null;
          id?: string;
          is_public?: boolean;
          mime_type: string;
          original_filename: string;
          owner_id?: string | null;
          page_count?: number | null;
          pipeline_version?: number;
          processing_started_at?: string | null;
          size_bytes: number;
          status?: string;
          storage_path: string;
          title: string;
          updated_at?: string;
        };
        Update: {
          chunk_count?: number;
          created_at?: string;
          embedding_model?: string | null;
          error_reason?: string | null;
          id?: string;
          is_public?: boolean;
          mime_type?: string;
          original_filename?: string;
          owner_id?: string | null;
          page_count?: number | null;
          pipeline_version?: number;
          processing_started_at?: string | null;
          size_bytes?: number;
          status?: string;
          storage_path?: string;
          title?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      storage_deletions: {
        Row: {
          attempts: number;
          bucket: string;
          created_at: string;
          id: number;
          last_error: string | null;
          path: string;
          processed_at: string | null;
        };
        ComputedFields: never;
        Insert: {
          attempts?: number;
          bucket?: string;
          created_at?: string;
          id?: never;
          last_error?: string | null;
          path: string;
          processed_at?: string | null;
        };
        Update: {
          attempts?: number;
          bucket?: string;
          created_at?: string;
          id?: never;
          last_error?: string | null;
          path?: string;
          processed_at?: string | null;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      claim_document_for_ingest: { Args: { p_document_id: string }; Returns: boolean };
      fail_ingestion: { Args: { p_document_id: string; p_reason: string }; Returns: undefined };
      finalize_ingestion: {
        Args: {
          p_document_id: string;
          p_embedding_model: string;
          p_page_count: number;
          p_pipeline_version?: number;
        };
        Returns: undefined;
      };
      match_chunks: {
        Args: {
          match_count?: number;
          p_document_id?: string;
          p_embedding_model: string;
          query_embedding: string;
        };
        Returns: {
          char_end: number;
          char_start: number;
          chunk_id: number;
          content: string;
          doc_id: string;
          doc_title: string;
          page_number: number;
          similarity: number;
        }[];
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const;
