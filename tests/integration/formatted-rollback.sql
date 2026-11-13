-- Hosted PostgreSQL integration check. All writes, sessions and notifications roll back.
-- JWT claims are test fixtures, not a hosted Auth/PostgREST authentication test.
begin;
do $$
declare u uuid; s uuid:=gen_random_uuid(); yr int; g int; pv int;
begin
 select r.user_id into u from private.user_roles r join private.account_handles h on h.user_id=r.user_id join private.profiles p on p.id=r.user_id where r.role='admin' and p.suspended_until is null limit 1;
 if u is null then raise exception 'Existing active admin required';end if;
 select school_year, (select min(i) from generate_subscripts(counts,1)i where counts[i]>0) into yr,g from private.class_settings;
 if g is null then raise exception 'Configured classes required';end if;
 select version into pv from private.privacy_policy;
 insert into auth.sessions(id,user_id) values(s,u);
 insert into private.memberships(user_id,school_year,grade,class_number,policy_version,collection_basis) values(u,yr,g,1,pv,'service_contract')
 on conflict(user_id) do update set school_year=excluded.school_year,grade=excluded.grade,class_number=excluded.class_number;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'session_id',s,'role','authenticated')::text,true);
 perform set_config('request.jwt.claim.sub',u::text,true);
 perform set_config('request.jwt.claim.role','authenticated',true);
end $$;
set local role authenticated;
do $$
declare f text; n jsonb; p jsonb; row_data jsonb; active boolean; denied boolean:=false;
begin
 foreach f in array array['text','markdown','html'] loop
  n:=public.community('admin_notice',jsonb_build_object('title','서식 롤백 확인','body','**본문** <b>안내</b>','content_format',f));
  select item into row_data from jsonb_array_elements(public.community('notices','{}'))item where item->>'id'=n->>'id';
  if row_data->>'content_format' is distinct from f or row_data ? 'author_id' then raise exception 'Notice projection failed';end if;
  row_data:=public.community('get_notice',jsonb_build_object('id',n->>'id'));
  if row_data->>'content_format' is distinct from f or row_data ? 'author_id' then raise exception 'Notice detail failed';end if;
 end loop;
 if not exists(select 1 from jsonb_array_elements(public.community('notice_list',jsonb_build_object('query','서식 롤백 확인')))item where item->>'id'=n->>'id' and not(item ? 'body') and not(item ? 'author_id')) then raise exception 'Notice list projection failed';end if;
 active:=jsonb_array_length(public.site_popups())<3;
 p:=public.manage_popups('save',jsonb_build_object('title','서식 롤백 확인','body','**안내**','content_format','markdown','close_options',jsonb_build_array('once'),'is_active',active));
 select item into row_data from jsonb_array_elements(public.manage_popups('list','{}'))item where item->>'id'=p->>'id';
 if row_data->>'content_format' is distinct from 'markdown' then raise exception 'Popup format failed';end if;
 perform public.manage_popups('save',row_data||jsonb_build_object('content_format','html'));
 if active and not exists(select 1 from jsonb_array_elements(public.site_popups())item where item->>'id'=p->>'id' and item->>'content_format'='html' and (item->>'revision')::int=(row_data->>'revision')::int+1 and not(item ? 'created_by')) then raise exception 'Public popup format/revision failed';end if;
 begin
  perform public.community('admin_notice',jsonb_build_object('title','거부 확인','body','내용','content_format','script'));
 exception when raise_exception then
  if sqlerrm<>'INVALID_INPUT' then raise;end if;denied:=true;
 end;
 if not denied then raise exception 'Invalid format accepted';end if;
end $$;
reset role;
rollback;
select 'Hosted PostgreSQL format/RPC checks passed; all writes rolled back' as result;
