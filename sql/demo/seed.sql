-- ============================================================================
-- Wivo — DEMOKLIINIK. Täidab tühja demoandmebaasi näidiskliinikuga.
-- ============================================================================
--
-- MIS SEE ON
--   Üks väljamõeldud Läti kliinik, kõigi Riia rollidega, et iga vaadet saaks
--   päriselt näidata: tööd ja etapid, töötasud, ladu, arved, patsiendid,
--   statistika. Andmed on välja mõeldud — ükski nimi, isikukood, telefon ega
--   aadress ei kuulu kellelegi.
--
-- MIS SEE EI OLE
--   See EI OLE migratsioon. Ta ei muuda skeemi ja ta ei lähe sql/ numbrite
--   hulka. Ta jookseb AINULT demoandmebaasis, mille peal ei ole ühtegi päris
--   kliinikut.
--
-- ENNE JOOKSUTAMIST
--   1. Tee demoprojekt ja jooksuta selle peal kõik migratsioonid sql/-ist.
--   2. Ütle sellele andmebaasile, et ta on demo. Üks rida, meelega käsitsi:
--
--        create table if not exists public.wivo_demo (one boolean primary key default true);
--        insert into public.wivo_demo values (true) on conflict do nothing;
--
--      Ilma selle märgiseta see fail KEELDUB. Nii ei saa seda kogemata
--      testkoopia ega tootmise peal jooksutada, ükskõik kuhu redaktor on
--      parasjagu avatud.
--   3. Asenda allpool <DEMO_PASSWORD> ühe paroolidega, mida demokontod
--      kasutavad. Vähemalt 12 tähemärki. **Ära jäta seda faili parooliga
--      gitti** — fail on jälgitav, parool ei ole.
--
-- PÄRAST JOOKSUTAMIST
--   Iga konto peab esimesel sisselogimisel lisama teise teguri, nagu iga
--   päris kasutaja: ilma selleta ei näe ta midagi (sql/098). See ei ole viga,
--   vaid seesama reegel, mida demo peabki näitama.
--
--   Kontod (parool on see, mille sa <DEMO_PASSWORD> asemele panid):
--     owner@demo.wivodent.com        omanik — näeb kõike
--     doctor@demo.wivodent.com       arst — tellib töid, näeb patsiente
--     tech.digital@demo.wivodent.com digitehnik — disain, printimine
--     tech.manual@demo.wivodent.com  tehnik — käsitsi viimistlus
--     accountant@demo.wivodent.com   raamatupidaja — töötasud, EI näe patsiente
--     secretary@demo.wivodent.com    sekretär — tööd koos patsiendiga
--     manager@demo.wivodent.com      juhataja — ladu, EI näe patsiente
--     it@demo.wivodent.com           IT — failid töö juurde
--
--   Raamatupidaja ja juhataja "ei näe patsiente" on kontrollitud, mitte
--   eeldatud: Töötasud ei näita patsiendi nime kordagi, ja Ladu näitab seda
--   ainult töö otsinguväljal, mis loeb inimese enda nähtavaid töid. Seepärast
--   EI ANTA juhatajale `jobs.read`-i — see tingimus on osa rollist, mitte
--   juhus (docs/WORKFLOW-STAGES.md §7).
--
-- UUESTI JOOKSUTAMINE
--   sql/demo/reset.sql kustutab kõik selle faili tehtu ja alles siis saab
--   uuesti seemendada. See fail ise ei kustuta midagi.
-- ============================================================================

-- ── Väravad. Kolm, ja kõik kolm peavad läbi laskma ──────────────────────────
do $$
declare
  v_pw       text := '<DEMO_PASSWORD>';
  v_strays   int;
