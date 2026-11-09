/**
 * The clinic's country (`clinics.country`, sql/070) and what follows from it
 * (docs/ARCHITECTURE-INSTANCES.md §9, "Riga's workers and pay", option a).
 *
 * Estonian tax is only for an Estonian clinic: the payslip estimate, net pay
 * agreements, the employee's tax settings, and invoices. Anywhere else, pay
 * is shown gross, "before tax", and the clinic's accountant does the tax from
 * the monthly export. A clinic whose country isn't loaded yet is Estonian, as
 * every clinic was before.
 */
export const clinicCountry = (clinic: { country?: string | null } | null | undefined): string =>
  (clinic?.country?.trim() || 'EE').toUpperCase()

/** The payslip estimate, net agreements and the employee's tax settings. */
export const hasEstonianTax = (country: string): boolean => country === 'EE'

/** Wivo's invoices are Estonian documents; another country's are not built yet. */
export const invoicesAvailable = (country: string): boolean => country === 'EE'
