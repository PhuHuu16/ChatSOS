// Hand-written to match supabase/migrations as of commit 8adde43, in the shape that
// `supabase gen types` produces. Unlike generated types, Row / Insert / Update list only
// what the authenticated role is GRANTed (verified in step 1B), so the compiler rejects
// reads and writes the database would refuse: RLS filters rows, it does not hide columns.
// `never` marks an operation clients have no privilege for. Keep in sync with the migrations.
import type { ConversationType, MessageKind } from '../features/chat/types'

export type ConversationRole = 'owner' | 'member'

export type Database = {
  public: {
    Tables: {
      profiles: {
        // created_at and phone exist but are not granted to authenticated (phone is
        // only matched by find_profile_by_phone, never returned).
        Row: {
          id: string
          username: string
          display_name: string
          avatar_path: string | null
        }
        // Created only by the on_auth_user_created trigger.
        Insert: never
        Update: {
          display_name?: string
          avatar_path?: string | null
        }
        Relationships: []
      }
      conversations: {
        Row: {
          id: string
          type: ConversationType
          title: string | null
          direct_key: string | null
          created_by: string | null
          created_at: string
          last_message_at: string | null
        }
        // Created only through the create_*_conversation RPCs.
        Insert: never
        Update: never
        Relationships: []
      }
      conversation_members: {
        Row: {
          conversation_id: string
          user_id: string
          role: ConversationRole
          joined_at: string
          last_read_at: string | null
        }
        Insert: never
        Update: {
          last_read_at?: string | null
        }
        Relationships: []
      }
      messages: {
        Row: {
          id: string
          conversation_id: string
          sender_id: string
          kind: MessageKind
          content: string
          attachment_path: string | null
          attachment_name: string | null
          attachment_size: number | null
          attachment_mime: string | null
          created_at: string
          edited_at: string | null
          deleted_at: string | null
        }
        // sender_id and created_at are not granted: they always take their defaults.
        Insert: {
          id?: string
          conversation_id: string
          kind: MessageKind
          content?: string
          attachment_path?: string | null
          attachment_name?: string | null
          attachment_size?: number | null
          attachment_mime?: string | null
        }
        // Only these are granted; the messages_guard_update trigger sets the rest.
        Update: {
          content?: string
          deleted_at?: string | null
        }
        Relationships: []
      }
      message_hides: {
        Row: {
          user_id: string
          message_id: string
          hidden_at: string
        }
        // user_id and hidden_at are not granted: they always take their defaults.
        Insert: {
          message_id: string
        }
        // Hiding is final: no UPDATE or DELETE privilege.
        Update: never
        Relationships: []
      }
      conversation_clears: {
        Row: {
          user_id: string
          conversation_id: string
          cleared_at: string
        }
        // Read only: rows are written by clear_conversation().
        Insert: never
        Update: never
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      create_direct_conversation: {
        Args: { p_other_user_id: string }
        Returns: string
      }
      create_group_conversation: {
        Args: { p_title: string; p_member_ids: string[] }
        Returns: string
      }
      clear_conversation: {
        Args: { p_conversation_id: string }
        Returns: string
      }
      find_profile_by_phone: {
        Args: { p_phone: string }
        Returns: {
          id: string
          username: string
          display_name: string
          avatar_path: string | null
        }[]
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
