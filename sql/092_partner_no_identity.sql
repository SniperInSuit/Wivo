-- ============================================================================
-- Wivo — migration 092: a partner never learns who the patient is
-- Run AFTER sql/091. Then, as a SEPARATE query:  notify pgrst, 'reload schema';
-- ============================================================================
--
-- Locked decision from the lawyer (2 November 2026): no personal data crosses
-- borders between clinics. A partner organisation sees only job information,
-- never who the patient is.
--
-- 1. Full visibility is off. A referral is still a case type (with the
--    "patient informed and agreed" mark), but it shows the partner exactly
--    what lab work does. The patient brings their own records (the patient
--    export, sql/074). Constraints keep it that way whatever calls the table.
-- 2. partner_jobs never returns a name or contacts, whatever a share says.
-- 3. Free text the partner reads (the job's work fields, description, work
--    items, revisions; the job thread) is checked when the OWNER's staff save
--    it: the patient's first or last name, or anything shaped like an Estonian
--    or Latvian personal code, is refused with SQLSTATE WV001. The app turns
--    that into "remove the name". Sharing a job whose text already names the
--    patient is refused the same way.
-- 4. As a second layer, everything a partner reads is redacted on the way out
--    ("•••"), so text written before this migration, or by a path that skips
--    the checks, does not reach them either.
--
-- Only the owner's staff are checked. A partner's text goes to the owner
-- (who knows the patient) and never to another partner (sql/085,
-- partner_sees). Checking it would also let a partner guess names: a refused
-- "Mari" would tell them the patient is Mari.
--
-- Tests: sql/test/partnerNoIdentity.test.ts.
-- ============================================================================

-- ── 1. Full visibility off ──────────────────────────────────────────────────

-- The old rule tied a referral to full visibility; the consent mark stays.
alter table public.job_share drop constraint if exists job_share_referral_consent;
update public.job_share set visibility = 'partial' where visibility = 'full';
alter table public.job_share add constraint job_share_referral_consent check (
  case_type <> 'referral' or (consent_by is not null and consent_at is not null));
alter table public.job_share drop constraint if exists job_share_partial_only;
alter table public.job_share add constraint job_share_partial_only check (visibility = 'partial');

update public.partnership set default_visibility = 'partial' where default_visibility = 'full';
alter table public.partnership drop constraint if exists partnership_partial_only;
alter table public.partnership add constraint partnership_partial_only check (default_visibility = 'partial');

-- ── 2. Recognising the patient in text ──────────────────────────────────────

/**
 * The words that name a patient: each part of the record's name and of the
 * job's own name field, lower case, two letters or longer. "Mari-Liis Tamm"
 * gives mari, liis, tamm.
 */
create or replace function public.identity_terms(p_patient uuid, p_name text)
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(distinct lower(w)) filter (where char_length(w) >= 2), '{}')
    from regexp_split_to_table(
           coalesce((select nimi from public.patients where id = p_patient), '') || ' ' || coalesce(p_name, ''),
           '[[:space:][:punct:]]+') w
$$;
revoke execute on function public.identity_terms(uuid, text) from public, anon, authenticated;

create or replace function public.job_identity_terms(p_job uuid)
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select public.identity_terms(j.patient_id, j.patsient) from public.jobs j where j.id = p_job
$$;
revoke execute on function public.job_identity_terms(uuid) from public, anon, authenticated;

/**
 * A regular expression for one name word: the whole word, and from four
 * letters up also the word with a short case ending ("Tamm" → "Tamme",
 * "Tammele"; "Иван" → "Ивану"). Shorter words match only whole, or "Li" would
 * find "like".
 */
create or replace function public.identity_pattern(p_term text)
returns text
language sql
immutable
set search_path = public
as $$
  select '\m' || regexp_replace(p_term, '([^[:alnum:]])', '\\\1', 'g')
         || case when char_length(p_term) >= 4 then '[[:alpha:]]{0,3}' else '' end || '\M'
$$;

-- Estonian isikukood, Latvian personas kods (old DDMMYY-XNNNN and new 32…).
-- The same shapes as shared/privacy/scrub.ts (the error-log filter), plus the new Latvian form.
create or replace function public.personal_code_pattern()
returns text
language sql
immutable
set search_path = public
as $$
  select '(?<![0-9])([1-6][0-9]{2}[01][0-9][0-3][0-9]{5}|[0-3][0-9][01][0-9]{3}-?[0-2][0-9]{4}|32[0-9]{4}-?[0-9]{5})(?![0-9])'
