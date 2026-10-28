-- ============================================================================
-- Wivo — migration 065: vestlused
-- Run AFTER sql/064. Then, as a SEPARATE query:  notify pgrst, 'reload schema';
-- Realtime is a separate file on purpose — see sql/066.
-- ============================================================================
--
-- ── Kaks otsust, mis on skeemi sees ─────────────────────────────────────────
--
-- 1. LIIKMELISUS ON OMA TABEL, mitte "kõik, kes on selles kliinikus".
--
--    Täna osalevad ainult labori enda inimesed ja `clinic_id` oleks piisav.
--    Aga teine etapp on välised arstid, ja arst ei ole täna kasutaja vaid rida
--    `customers`-is. Kui kanali nähtavus oleks "sama kliinik", tähendaks välise
--    osaleja lisamine terve mõiste ümberehitamist koos andmemigratsiooniga —
--    ja migratsiooni, mis puudutab seda, kes mida nägi, ei taha keegi teha
--    tagantjärele.
--
--    `channel_members` ütleb juba praegu "kes näeb". Välise osaleja lisamine on
--    siis üks rida rohkem, mitte uus mudel.
--
-- 2. TERVISEANDMED AEGUVAD. Töö kohta käiv sõnum ("patsiendil on allergia") on
--    GDPR Art. 9 eriliiki andmed. Omanik valis automaatse tähtaja, vaikimisi
--    24 kuud.
--
--    Tähtaeg on SEADISTATAV ja mitte koodi sisse valatud, sest proteesi
--    garantii on tihti pikem kui 24 kuud: labor, kes peab viieaastase garantii
--    all seletama, mida 2027. aastal kokku lepiti, ei tohi avastada, et see
--    vestlus kustus ise ära. Vaikeväärtus on omaniku valik; number on kliiniku
--    oma.

-- ── Kanalid ──────────────────────────────────────────────────────────────────
create table if not exists public.channels (
  id          uuid primary key default gen_random_uuid(),
  clinic_id   uuid not null references public.clinics(id) on delete cascade,

  -- 'grupp' = nimega vestlus, 'too' = ühe töö oma, 'otse' = kahe inimese vahel.
  kind        text not null default 'grupp',

  -- Nimi on ainult grupivestlusel. Töö ja otsevestlus saavad nime sellest, mis
  -- nad on, ja salvestatud koopia läheks originaalist lahku niipea, kui töö
  -- patsienti muudetakse.
  name        text,

  -- Täidetud, kui kanal KUULUB ühele tööle. `on delete cascade` on teadlik:
  -- kustutatud töö vestlus ei ole enam millegi kohta, ja Art. 9 andmete
  -- orvuks jätmine on halvem kui nende kaotamine.
  job_id      uuid references public.jobs(id) on delete cascade,

  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  -- Arhiveeritud kanal on olemas ja loetav, aga nimekirjast väljas.
  archived_at timestamptz,

  constraint channels_kind_valid check (kind in ('grupp', 'too', 'otse')),
  -- Ühel tööl üks kanal. Ilma selleta tekiks iga "Aruta" vajutusega uus.
  constraint channels_job_unique unique (job_id)
);

create index if not exists channels_clinic_idx on public.channels (clinic_id, created_at desc);

-- ── Liikmed ──────────────────────────────────────────────────────────────────
create table if not exists public.channel_members (
  channel_id  uuid not null references public.channels(id) on delete cascade,
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  -- Mida see inimene siin teha saab. Täna on kõik 'liige'; 'vaatleja' on
  -- olemas selleks, et välise arsti lisamine teises etapis ei nõuaks uut veergu.
  role        text not null default 'liige',
  joined_at   timestamptz not null default now(),
  -- Kuni milleni ta on lugenud. Lugemata loendur on selle ja sõnumite vahe,
  -- mitte eraldi loendur, mida saaks tegelikkusest lahku minna.
  last_read_at timestamptz,

  primary key (channel_id, profile_id),
  constraint channel_members_role_valid check (role in ('liige', 'vaatleja'))
);

create index if not exists channel_members_profile_idx
  on public.channel_members (profile_id);

-- ── Sõnumid ──────────────────────────────────────────────────────────────────
create table if not exists public.messages (
  id          uuid primary key default gen_random_uuid(),
  channel_id  uuid not null references public.channels(id) on delete cascade,
  -- `set null`, mitte cascade: töölt lahkunud inimese sõnumid on vestluse osa
  -- ja nende kadumine jätaks poolepealse jutu, kus keegi vastab eimillelegi.
  author_id   uuid references public.profiles(id) on delete set null,

  body        text not null,
  created_at  timestamptz not null default now(),
  edited_at   timestamptz,
  -- Pehme kustutus: rida jääb, sisu läheb. Kõva kustutus jätaks augu, kus
  -- vastus viitab sõnumile, mida ei ole. GDPR-i kustutusnõude täitmiseks
  -- tühjendatakse `body` — see ON kustutamine, sisu ei ole kuskil alles.
  deleted_at  timestamptz,

  constraint messages_body_not_empty check (deleted_at is not null or length(btrim(body)) > 0)
);

create index if not exists messages_channel_idx on public.messages (channel_id, created_at desc);

-- ── Sõnumis märgitud tööd ────────────────────────────────────────────────────
-- Oma tabel, mitte massiiv sõnumi sees: "näita kõike, mis selle töö kohta on
-- öeldud" on päring, mis peab olema kiire, ja massiivi sees ei ole ta indeks.
create table if not exists public.message_jobs (
  message_id  uuid not null references public.messages(id) on delete cascade,
  job_id      uuid not null references public.jobs(id) on delete cascade,
  primary key (message_id, job_id)
);

