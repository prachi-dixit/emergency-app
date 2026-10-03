import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://flfcoxkgyuvotpulyuup.supabase.co'
const supabaseAnonKey = 'sb_publishable_RreT8NJkX_q_P-90WynwCg_f3IIkICz'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)