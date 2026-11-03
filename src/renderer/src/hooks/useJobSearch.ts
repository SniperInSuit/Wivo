/**
 * Job search against the DATABASE, not the jobs loaded on screen (see
 * lib/jobSearch). Three small queries, each capped: the exact code however the
 * dashes were typed, codes containing the query, patient names containing it.
 * RLS answers each the same way it answers the board: own organisation, not
 * deleted, only what this person may read.
 *
 * No index: a few thousand rows per organisation scan in milliseconds, and
 * every query is limited.
 */
import { useEffect, useState } from 'react'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { Job } from '../types/job'
import {
  SEARCH_LIMIT, containsPattern, jobCodeCandidates, partialCodePattern, rankSearchResults,
} from '../lib/jobSearch'

export async function searchJobs(query: string): Promise<Job[]> {
  const q = query.trim()
  if (!q) return []
  const jobs = () => supabase.from('jobs').select('*').is('deleted_at', null).limit(SEARCH_LIMIT)
  const codes = jobCodeCandidates(q)
  const answers = await Promise.all([
    codes.length > 0 ? jobs().in('job_code', codes) : null,
    jobs().ilike('job_code', partialCodePattern(q)).order('created_at', { ascending: false }),
    jobs().ilike('patsient', containsPattern(q)).order('created_at', { ascending: false }),
  ])
  const found: Job[] = []
  for (const a of answers) {
    if (!a) continue
    if (a.error) throw a.error
    found.push(...((a.data ?? []) as Job[]))
  }
  return rankSearchResults(found, q)
}

/** The ranked results for what is being typed, a moment after typing stops. */
export function useJobSearch(query: string, delayMs = 250) {
  const [settled, setSettled] = useState(query.trim())
  useEffect(() => {
    const id = setTimeout(() => setSettled(query.trim()), delayMs)
    return () => clearTimeout(id)
  }, [query, delayMs])
  return useQuery<Job[]>({
    queryKey: ['job_search', settled],
    enabled: settled.length >= 2,
    queryFn: () => searchJobs(settled),
    placeholderData: keepPreviousData,
    staleTime: 10_000,
  })
}

/** One job by id, for a search result that is not among the jobs loaded. */
export function useJobById(id: string | null, enabled: boolean) {
  return useQuery<Job | null>({
    queryKey: ['job_by_id', id],
    enabled: enabled && !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from('jobs').select('*').eq('id', id!).is('deleted_at', null).maybeSingle()
      if (error) throw error
      return (data ?? null) as Job | null
    },
  })
}