begin
  -- 1. Märgis. Ilma selleta ei tea me, kas see on demo, ja siis ei tee me
  --    midagi. "Ma arvasin, et olin demo peal" on täpselt see viga, mille see
  --    rida välistab.
  if to_regclass('public.wivo_demo') is null then
    raise exception
      'See andmebaas ei ole märgitud demoks. Vt selle faili päist, samm 2. '
      'Kui sa oled tootmises või testkoopias, siis see fail ei tohigi siin joosta.';
  end if;

  -- 2. Parool. Asendamata kohatäide tähendaks kontosid, millesse keegi sisse
  --    ei saa, ja seda avastaks alles demo ajal.
  if v_pw = '<DEMO_' || 'PASSWORD>' or length(v_pw) < 12 then
    raise exception
      'Parool on asendamata või lühem kui 12 tähemärki. Vt selle faili päist, samm 3.';
  end if;

  -- 3. Päris andmed. Isegi märgisega ei tohi see fail joosta andmebaasis, kus
  --    on päris kliinik: demo ja klient ei ela kunagi ühes andmebaasis.
  select count(*) into v_strays from public.clinics where name <> 'Baltic Smile Demo';
  if v_strays > 0 then
    raise exception
      'Siin on % kliinikut, mis ei ole demo. See ei ole demoandmebaas.', v_strays;
  end if;

  select count(*) into v_strays
    from auth.users where email is null or email not like '%@demo.wivodent.com';
  if v_strays > 0 then
    raise exception
      'Siin on % kasutajat väljaspool demo-aadresse. See ei ole demoandmebaas.', v_strays;
  end if;
end $$;

-- ── Kliinik ─────────────────────────────────────────────────────────────────
-- Läti, et arvete värav (`invoicesAvailable`, country.ts) käituks demos täpselt
-- nii nagu Riias: arved on LV-s välja lülitatud, kuni Läti nõuded on uuritud
-- (docs/ROADMAP.md samm 3). Liides inglise keeles, nagu Riia start.
insert into public.clinics (id, name, address, city, postal_code, phone, email,
                            reg_code, vat_number, country, default_language, code_prefix)
values ('d0000000-0000-4000-8000-000000000001', 'Baltic Smile Demo',
        'Demo iela 1', 'Rīga', 'LV-1001', '+371 2000 0000',
        'info@demo.wivodent.com', '40000000000', 'LV40000000000', 'LV', 'en', 'BS')
on conflict (id) do nothing;

-- ── Kliiniku seaded ─────────────────────────────────────────────────────────
-- Etapid on praegused kuus vaikeetappi (src/renderer/src/config/pipeline.ts).
-- Riia oma seitsmeetapiline töövoog tuleb mallidena, migratsioon 122
-- (docs/WORKFLOW-STAGES.md) — demo näitab seda, mis täna päriselt töötab.
insert into public.clinic_settings (clinic_id, work_types, materials, material_prices,
                                    machines, pipeline_stages, pricing, features, payroll)
values (
  'd0000000-0000-4000-8000-000000000001',
  '["Crown", "Bridge", "Veneer", "Night guard", "Surgical guide", "Model"]'::jsonb,
  '["Zirconia", "E.max", "PMMA", "Resin", "Metal"]'::jsonb,
  '{"Zirconia": 45, "E.max": 55, "PMMA": 18, "Resin": 12, "Metal": 30}'::jsonb,
  '["Printer A", "Printer B", "Mill 1"]'::jsonb,
  '[{"key": "disain",  "label": "Design",    "hex": "#6366F1"},
    {"key": "print",   "label": "Printing",  "hex": "#F59E0B"},
    {"key": "poleeri", "label": "Polishing", "hex": "#10B981"},
    {"key": "puhasta", "label": "Cleaning",  "hex": "#3B82F6"},
    {"key": "varvi",   "label": "Staining",  "hex": "#EC4899"},
    {"key": "valmis",  "label": "Done",      "hex": "#22C55E"}]'::jsonb,
  '{"Crown": 120, "Bridge": 320, "Veneer": 140, "Night guard": 180, "Surgical guide": 260, "Model": 25}'::jsonb,
  '{"lab": true, "clinical": true}'::jsonb,
  '{}'::jsonb
)
on conflict (clinic_id) do nothing;

-- ── Kontod ──────────────────────────────────────────────────────────────────
-- Profiili rea teeb sql/012 päästik, meta-andmetes olevast nimest. Parool
-- läheb bcrypti; `auth.identities` rida on see, mis lubab e-posti ja parooliga
-- sisse logida (uuemad GoTrue versioonid nõuavad seda) — kirjutatakse ainult
-- siis, kui see tabel olemas on, et seesama fail jookseks ka PGlite testis.
do $$
declare
  v_pw   text := '<DEMO_PASSWORD>';
  v_hash text := crypt(v_pw, gen_salt('bf'));
  v_clinic uuid := 'd0000000-0000-4000-8000-000000000001';
  r record;
  v_id uuid;