$$;

/** What in `p_text` identifies the patient: a name word, 'personal code', or null. */
create or replace function public.identity_hit(p_text text, p_terms text[])
returns text
language plpgsql
immutable
set search_path = public
as $$
declare t text;
begin
  if coalesce(p_text, '') = '' then
    return null;
  end if;
  if p_text ~ public.personal_code_pattern() then
    return 'personal code';
  end if;
  foreach t in array coalesce(p_terms, '{}') loop
    if p_text ~* public.identity_pattern(t) then
      return t;
    end if;
  end loop;
  return null;
end;
$$;

/** `p_text` with every name word and personal code replaced by •••. */
create or replace function public.redact_identity(p_text text, p_terms text[])
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  t text;
  r text := p_text;
begin
  if coalesce(r, '') = '' then
    return r;
  end if;
  r := regexp_replace(r, public.personal_code_pattern(), '•••', 'g');
  foreach t in array coalesce(p_terms, '{}') loop
    r := regexp_replace(r, public.identity_pattern(t), '•••', 'gi');
  end loop;
  return r;
end;
$$;

/** The same for JSON: every string value redacted, keys and shape kept. */
create or replace function public.redact_identity_json(p jsonb, p_terms text[])
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
begin
  return case jsonb_typeof(p)
    when 'string' then to_jsonb(public.redact_identity(p #>> '{}', p_terms))
    when 'array' then (select coalesce(jsonb_agg(public.redact_identity_json(e, p_terms) order by i), '[]'::jsonb)
                         from jsonb_array_elements(p) with ordinality a(e, i))
    when 'object' then (select coalesce(jsonb_object_agg(k, public.redact_identity_json(v, p_terms)), '{}'::jsonb)
                          from jsonb_each(p) o(k, v))
    else p
  end;
end;
$$;

/** Every string inside a JSON value, as one text. */
create or replace function public.json_strings(p jsonb)
returns text
language sql
immutable
set search_path = public
as $$
  select string_agg(v #>> '{}', ' ')
    from jsonb_path_query(coalesce(p, 'null'::jsonb), 'strict $.** ? (@.type() == "string")') v
$$;

/**
 * The text of a job that a partner reads: exactly the free-text columns of
 * partner_jobs, work items and revisions as the partner receives them.
 */
create or replace function public.partner_visible_text(j public.jobs)
returns text
language sql
stable
set search_path = public
as $$
  select concat_ws(' ', j.too, j.hambad, j.materjal, j.varv, j.kondivarv, j.kirjeldus,
                   public.json_strings(public.partner_work_items(j.work_items)),
                   public.json_strings(public.partner_revisions(j.revisions)))
$$;

/** Is the job shared with any partner right now (including a read-only window)? */
create or replace function public.job_is_shared(p_job uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.job_share s join public.partnership p on p.id = s.partnership_id
     where s.job_id = p_job and s.revoked_at is null
       and (p.status in ('active', 'suspended') or (p.status = 'ended' and p.readonly_until > now())))
$$;
revoke execute on function public.job_is_shared(uuid) from public, anon, authenticated;

-- ── 3. Refused when saved ───────────────────────────────────────────────────

/**
 * On a shared job, text the partner reads may not name the patient. Only what
 * this save adds is checked — a stage move on an old job does not trip over
 * old text — unless the patient changed, then all of it.
 */
create or replace function public.guard_partner_visible_job_text()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_text text;
  v_terms text[];
begin
  if not public.job_is_shared(new.id) then
    return new;
  end if;
  if new.patient_id is distinct from old.patient_id or new.patsient is distinct from old.patsient then
    v_text := public.partner_visible_text(new);
  else
    v_text := concat_ws(' ',
      nullif(new.too, old.too), nullif(new.hambad, old.hambad), nullif(new.materjal, old.materjal),
      nullif(new.varv, old.varv), nullif(new.kondivarv, old.kondivarv), nullif(new.kirjeldus, old.kirjeldus),
      (select string_agg(s, ' ') from (
         select v #>> '{}' from jsonb_path_query(
           jsonb_build_array(public.partner_work_items(new.work_items), public.partner_revisions(new.revisions)),
           'strict $.** ? (@.type() == "string")') v
         except
         select v #>> '{}' from jsonb_path_query(
           jsonb_build_array(public.partner_work_items(old.work_items), public.partner_revisions(old.revisions)),
           'strict $.** ? (@.type() == "string")') v) x(s)));
  end if;
  v_terms := public.identity_terms(new.patient_id, new.patsient);
  if public.identity_hit(v_text, v_terms) is not null then
    -- No name in the message: errors are logged and can end up in a bug report.
    raise exception 'Partners read this text. Remove the patient''s name or personal code.' using errcode = 'WV001';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_partner_visible_job_text on public.jobs;
create trigger guard_partner_visible_job_text before update on public.jobs
  for each row execute function public.guard_partner_visible_job_text();

/** The same for the job thread, for messages the owner's staff write. */
create or replace function public.guard_partner_visible_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job     uuid;
  v_owner   uuid;
  v_patient uuid;
  v_name    text;
begin
  if tg_op = 'UPDATE' and new.body is not distinct from old.body then
    return new;
  end if;
  select ch.job_id, j.clinic_id, j.patient_id, j.patsient into v_job, v_owner, v_patient, v_name
    from public.channels ch join public.jobs j on j.id = ch.job_id
   where ch.id = new.channel_id and ch.kind = 'too';
  if v_job is null or not public.job_is_shared(v_job)
     or (select clinic_id from public.profiles where id = new.author_id) is distinct from v_owner then
    return new;
  end if;
  if public.identity_hit(new.body, public.identity_terms(v_patient, v_name)) is not null then
    raise exception 'Partners read this text. Remove the patient''s name or personal code.' using errcode = 'WV001';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_partner_visible_message on public.messages;
create trigger guard_partner_visible_message before insert or update of body on public.messages
  for each row execute function public.guard_partner_visible_message();

/**
 * Sharing. As sql/084, with two changes: the share is always partial (a
 * referral too), and a job whose partner-visible text names the patient is
 * not shared until that text is fixed.
 */
create or replace function public.share_job(
  p_job uuid,
  p_partner_org uuid,
  p_case_type text,
  p_role text,
  p_stages text[],
  p_visibility text default null,
  p_consent boolean default false,
  p_partner_price numeric default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.my_org_id();
  j     public.jobs;
  p     public.partnership;
  v_id  uuid;
begin
  select * into j from public.jobs where id = p_job;
  if j.id is null or j.clinic_id is distinct from v_org or not public.has_perm('jobs.write') then
    raise exception 'Job not found' using errcode = '42501';
  end if;
  select * into p from public.partnership
   where status = 'active'
     and ((org_a = v_org and org_b = p_partner_org) or (org_b = v_org and org_a = p_partner_org));
  if p.id is null then
    raise exception 'No active partnership with that organisation' using errcode = '22023';
  end if;
  if cardinality(p.roles) > 0 and not (p_role = any(p.roles)) then
    raise exception 'The partnership does not include the role %', p_role using errcode = '22023';
  end if;
  if p_case_type = 'referral' and not coalesce(p_consent, false) then
    raise exception 'A referral needs the mark "patient informed and agreed"' using errcode = '22023';
  end if;
  if public.identity_hit(public.partner_visible_text(j), public.identity_terms(j.patient_id, j.patsient)) is not null then
    raise exception 'Partners read this text. Remove the patient''s name or personal code.' using errcode = 'WV001';
  end if;

  -- p_visibility is ignored: partners never see who the patient is.
  update public.job_share
     set case_type = p_case_type, role = p_role, assigned_stages = coalesce(p_stages, '{}'),
         visibility = 'partial', partner_price = p_partner_price, partnership_id = p.id,
         consent_by = case when p_case_type = 'referral' then coalesce(consent_by, auth.uid()) end,
         consent_at = case when p_case_type = 'referral' then coalesce(consent_at, now()) end
   where job_id = p_job and partner_org = p_partner_org and revoked_at is null
  returning id into v_id;

  if v_id is null then
    insert into public.job_share (job_id, owner_org, partner_org, partnership_id, case_type, visibility,
                                  role, assigned_stages, partner_price, consent_by, consent_at, created_by)
    values (p_job, v_org, p_partner_org, p.id, p_case_type, 'partial', p_role, coalesce(p_stages, '{}'),
            p_partner_price,
            case when p_case_type = 'referral' then auth.uid() end,
            case when p_case_type = 'referral' then now() end,
            auth.uid())
    returning id into v_id;
  end if;

  perform public.audit(v_org, 'share', 'job:' || p_job,
    jsonb_build_object('partner_org', p_partner_org, 'case_type', p_case_type, 'visibility', 'partial', 'stages', p_stages));
  perform public.audit(p_partner_org, 'share', 'job:' || p_job,
    jsonb_build_object('owner_org', v_org, 'case_type', p_case_type, 'visibility', 'partial', 'stages', p_stages));
  return v_id;
end;
$$;

-- ── 4. Redacted when read ───────────────────────────────────────────────────

/**
 * As sql/085, except: name and contacts are always null, and every text the
 * partner reads is redacted. The columns stay so older app builds keep
 * working; they are simply empty.
 */
create or replace function public.partner_jobs()
returns table (
  share_id uuid, job_id uuid, job_code text, owner_org uuid, owner_org_name text, case_type text,
  visibility text, role text, assigned_stages text[], status text, can_move boolean, next_stage text,
  received_on date, due_at timestamptz, work_type text, work_items jsonb, teeth text, material text,
  shade text, stump_shade text, description text, rush boolean, model boolean, revisions jsonb,
  partner_price numeric, patient_age int, patient_sex text, patient_name text, patient_phone text,
  patient_email text, open_questions int, shared_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select s.id, j.id, j.job_code, s.owner_org, c.name, s.case_type, 'partial'::text, s.role, s.assigned_stages,
         j.status,
         public.share_is_active(s) and j.status = any(s.assigned_stages) and public.has_perm('jobs.write'),
         public.next_stage(s.owner_org, j.status),
         j.kuupaev, j.valmis_aeg, public.redact_identity(j.too, t.terms),
         public.redact_identity_json(public.partner_work_items(j.work_items), t.terms),
         public.redact_identity(j.hambad, t.terms), public.redact_identity(j.materjal, t.terms),
         public.redact_identity(j.varv, t.terms), public.redact_identity(j.kondivarv, t.terms),
         public.redact_identity(j.kirjeldus, t.terms), j.kiirtoo, coalesce(j.mudel, false),
         public.redact_identity_json(public.partner_revisions(j.revisions), t.terms),
         s.partner_price,
         case when pt.synniaeg is not null then date_part('year', age(pt.synniaeg))::int end,
         null::text,
         null::text, null::text, null::text,
         (select count(*)::int from public.messages m join public.channels ch on ch.id = m.channel_id
           where ch.job_id = j.id and ch.kind = 'too' and m.is_question and m.resolved_at is null
             and m.deleted_at is null and public.partner_sees(m.author_org, m.created_at, s)),
         s.created_at
    from public.job_share s
    join public.partnership p on p.id = s.partnership_id
    join public.jobs j on j.id = s.job_id
    join public.clinics c on c.id = s.owner_org
    left join public.patients pt on pt.id = j.patient_id
    cross join lateral (select public.identity_terms(j.patient_id, j.patsient) as terms) t
   where s.partner_org = public.my_org_id()
     and s.revoked_at is null
     and public.has_perm('jobs.read')
     and (p.status in ('active', 'suspended') or (p.status = 'ended' and p.readonly_until > now()))
$$;

/** As sql/085; a partner reads every body redacted. */
create or replace function public.job_thread(p_job uuid)
returns table (id uuid, body text, author_id uuid, author_name text, author_org text,
               is_question boolean, resolved_at timestamptz, created_at timestamptz, edited_at timestamptz,
               mine boolean, file_id uuid, file_name text, file_type text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_own   boolean := public.can_read_own_job(p_job);
  s       public.job_share;
  v_terms text[];
begin
  if not v_own then
    s := public.my_share(p_job);
    if s.id is null then
      raise exception 'Job not found' using errcode = '42501';
    end if;
    v_terms := public.job_identity_terms(p_job);
  end if;
  return query
    select m.id,
           case when m.deleted_at is not null then ''
                when v_own then m.body
                else public.redact_identity(m.body, v_terms) end,
           m.author_id,
           pr.full_name, c.name, m.is_question, m.resolved_at, m.created_at, m.edited_at,
           m.author_id = auth.uid(),
           f.id, f.file_name, f.type
      from public.messages m
      join public.channels ch on ch.id = m.channel_id and ch.kind = 'too'
      left join public.profiles pr on pr.id = m.author_id
      left join public.clinics c on c.id = m.author_org
      left join public.job_file f on f.id = m.file_id and f.deleted_at is null
     where ch.job_id = p_job
       and (v_own or public.partner_sees(m.author_org, m.created_at, s))
     order by m.created_at;
end;
$$;
