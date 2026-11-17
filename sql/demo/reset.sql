-- ============================================================================
-- Wivo — DEMOKLIINIKU TÜHJENDAMINE. Kustutab kõik, mille sql/demo/seed.sql tegi.
-- ============================================================================
--
-- MILLEKS
--   Demo läheb sassi: keegi kustutas töö, muutis hindu, lisas kuus tühja
--   patsienti. Üks käsk, ja demo on jälle see, mida näidata.
--
-- SEE FAIL KUSTUTAB ANDMEID. Seepärast on tal samad kolm väravat nagu
-- seemendajal, ja veel üks juures: ta kustutab AINULT demokliiniku ja AINULT
-- @demo.wivodent.com kontod. Kui andmebaasis on midagi muud, ta keeldub
-- tervikuna, mitte "kustutab osa ära".
--
-- Väravad:
--   1. `public.wivo_demo` märgis peab olema (vt sql/demo/seed.sql päist).
--   2. Ükski kliinik ei tohi olla muu kui 'Baltic Smile Demo'.
--   3. Ükski kasutaja ei tohi olla väljaspool @demo.wivodent.com.
--
-- Pärast seda jooksuta sql/demo/seed.sql uuesti.
--
-- MIDA SEE EI TEE
--   Ta ei puutu skeemi, ei kustuta `public.wivo_demo` märgist ega kope
--   `job-files` sisu. Failid on hoidlas, mitte andmebaasis: kui demo failid
--   segavad, kustuta need Storage'ist käsitsi.
-- ============================================================================

do $$
declare
  v_clinic uuid;
  v_strays int;
  v_users  uuid[];
