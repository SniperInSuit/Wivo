// Top-level views. NOTE: 'settings' is deliberately NOT a member — Seaded is a
// panel toggle (App.tsx setSettingsOpen), not a view. Adding it here would let
// the sidebar navigate to a view that App.tsx has no render branch for, which
// blanks <main> with no error.
export type ViewMode = 'overview' | 'board' | 'calendar' | 'table' | 'patients' | 'kliendid' | 'arved' | 'tootasud' | 'stats' | 'settings' | 'workers'
