/**
 * Keeps the clinic-owned half of Seaded in step with the database.
 *
 * Renders nothing. Mounted once, inside the authenticated tree, where the
 * clinic id is known.
 *
 * Order of events on start-up:
 *   1. read the clinic's row
 *   2. no row yet → seed it from whatever THIS machine has configured, so an
 *      existing lab's prices and work types move up to the server instead of
 *      being replaced by defaults
 *   3. row exists → it wins over the local copy, and localStorage becomes a
 *      cache for the next cold start
 *   4. subscribe to realtime so a price changed on the owner's machine reaches
 *      the other workstations without a restart
 *
 * If any of this fails — table not migrated yet, offline, no clinic — the app
 * keeps running on the local copy. That is the whole reason the store still
 * writes to localStorage first and treats the push as a side effect.
 */
import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import {
  applyClinicRow, clinicSliceOf, setClinicPusher, getSettingsSnapshot
} from '../stores/useSettings'
import { applyRemoteStages, getStages, setStagePusher } from '../context/PipelineContext'
import {
  fetchClinicSettings, seedClinicSettings, pushClinicSettings,
  subscribeClinicSettings, type ClinicPatch, type ClinicSettingsRow
} from '../lib/clinicSettings'

export type SyncState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'synced'; at: string | null }
  | { status: 'local'; reason: string }

const listeners = new Set<(s: SyncState) => void>()
let current: SyncState = { status: 'idle' }

function emit(next: SyncState) {
  current = next
  listeners.forEach(fn => fn(next))
}

/** Lets Seaded show whether it is editing shared settings or just this machine. */
export function useClinicSyncState(): SyncState {
  const [state, setState] = useState<SyncState>(current)
  useEffect(() => {
    listeners.add(setState)
    setState(current)
    return () => { listeners.delete(setState) }
  }, [])
  return state
}

export function ClinicSettingsSync(): null {
  // Keyed on the PROFILE's clinic_id, not on the fetched clinic object: if the
  // clinic row fails to load (RLS, network, a deleted row) the id is still
  // valid, and settings must keep syncing rather than silently falling back to
  // this machine's local copy.
  const { clinicId, role, status } = useAuth()
  // Writes are queued and flushed together: dragging a price spinner fires a
  // setter per keystroke, and one round-trip per keystroke would both hammer
  // the table and let responses land out of order.
  const pending = useRef<ClinicPatch>({})
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Ignore the realtime echo of our own write, which would otherwise overwrite
  // whatever the user typed in the meantime with the value we just sent.
  const selfWriteUntil = useRef(0)

  useEffect(() => {
    if (status !== 'authenticated' || !clinicId) {
      setClinicPusher(null)
      setStagePusher(null)
      emit({ status: 'idle' })
      return
    }

    let cancelled = false
    emit({ status: 'loading' })

    const flush = async () => {
      timer.current = null
      const patch = pending.current
      pending.current = {}
      if (Object.keys(patch).length === 0) return
      selfWriteUntil.current = Date.now() + 2000
      try {
        await pushClinicSettings(clinicId, patch)
        emit({ status: 'synced', at: new Date().toISOString() })
      } catch (err) {
        // Owner-only update policy, offline, or the table is missing. The local
        // copy already holds the change, so the user is not blocked — but the
        // UI must not claim the clinic is in sync when it is not.
        emit({ status: 'local', reason: (err as Error)?.message ?? 'salvestamine ebaõnnestus' })
      }
    }

    const queue = (patch: ClinicPatch) => {
      Object.assign(pending.current, patch)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(flush, 400)
    }

    // Workers never write clinic settings — the RLS policy would reject it, and
    // queuing a doomed request just to show an error is worse than not offering
    // it. The UI gates the same way (settings.read / owner).
    const canWrite = role === 'owner'

    ;(async () => {
      try {
        let row = await fetchClinicSettings(clinicId)
        if (cancelled) return

        if (!row) {
          if (!canWrite) {
            // A worker on a clinic whose owner has not opened the app since the
            // migration. Keep the local copy rather than seeding a row the
            // policy will not accept.
            emit({ status: 'local', reason: 'kliiniku seadeid pole veel serverisse salvestatud' })
          } else {
            row = await seedClinicSettings(clinicId, {
              ...clinicSliceOf(getSettingsSnapshot()),
              pipeline_stages: getStages(),
            })
          }
        }
        if (cancelled) return

        if (row) {
          applyClinicRow(row)
          if (row.pipeline_stages?.length) applyRemoteStages(row.pipeline_stages)
          emit({ status: 'synced', at: row.updated_at ?? null })
        }

        if (canWrite) {
          setClinicPusher(queue)
          setStagePusher(stages => queue({ pipeline_stages: stages }))
        }
      } catch (err) {
        if (!cancelled) {
          emit({ status: 'local', reason: (err as Error)?.message ?? 'ühendus puudub' })
        }
      }
    })()

    const unsubscribe = subscribeClinicSettings(clinicId, (row: ClinicSettingsRow) => {
      if (Date.now() < selfWriteUntil.current) return
      applyClinicRow(row)
      if (row.pipeline_stages?.length) applyRemoteStages(row.pipeline_stages)
      emit({ status: 'synced', at: row.updated_at ?? null })
    })

    return () => {
      cancelled = true
      if (timer.current) clearTimeout(timer.current)
      setClinicPusher(null)
      setStagePusher(null)
      unsubscribe()
    }
  }, [clinicId, role, status])

  return null
}
