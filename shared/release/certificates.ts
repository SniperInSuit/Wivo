/**
 * The certificates root A signed at the YubiKey setup of 2026-11-19
 * (docs/YUBIKEYS.md §3, step 6): the update and app keys on YubiKey C (the
 * signing key, 38272295) and D (its spare, 38272284), each valid from
 * 2026-11-19 to 2028-11-19.
 *
 * Public, and not trusted for being here: a certificate counts only because
 * a pinned root (PINNED_ROOTS) signed it, and the app and `wivo-update` check
 * that every time. The release tool publishes these in every list
 * (`PublishedList.certificates`). certificates.test.ts checks each one
 * against the pinned roots.
 *
 * Only `testing` carries this until the Riga release (RIGA-GO-LIVE.md).
 */
export const ROOT_A_CERTIFICATES: readonly string[] = [
  'WIVOCERT1.eyJrZXlfaWQiOiJ1cGRhdGUtQy1jZmJjZjRlYiIsIm5vdF9hZnRlciI6IjIwMjgtMTEtMTlUMDA6MDA6MDBaIiwibm90X2JlZm9yZSI6IjIwMjYtMTEtMTlUMDA6MDA6MDBaIiwicHVibGljX2tleSI6IjVpaEwyRUlZRFpqSnhrQzdTTFlqal9jTV9zYXdHZVRhazF0VjVYS281QlUiLCJwdXJwb3NlIjoidXBkYXRlIiwicm9vdF9pZCI6InJvb3QtQS05NDZlOWFmOCIsInYiOjF9.p5RlSAUAGX20S15b1jYPjTCu1-QDfuIftdwTHibPJR-DEfANNppzrTuHab_pxByQTJlKWvQDQSn8NMCAyxf6Aw',
  'WIVOCERT1.eyJrZXlfaWQiOiJhcHAtQy1jMTdlYjE4OSIsIm5vdF9hZnRlciI6IjIwMjgtMTEtMTlUMDA6MDA6MDBaIiwibm90X2JlZm9yZSI6IjIwMjYtMTEtMTlUMDA6MDA6MDBaIiwicHVibGljX2tleSI6ImhqVFI4OTk3aTZaZFVoZlN5OVVSNnZuVkhCSzJRWVlscU5seXVrVExOSHMiLCJwdXJwb3NlIjoiYXBwIiwicm9vdF9pZCI6InJvb3QtQS05NDZlOWFmOCIsInYiOjF9.RNt6Cmb86HVrnSPv4npQLT13_nU_glQCg0L_AxgI_a8kC_ullZ8xpL-jhb7EeaQEaJVSHrV9z1_lIe0_OPlSBg',
  'WIVOCERT1.eyJrZXlfaWQiOiJ1cGRhdGUtRC1mMDI4MDhhMiIsIm5vdF9hZnRlciI6IjIwMjgtMTEtMTlUMDA6MDA6MDBaIiwibm90X2JlZm9yZSI6IjIwMjYtMTEtMTlUMDA6MDA6MDBaIiwicHVibGljX2tleSI6ImN2c0VqbzZJbU9XM05YbFVTaUZrVGh3VE5hcXRZa0hoU2pqajB6QlZfUDgiLCJwdXJwb3NlIjoidXBkYXRlIiwicm9vdF9pZCI6InJvb3QtQS05NDZlOWFmOCIsInYiOjF9.RdgMh31AiUW88PMXpF8hbefBd1EzFSvR97wywyijP30Pjz9c_NesawLWpWVdVr9nVBEZNmzRGzdNQgZdJpJxDg',
  'WIVOCERT1.eyJrZXlfaWQiOiJhcHAtRC0yMmEzZTM1NyIsIm5vdF9hZnRlciI6IjIwMjgtMTEtMTlUMDA6MDA6MDBaIiwibm90X2JlZm9yZSI6IjIwMjYtMTEtMTlUMDA6MDA6MDBaIiwicHVibGljX2tleSI6InpudXlZMXdFcWNiTkN6R1FMSDBsMzhveWMtT01uWVZ4YXN3NG4yYl9BN1EiLCJwdXJwb3NlIjoiYXBwIiwicm9vdF9pZCI6InJvb3QtQS05NDZlOWFmOCIsInYiOjF9.amz7G4xfqV1cJHBGi4mo7qOzSqD3h2CuDLneCFC63rjl60sLK7nq5haPAECfZ8MNtY0EN_AaLPhTb8XcMN0ZCw',
]