create index if not exists message_jobs_job_idx on public.message_jobs (job_id);

-- ── Säilitustähtaeg ──────────────────────────────────────────────────────────
alter table public.clinic_settings
  add column if not exists vestlus jsonb not null default '{}'::jsonb;

-- Kustutab aegunud sõnumid. Jookseb cron'ist (sql/067) või käsitsi.
--
-- Kustutab PÄRISELT, mitte ei märgi kustutatuks: säilitustähtaja mõte on, et
-- andmeid ei ole enam, ja `deleted_at` jätaks nad alles.
create or replace function public.chat_prune()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  removed integer := 0;
  n integer;
  c record;
begin
  for c in
    select cl.id,
           coalesce((s.vestlus ->> 'sailitusKuud')::int, 24) as months
    from public.clinics cl
    left join public.clinic_settings s on s.clinic_id = cl.id
  loop
    -- 0 või vähem = ära kustuta kunagi. Ilma selleta tähendaks kliiniku
    -- kogemata nulliks seatud väli terve ajaloo kustutamist ühe ööga.
    if c.months is null or c.months <= 0 then
      continue;
    end if;
    delete from public.messages m
    using public.channels ch
    where m.channel_id = ch.id
      and ch.clinic_id = c.id
      and m.created_at < now() - make_interval(months => c.months);
    get diagnostics n = row_count;
    removed := removed + n;
  end loop;
  return removed;
end $$;

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table public.channels        enable row level security;
alter table public.channel_members enable row level security;
alter table public.messages        enable row level security;
alter table public.message_jobs    enable row level security;

-- Kas see kanal on minu oma? SECURITY DEFINER, sest teda loetakse teiste
-- tabelite poliitikate seest ja ta loeb `channel_members`-it, millel on omaenda
-- poliitika — muidu läheks kontroll rekursiooni või vastaks vaikselt "ei".
create or replace function public.in_channel(cid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.channel_members
    where channel_id = cid and profile_id = auth.uid()
  )
$$;

-- Kanalit näeb see, kes on selle liige. MITTE "kõik kliinikus" — vt faili algus.
drop policy if exists "channels_select" on public.channels;
create policy "channels_select" on public.channels
  for select using (in_channel(id));

drop policy if exists "channels_insert" on public.channels;
create policy "channels_insert" on public.channels
  for insert with check (clinic_id = my_clinic_id() and created_by = auth.uid());

-- Nime muuta ja arhiveerida saab liige. Kanali kliinikut ei saa keegi muuta,
-- sest `with check` nõuab, et ta jääks samaks.
drop policy if exists "channels_update" on public.channels;
create policy "channels_update" on public.channels
  for update using (in_channel(id)) with check (clinic_id = my_clinic_id());

drop policy if exists "channels_delete" on public.channels;
create policy "channels_delete" on public.channels
  for delete using (in_channel(id) and created_by = auth.uid());

-- Liikmeid näeb sama kanali liige.
drop policy if exists "channel_members_select" on public.channel_members;
create policy "channel_members_select" on public.channel_members
  for select using (in_channel(channel_id));

-- Lisada saab liige, ja ainult oma kliiniku inimese. Esimese liikme — iseenda —
-- lisab kanali looja, ja siis ta veel liige ei ole, nii et see juht on eraldi.
drop policy if exists "channel_members_insert" on public.channel_members;
create policy "channel_members_insert" on public.channel_members
  for insert with check (
    (in_channel(channel_id) or profile_id = auth.uid())
    and exists (
      select 1 from public.channels c
      where c.id = channel_id and c.clinic_id = my_clinic_id()
    )
  );

-- `last_read_at` on enda oma. Teise inimese lugemisseisu muutmine ei ole
-- kellelegi vajalik ja teeks lugemata loenduri valetavaks.
drop policy if exists "channel_members_update" on public.channel_members;
create policy "channel_members_update" on public.channel_members
  for update using (profile_id = auth.uid());

-- Lahkuda saab ise; teist saab eemaldada sama kanali liige.
drop policy if exists "channel_members_delete" on public.channel_members;
create policy "channel_members_delete" on public.channel_members
  for delete using (profile_id = auth.uid() or in_channel(channel_id));

-- Sõnumeid näeb kanali liige.
drop policy if exists "messages_select" on public.messages;
create policy "messages_select" on public.messages
  for select using (in_channel(channel_id));

drop policy if exists "messages_insert" on public.messages;
create policy "messages_insert" on public.messages
  for insert with check (in_channel(channel_id) and author_id = auth.uid());

-- Oma sõnumit saab muuta ja kustutada. Teise oma mitte — vestlus, mida keegi
-- teine tagantjärele ümber kirjutada saab, ei ole tõend millestki.
drop policy if exists "messages_update" on public.messages;
create policy "messages_update" on public.messages
  for update using (author_id = auth.uid());

drop policy if exists "messages_delete" on public.messages;
create policy "messages_delete" on public.messages
  for delete using (author_id = auth.uid());

-- Märgitud tööd järgivad sõnumit.
drop policy if exists "message_jobs_select" on public.message_jobs;
create policy "message_jobs_select" on public.message_jobs
  for select using (
    exists (select 1 from public.messages m where m.id = message_id and in_channel(m.channel_id))
  );

drop policy if exists "message_jobs_insert" on public.message_jobs;
create policy "message_jobs_insert" on public.message_jobs
  for insert with check (
    exists (
      select 1 from public.messages m
      where m.id = message_id and m.author_id = auth.uid()
    )
  );

drop policy if exists "message_jobs_delete" on public.message_jobs;
create policy "message_jobs_delete" on public.message_jobs
  for delete using (
    exists (
      select 1 from public.messages m
      where m.id = message_id and m.author_id = auth.uid()
    )
  );
