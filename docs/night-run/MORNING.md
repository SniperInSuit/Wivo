# Morning notes (draft, finished at the end of the run)

## Needs you

### Apply sql/068 (tenant isolation) to the test project, then production
Closes the cross-tenant holes in phase0-report.md §2. Run it in the SQL editor,
then `notify pgrst, 'reload schema';`. Check after: you can still log in, see
jobs, add a worker, remove and restore a worker.
