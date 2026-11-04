import type { ConversationType, MessageKind, SystemEvent } from '../features/chat/types'

export type ConversationRole = 'owner' | 'member'

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          username: string
          display_name: string
          avatar_path: string | null
        }
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
          system_event: SystemEvent | null
          system_target_id: string | null
        }
        Insert: {
          id?: string
          conversation_id: string
          kind: Exclude<MessageKind, 'system'>
          content?: string
          attachment_path?: string | null
          attachment_name?: string | null
          attachment_size?: number | null
          attachment_mime?: string | null
        }
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
        Insert: {
          message_id: string
        }
        Update: never
        Relationships: []
      }
      conversation_clears: {
        Row: {
          user_id: string
          conversation_id: string
          cleared_at: string
        }
        Insert: never
        Update: never
        Relationships: []
      }
      conversation_removals: {
        Row: {
          user_id: string
          conversation_id: string
          removed_at: string
        }
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
      rename_group: {
        Args: { p_conversation_id: string; p_title: string }
        Returns: undefined
      }
      add_group_members: {
        Args: { p_conversation_id: string; p_user_ids: string[] }
        Returns: number
      }
      remove_group_member: {
        Args: { p_conversation_id: string; p_user_id: string }
        Returns: undefined
      }
      transfer_group_ownership: {
        Args: { p_conversation_id: string; p_user_id: string }
        Returns: undefined
      }
      leave_group: {
        Args: { p_conversation_id: string }
        Returns: undefined
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
