import { createClient } from '@supabase/supabase-js'
import type { Database } from '../types/database'
import { validateSupabaseConfig } from './supabaseConfig'

const { url, key } = validateSupabaseConfig(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
)

// Kết nối Supabase
export const supabase = createClient<Database>(url, key)

export const supabaseUrl = url
export const supabaseKey = key
