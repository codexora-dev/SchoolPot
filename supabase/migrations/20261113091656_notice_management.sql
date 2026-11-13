alter table private.notices
 add column revision integer not null default 1 check(revision>0),
 add column updated_at timestamptz not null default now();
update private.notices set updated_at=created_at;

create function private.manage_notices(p_action text,p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); me jsonb; current_notice private.notices; v_id uuid; v_title text; v_body text; v_format text; result jsonb;
begin
 me:=private.community('me','{}');
 if (me->>'is_admin')::boolean is distinct from true then raise exception 'FORBIDDEN';end if;
 if exists(select 1 from private.profiles where id=u and suspended_until>now()) then raise exception 'SUSPENDED';end if;
 if p_payload is null or jsonb_typeof(p_payload)<>'object' or pg_column_size(p_payload)>60000 then raise exception 'INVALID_INPUT';end if;
 if p_action='list' then
  return coalesce((select jsonb_agg(to_jsonb(n) order by n.created_at desc,n.id desc) from (
   select id,title,content_format,created_at,updated_at,revision from private.notices
   where position(lower(left(coalesce(p_payload->>'query',''),120)) in lower(title))>0
   order by created_at desc,id desc limit 20 offset least(greatest(coalesce((p_payload->>'offset')::int,0),0),10000)
  )n),'[]'::jsonb);
 end if;
 if p_action not in ('get','save','delete') then raise exception 'INVALID_INPUT';end if;
 v_id:=nullif(p_payload->>'id','')::uuid;
 if p_action='get' then
  select to_jsonb(n)-'author_id' into result from private.notices n where id=v_id;
  if not found then raise exception 'NOT_FOUND';end if;return result;
 end if;
 perform private.consume_rate(u,'notice_writes',30,600);
 if v_id is not null then
  select * into current_notice from private.notices where id=v_id for update;
  if not found then raise exception 'NOT_FOUND';end if;
  if current_notice.revision is distinct from (p_payload->>'revision')::integer then raise exception 'STALE_NOTICE';end if;
 end if;
 if p_action='delete' then
  if v_id is null then raise exception 'INVALID_INPUT';end if;
  delete from private.notices where id=v_id;
 else
  v_title:=btrim(p_payload->>'title');v_body:=btrim(p_payload->>'body');v_format:=coalesce(p_payload->>'content_format','text');
  if v_title is null or char_length(v_title) not between 2 and 120 or v_body is null or char_length(v_body) not between 1 and 20000 or v_format not in ('text','markdown','html') then raise exception 'INVALID_INPUT';end if;
  if v_id is null then
   -- The existing creation path alone sends the new-notice notification.
   return private.community('admin_notice',p_payload);
  end if;
  update private.notices set title=v_title,body=v_body,content_format=v_format,updated_at=now(),revision=revision+1 where id=v_id;
 end if;
 insert into private.admin_audit_logs(actor_id,action,target_id) values(u,'notice_'||p_action,v_id);
 return jsonb_build_object('ok',true,'id',v_id);
end $$;
create function public.manage_notices(p_action text,p_payload jsonb default '{}') returns jsonb
language sql security invoker set search_path='' as $$select private.manage_notices(p_action,p_payload)$$;
revoke all on function private.manage_notices(text,jsonb),public.manage_notices(text,jsonb) from public,anon;
grant execute on function private.manage_notices(text,jsonb),public.manage_notices(text,jsonb) to authenticated;