begin
  -- ── Väravad ───────────────────────────────────────────────────────────────
  if to_regclass('public.wivo_demo') is null then
    raise exception
      'See andmebaas ei ole märgitud demoks, nii et siin ei kustutata midagi. '
      'Vt sql/demo/seed.sql päist, samm 2.';
  end if;

  select count(*) into v_strays from public.clinics where name <> 'Baltic Smile Demo';
  if v_strays > 0 then
    raise exception
      'Siin on % kliinikut, mis ei ole demo. KEELDUN kustutamast.', v_strays;
  end if;

  select count(*) into v_strays
    from auth.users where email is null or email not like '%@demo.wivodent.com';
  if v_strays > 0 then
    raise exception
      'Siin on % kasutajat väljaspool demo-aadresse. KEELDUN kustutamast.', v_strays;
  end if;

  select id into v_clinic from public.clinics where name = 'Baltic Smile Demo';
  if v_clinic is null then
    raise notice 'Demokliinikut ei ole — midagi kustutada ei ole.';
    return;
  end if;

  select array_agg(id) into v_users from public.profiles where clinic_id = v_clinic;
  v_users := coalesce(v_users, array[]::uuid[]);

  -- ── Kustutamine, sõltuvuste järjekorras ───────────────────────────────────
  -- Iga tabel nimetatult, mitte `truncate ... cascade`: cascade kustutaks ka
  -- selle, mille keegi hiljem juurde paneb ja millele keegi ei mõelnud.
  -- `to_regclass` iga ees, et see fail jookseks ka andmebaasis, mis on mõne
  -- migratsiooni võrra taga.

  -- Töö küljes olev: liikumised, failid, jagamised, sõnumid, teated.
  if to_regclass('public.stock_movement') is not null then
    delete from public.stock_movement where org_id = v_clinic;
  end if;
  if to_regclass('public.inventory_count_line') is not null then
    delete from public.inventory_count_line
     where count_id in (select id from public.inventory_count where org_id = v_clinic);
  end if;
  if to_regclass('public.inventory_count') is not null then
    delete from public.inventory_count where org_id = v_clinic;
  end if;
  if to_regclass('public.inventory_schedule') is not null then
    delete from public.inventory_schedule where org_id = v_clinic;
  end if;
  if to_regclass('public.stock_threshold') is not null then
    delete from public.stock_threshold where org_id = v_clinic;
  end if;
  if to_regclass('public.stock_item') is not null then
    delete from public.stock_item where org_id = v_clinic;
  end if;

  -- A download grant is keyed by the downloader and the storage path, not by
  -- the file row (sql/072), so it goes by the clinic.
  if to_regclass('public.file_download_grant') is not null then
    delete from public.file_download_grant where org_id = v_clinic;
  end if;
  if to_regclass('public.job_file') is not null then
    delete from public.job_file
     where job_id in (select id from public.jobs where clinic_id = v_clinic);
  end if;
  if to_regclass('public.job_share') is not null then
    delete from public.job_share
     where job_id in (select id from public.jobs where clinic_id = v_clinic);
  end if;
  if to_regclass('public.message_jobs') is not null then
    delete from public.message_jobs
     where job_id in (select id from public.jobs where clinic_id = v_clinic);
  end if;
  if to_regclass('public.messages') is not null then
    delete from public.messages
     where channel_id in (select id from public.channels where clinic_id = v_clinic);
  end if;
  if to_regclass('public.channel_members') is not null then
    delete from public.channel_members
     where channel_id in (select id from public.channels where clinic_id = v_clinic);
  end if;
  if to_regclass('public.channels') is not null then
    delete from public.channels where clinic_id = v_clinic;
  end if;
  if to_regclass('public.notification') is not null then
    delete from public.notification where org_id = v_clinic;
  end if;

  -- Raha.
  if to_regclass('public.payments') is not null then
    delete from public.payments
     where invoice_id in (select id from public.invoices where clinic_id = v_clinic);
  end if;
  if to_regclass('public.invoice_lines') is not null then
    delete from public.invoice_lines
     where invoice_id in (select id from public.invoices where clinic_id = v_clinic);
  end if;
  if to_regclass('public.payment_plans') is not null then
    delete from public.payment_plans where clinic_id = v_clinic;
  end if;
  if to_regclass('public.invoices') is not null then
    delete from public.invoices where clinic_id = v_clinic;
  end if;
  if to_regclass('public.invoice_counters') is not null then
    delete from public.invoice_counters where clinic_id = v_clinic;
  end if;
  if to_regclass('public.worker_payout_lines') is not null then
    delete from public.worker_payout_lines
     where payout_id in (select id from public.worker_payouts where clinic_id = v_clinic);
  end if;
  if to_regclass('public.worker_payouts') is not null then
    delete from public.worker_payouts where clinic_id = v_clinic;
  end if;
  if to_regclass('public.worker_rates') is not null then
    delete from public.worker_rates where clinic_id = v_clinic;
  end if;
  if to_regclass('public.work_hours') is not null then
    delete from public.work_hours where clinic_id = v_clinic;
  end if;

  -- Tööd, patsiendid, kliendid, kalender.
  if to_regclass('public.patient_teeth') is not null then
    delete from public.patient_teeth
     where patient_id in (select id from public.patients where clinic_id = v_clinic);
  end if;
  if to_regclass('public.visits') is not null then
    delete from public.visits where clinic_id = v_clinic;
  end if;
  if to_regclass('public.visit_requests') is not null then
    delete from public.visit_requests where clinic_id = v_clinic;
  end if;
  delete from public.jobs where clinic_id = v_clinic;
  if to_regclass('public.job_code_counter') is not null then
    delete from public.job_code_counter where org_id = v_clinic;
  end if;
  delete from public.patients where clinic_id = v_clinic;
  delete from public.customers where clinic_id = v_clinic;

  -- Inimesed ja kliinik. Auditi read lähevad kaasa — demos ei ole midagi, mida
  -- nad hoiaksid; päris kliinikus ei jookse see fail kunagi.
  if to_regclass('public.audit_log') is not null then
    delete from public.audit_log where org_id = v_clinic;
  end if;
  if to_regclass('public.stage_transition') is not null then
    delete from public.stage_transition where org_id = v_clinic;
  end if;
  if to_regclass('public.worker_invite') is not null then
    delete from public.worker_invite where clinic_id = v_clinic;
  end if;
  if to_regclass('public.push_subscription') is not null then
    delete from public.push_subscription where user_id = any(v_users);
  end if;
  delete from public.worker_permissions where clinic_id = v_clinic;
  if to_regclass('public.clinic_settings') is not null then
    delete from public.clinic_settings where clinic_id = v_clinic;
  end if;

  -- Profiil kaob koos sisselogimiskontoga (profiles.id viitab auth.users'ile).
  delete from auth.users where id = any(v_users);
  delete from public.clinics where id = v_clinic;

  raise notice 'Demo tühjendatud: % kontot, kliinik %.', array_length(v_users, 1), v_clinic;
end $$;

-- ── Mis alles jäi: peaks olema kõik nullid ──────────────────────────────────
select 'clinics'     as what, count(*) from public.clinics
union all select 'users',       count(*) from auth.users
union all select 'jobs',        count(*) from public.jobs
union all select 'patients',    count(*) from public.patients
union all select 'stock items', count(*) from public.stock_item;
