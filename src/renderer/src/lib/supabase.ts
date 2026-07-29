import { createClient } from '@supabase/supabase-js'
import type { Job } from '../types/job'

// Read from .env — never hardcode these values
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing Supabase env vars. Copy .env.example → .env and fill in your project URL and anon key.'
  )
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// Typed table reference for IDE completion
export type JobRow = Job