begin
  for r in
    select * from (values
      ('owner@demo.wivodent.com',        'Ilze Demo',      'owner',  'owner', array[]::text[]),
      ('doctor@demo.wivodent.com',       'Dr Jānis Demo',  'worker', null,
        array['jobs.write', 'patients.read', 'patients.write', 'visits.read', 'visits.write']),
      ('tech.digital@demo.wivodent.com', 'Marta Demo',     'worker', null,
        array['jobs.write', 'stock.read', 'stock.write', 'pipeline.write']),
      ('tech.manual@demo.wivodent.com',  'Pēteris Demo',   'worker', null,
        array['jobs.write', 'stock.read', 'stock.write']),
      -- Töökoodid, tehtud töö ja palk — ilma patsiendi nimedeta. Töötasude
      -- leht ei näita nime kordagi, nii et see roll on täna juba olemas.
      ('accountant@demo.wivodent.com',   'Anna Demo',      'worker', null,
        array['payroll.manage', 'payments.read']),
      -- Sekretär näeb töid KOOS patsiendiga, sest ta koordineerib vastuvõtte.
      ('secretary@demo.wivodent.com',    'Līga Demo',      'worker', null,
        array['jobs.read', 'patients.read', 'visits.read', 'visits.write']),
      -- Juhataja: ladu, ja TEADLIKULT ilma `jobs.read`-ita, muidu näeks ta
      -- lao töö-otsingus patsientide nimesid.
      ('manager@demo.wivodent.com',      'Roberts Demo',   'worker', null,
        array['stock.read', 'stock.write', 'stats.read']),
      -- IT laeb failid töö juurde. Täna nõuab see `jobs.write`-i, sest eraldi
      -- `files.write` õigust ei ole — see on üks kahest puuduvast õigusest
      -- (docs/WORKFLOW-STAGES.md §7).
      ('it@demo.wivodent.com',           'Igors Demo',     'worker', null,
        array['jobs.write'])
    ) as t(email, full_name, role, org_role, perms)
  loop
    select id into v_id from auth.users where email = r.email;
    if v_id is null then
      insert into auth.users (instance_id, aud, role, email, encrypted_password,
                              email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
      values ('00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
              r.email, v_hash, now(),
              '{"provider": "email", "providers": ["email"]}'::jsonb,
              jsonb_build_object('full_name', r.full_name))
      returning id into v_id;

      if to_regclass('auth.identities') is not null then
        execute format(
          'insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at)
             values (%L, %L, %L::jsonb, %L, now()) on conflict do nothing',
          v_id::text, v_id,
          jsonb_build_object('sub', v_id::text, 'email', r.email, 'email_verified', true)::text,
          'email');
      end if;
    end if;

    update public.profiles
       set clinic_id = v_clinic, role = r.role, org_role = r.org_role,
           full_name = r.full_name, language = 'en'
     where id = v_id;

    delete from public.worker_permissions where profile_id = v_id;
    insert into public.worker_permissions (profile_id, clinic_id, permission, granted)
    select v_id, v_clinic, p, true from unnest(r.perms) as p;
  end loop;
end $$;

-- Lühendid, et ülejäänud fail ei korraks UUID-sid.
create or replace temporary view demo_people as
  select p.id, u.email, p.full_name
    from public.profiles p join auth.users u on u.id = p.id
   where p.clinic_id = 'd0000000-0000-4000-8000-000000000001';

-- ── Kliendid: kaks suunavat kliinikut ───────────────────────────────────────
insert into public.customers (id, clinic_id, name, reg_code, email, phone,
                              contact_name, billing_mode, payment_terms_days)
values
  ('d0000000-0000-4000-8000-000000000101', 'd0000000-0000-4000-8000-000000000001',
   'Demo Dental Centre', '40100000001', 'office@demo.wivodent.com', '+371 2000 0001',
   'Dr Jānis Demo', 'per_job', 14),
  -- Püsiklient: igakuine arve (docs/ROADMAP.md samm 3). Arved on LV-s välja
  -- lülitatud, nii et demos näitab see klient seadistust, mitte arvet.
  ('d0000000-0000-4000-8000-000000000102', 'd0000000-0000-4000-8000-000000000001',
   'Demo Smile Clinic', '40100000002', 'reception@demo.wivodent.com', '+371 2000 0002',
   'Dr Anete Demo', 'monthly', 30)
on conflict (id) do nothing;

-- ── Patsiendid ──────────────────────────────────────────────────────────────
-- Väljamõeldud. Isikukoode ei ole üldse: demo ei pea neid näitama, ja mida ei
-- ole, see ei saa ka lekkida.
insert into public.patients (id, clinic_id, nimi, synniaeg, telefon, email, arst, kliinik)
values
  ('d0000000-0000-4000-8000-000000000201', 'd0000000-0000-4000-8000-000000000001',
   'Demo Patient A', '1979-04-12', '+371 2000 0011', 'a@demo.wivodent.com', 'Dr Jānis Demo', 'Demo Dental Centre'),
  ('d0000000-0000-4000-8000-000000000202', 'd0000000-0000-4000-8000-000000000001',
   'Demo Patient B', '1991-09-03', '+371 2000 0012', 'b@demo.wivodent.com', 'Dr Jānis Demo', 'Demo Dental Centre'),
  ('d0000000-0000-4000-8000-000000000203', 'd0000000-0000-4000-8000-000000000001',
   'Demo Patient C', '1965-01-27', '+371 2000 0013', 'c@demo.wivodent.com', 'Dr Anete Demo', 'Demo Smile Clinic')
on conflict (id) do nothing;

-- ── Tööd ────────────────────────────────────────────────────────────────────
-- Üks igas etapis, et tahvel ei oleks ühe tulba pikk; üks üle antud ja makstud,
-- et Töötasud ja Statistika näitaksid midagi; üks kiirtöö.
do $$
declare
  v_clinic   uuid := 'd0000000-0000-4000-8000-000000000001';
  v_digital  uuid := (select id from demo_people where email = 'tech.digital@demo.wivodent.com');
  v_manual   uuid := (select id from demo_people where email = 'tech.manual@demo.wivodent.com');
  v_cust_a   uuid := 'd0000000-0000-4000-8000-000000000101';
  v_cust_b   uuid := 'd0000000-0000-4000-8000-000000000102';
begin
  insert into public.jobs (clinic_id, status, kuupaev, patsient, patient_id, too, materjal,
                           varv, hambad, hind, disain_hind, assigned_to, designed_by,
                           customer_id, masina, kiirtoo, delivery_status, delivered_at,
                           makstud, makse_kuupaev, kirjeldus)
  values
    (v_clinic, 'disain',  current_date - 1, 'Demo Patient A', 'd0000000-0000-4000-8000-000000000201',
     'Crown', 'Zirconia', 'A2', '16', 120, 35, v_digital, v_digital, v_cust_a, null, false,
     'labor', null, false, null, 'Scanned chairside, single implant.'),
    (v_clinic, 'print',   current_date - 2, 'Demo Patient B', 'd0000000-0000-4000-8000-000000000202',
     'Surgical guide', 'Resin', null, '14,15,16', 260, 80, v_digital, v_digital, v_cust_a,
     'Printer A', false, 'labor', null, false, null, 'Two implants, photogrammetry done.'),
    (v_clinic, 'poleeri', current_date - 3, 'Demo Patient C', 'd0000000-0000-4000-8000-000000000203',
     'Bridge', 'E.max', 'A3', '23,24,25', 320, 90, v_manual, v_digital, v_cust_b, 'Mill 1', true,
     'labor', null, false, null, 'Rush: patient flies out on Friday.'),
    (v_clinic, 'varvi',   current_date - 5, 'Demo Patient A', 'd0000000-0000-4000-8000-000000000201',
     'Veneer', 'E.max', 'B1', '11,21', 140, 40, v_manual, v_digital, v_cust_a, null, false,
     'labor', null, false, null, null),
    (v_clinic, 'valmis',  current_date - 9, 'Demo Patient B', 'd0000000-0000-4000-8000-000000000202',
     'Night guard', 'PMMA', null, '36,37', 180, 25, v_manual, v_digital, v_cust_b, 'Printer B', false,
     'yle_antud', now() - interval '3 days', true, current_date - 2, 'Handed over at the desk.');
end $$;

-- ── Ladu ────────────────────────────────────────────────────────────────────
-- Kolm artiklit: üks aegumas, üks otsakorral, üks tavaline — nii et lao
-- hoiatused (useStockAlerts) näitavad demos midagi.
do $$
declare
  v_clinic uuid := 'd0000000-0000-4000-8000-000000000001';
  v_by     uuid := (select id from demo_people where email = 'manager@demo.wivodent.com');
  v_item   uuid;
  r        record;
begin
  for r in
    select * from (values
      ('implant',  'Demo Implants', 'DemoLine', '4.1 x 10', 'Implant 4.1x10', 'LOT-A-1', (current_date + 400)::date, 12),
      ('abutment', 'Demo Implants', 'DemoLine', 'standard', 'Abutment std',   'LOT-B-2', (current_date + 25)::date,  4),
      ('membrane', 'Demo Bio',      null,       '15 x 20',  'Membrane 15x20', 'LOT-C-3', (current_date + 200)::date,  1)
    ) as t(category, manufacturer, system, size, product, lot, expiry_date, qty)
  loop
    insert into public.stock_item (org_id, category, manufacturer, system, size, product,
                                   lot, expiry_date, created_by)
    values (v_clinic, r.category, r.manufacturer, r.system, r.size, r.product,
            r.lot, r.expiry_date, v_by)
    returning id into v_item;

    insert into public.stock_movement (org_id, item_id, kind, delta, reason, by_user)
    values (v_clinic, v_item, 'in', r.qty, 'Demo opening stock', v_by);
  end loop;
end $$;

-- ── Palgamäärad ja tunnid ───────────────────────────────────────────────────
-- Et Töötasud ei oleks tühi leht: üks tükitöö määr ja üks tunnitasu.
do $$
declare
  v_clinic  uuid := 'd0000000-0000-4000-8000-000000000001';
  v_digital uuid := (select id from demo_people where email = 'tech.digital@demo.wivodent.com');
  v_manual  uuid := (select id from demo_people where email = 'tech.manual@demo.wivodent.com');
begin
  insert into public.worker_rates (clinic_id, profile_id, kind, amount, work_type, applies_to, label)
  -- kind: sql/022 ja sql/024 lubavad tund, hammas, too, protsent, kuu.
  -- applies_to: too, disain, muudatus, mudel (sql/060).
  values (v_clinic, v_digital, 'too',  18, 'Crown', 'disain', 'Design, crown'),
         (v_clinic, v_manual,  'tund', 14, null,    'too',    'Hourly');

  insert into public.work_hours (clinic_id, profile_id, work_date, hours, note, recorded_by)
  values (v_clinic, v_manual, current_date - 1, 8, 'Demo day', v_manual),
         (v_clinic, v_manual, current_date - 2, 7.5, 'Demo day', v_manual);
end $$;

-- ── Mis valmis sai ──────────────────────────────────────────────────────────
select 'clinic'      as what, count(*) from public.clinics
union all select 'people',      count(*) from public.profiles where clinic_id = 'd0000000-0000-4000-8000-000000000001'
union all select 'permissions', count(*) from public.worker_permissions where clinic_id = 'd0000000-0000-4000-8000-000000000001'
union all select 'customers',   count(*) from public.customers where clinic_id = 'd0000000-0000-4000-8000-000000000001'
union all select 'patients',    count(*) from public.patients where clinic_id = 'd0000000-0000-4000-8000-000000000001'
union all select 'jobs',        count(*) from public.jobs where clinic_id = 'd0000000-0000-4000-8000-000000000001'
union all select 'stock items', count(*) from public.stock_item where org_id = 'd0000000-0000-4000-8000-000000000001'
union all select 'pay rates',   count(*) from public.worker_rates where clinic_id = 'd0000000-0000-4000-8000-000000000001';
