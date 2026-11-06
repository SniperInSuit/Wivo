/**
 * Wivo's four YubiKeys (docs/YUBIKEYS.md): one list for the arrival test and
 * the setup.
 */

/** By the letter on each (Kevin, 2026-11-06). */
export const KEYS = { A: 38272275, B: 38272285, C: 38272295, D: 38272284 }

export const MIN_FIRMWARE = [5, 7, 0]
export const MIN_YKMAN = [5, 4, 0] // Ed25519 in PIV

/**
 * The factory certificate (slot f9) all four carry: one per production batch
 * (the arrival test, 2026-11-06; docs/YUBIKEYS.md §4). fixtures/real-f9.pem.
 */
export const BATCH_F9_SHA256 =
  '7E:E7:06:D2:67:DF:53:E5:CC:45:05:37:2D:26:E5:DA:EA:DD:8F:EA:AF:4B:58:56:2A:FD:E8:CC:39:21:92:C1'
