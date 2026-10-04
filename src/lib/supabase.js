import { createClient } from '@supabase/supabase-js'

const supabaseUrl =
  import.meta.env.VITE_SUPABASE_URL || 'https://flfcoxkgyuvotpulyuup.supabase.co'
const supabaseAnonKey =
  import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_RreT8NJkX_q_P-90WynwCg_f3IIkICz'

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { persistSession: true },
})