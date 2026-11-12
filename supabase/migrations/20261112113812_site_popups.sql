create table private.site_popups (
 id uuid primary key default gen_random_uuid(),
 title text not null check (char_length(btrim(title)) between 2 and 120),
 body text not null check (char_length(btrim(body)) between 1 and 8000),
 close_options text[] not null default array['once','today','forever']::text[]
  check (cardinality(close_options) between 1 and 3 and close_options <@ array['once','today','forever']::text[] and 'once'=any(close_options)),
 is_active boolean not null default true,
 revision integer not null default 1 check(revision>0),
 created_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index site_popups_active on private.site_popups(created_at desc,id) where is_active;
create index site_popups_creator on private.site_popups(created_by);
alter table private.site_popups enable row level security;
revoke all on private.site_popups from public,anon,authenticated;

-- This projection is intentionally public: administrators explicitly publish site-entry notices.
-- No creator, membership, inactive drafts or audit records can be returned.
create function private.site_popups() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(item order by created_at desc,id),'[]'::jsonb)
 from(select id,created_at,jsonb_build_object('id',id,'title',title,'body',body,'close_options',close_options,'revision',revision) as item
      from private.site_popups where is_active order by created_at desc,id limit 3) p
$$;
create function public.site_popups() returns jsonb language sql security invoker set search_path='' as $$select private.site_popups()$$;
grant usage on schema private to anon;
revoke all on function private.site_popups() from public;
revoke all on function public.site_popups() from public;
grant execute on function private.site_popups(),public.site_popups() to anon,authenticated;

create function private.manage_popups(p_action text,p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 u uuid:=auth.uid(); me jsonb; current_popup private.site_popups;
 v_id uuid; v_title text; v_body text; v_options text[]; v_active boolean;
begin
 -- Reuse the full live-user/session/account/role guard; never trust request metadata.
 me:=private.community('me','{}');
 if (me->>'is_admin')::boolean is distinct from true then raise exception 'FORBIDDEN';end if;
 if exists(select 1 from private.profiles where id=u and suspended_until>now()) then raise exception 'SUSPENDED';end if;
 if p_payload is null or jsonb_typeof(p_payload)<>'object' or pg_column_size(p_payload)>40000 then raise exception 'INVALID_INPUT';end if;
 if p_action='list' then
  return coalesce((select jsonb_agg(to_jsonb(p)-'created_by' order by created_at desc,id) from(select * from private.site_popups order by created_at desc,id limit 100)p),'[]'::jsonb);
 end if;
 if p_action not in ('save','delete') then raise exception 'INVALID_INPUT';end if;
 perform private.consume_rate(u,'popup_writes',30,600);
 -- Serialize activation and creation so the three-active-popup bound also holds under concurrency.
 perform pg_advisory_xact_lock(8407,1001);
 v_id:=nullif(p_payload->>'id','')::uuid;
 if v_id is not null then
  select * into current_popup from private.site_popups where id=v_id for update;
  if not found then raise exception 'NOT_FOUND';end if;
  if current_popup.revision is distinct from (p_payload->>'revision')::integer then raise exception 'STALE_POPUP';end if;
 end if;
 if p_action='delete' then
  if v_id is null then raise exception 'INVALID_INPUT';end if;
  delete from private.site_popups where id=v_id;
 else
  v_title:=btrim(p_payload->>'title');v_body:=btrim(p_payload->>'body');
  if jsonb_typeof(p_payload->'close_options') is distinct from 'array' then raise exception 'INVALID_INPUT';end if;
  select array_agg(value order by value) into v_options from(select distinct value from jsonb_array_elements_text(p_payload->'close_options')) options;
  if v_options is null or not ('once'=any(v_options)) or not (v_options <@ array['once','today','forever']::text[]) then raise exception 'INVALID_INPUT';end if;
  v_active:=coalesce((p_payload->>'is_active')::boolean,true);
  if v_active and (v_id is null or not current_popup.is_active) and (select count(*) from private.site_popups where is_active)>=3 then raise exception 'POPUP_LIMIT';end if;
  if v_id is null then
   if (select count(*) from private.site_popups)>=100 then raise exception 'POPUP_STORAGE_LIMIT';end if;
   insert into private.site_popups(title,body,close_options,is_active,created_by) values(v_title,v_body,v_options,v_active,u) returning id into v_id;
  else
   update private.site_popups set title=v_title,body=v_body,close_options=v_options,is_active=v_active,updated_at=now(),
    revision=revision+case when row(title,body,close_options) is distinct from row(v_title,v_body,v_options) then 1 else 0 end
    where id=v_id;
  end if;
 end if;
 insert into private.admin_audit_logs(actor_id,action,target_id) values(u,'popup_'||p_action,v_id);
 return jsonb_build_object('ok',true,'id',v_id);
end $$;
create function public.manage_popups(p_action text,p_payload jsonb default '{}') returns jsonb
language sql security invoker set search_path='' as $$select private.manage_popups(p_action,p_payload)$$;
revoke all on function private.manage_popups(text,jsonb),public.manage_popups(text,jsonb) from public,anon;
grant execute on function private.manage_popups(text,jsonb),public.manage_popups(text,jsonb) to authenticated;
