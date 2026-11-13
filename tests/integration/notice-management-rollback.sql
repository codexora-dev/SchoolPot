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
declare saved jsonb; item jsonb; changed jsonb; denied boolean:=false;
begin
 saved:=public.manage_notices('save',jsonb_build_object('title','공지 관리 롤백 확인','body','**기존 내용**','content_format','markdown'));
 item:=public.manage_notices('get',jsonb_build_object('id',saved->>'id'));
 if item->>'content_format'<>'markdown' or (item->>'revision')::int<>1 or item ? 'author_id' then raise exception 'Create/get failed';end if;
 if not exists(select 1 from jsonb_array_elements(public.manage_notices('list',jsonb_build_object('query','공지 관리 롤백 확인')))n where n->>'id'=saved->>'id' and not(n ? 'body') and not(n ? 'author_id')) then raise exception 'List projection failed';end if;
 perform public.manage_notices('save',item||jsonb_build_object('title','수정된 공지 관리 롤백 확인','body','<strong>새 내용</strong>','content_format','html'));
 changed:=public.manage_notices('get',jsonb_build_object('id',saved->>'id'));
 if changed->>'title'<>'수정된 공지 관리 롤백 확인' or changed->>'body'<>'<strong>새 내용</strong>' or (changed->>'revision')::int<>2 or changed->>'created_at'<>item->>'created_at' then raise exception 'Update failed';end if;
 begin
  perform public.manage_notices('save',item);
 exception when raise_exception then
  if sqlerrm<>'STALE_NOTICE' then raise;end if;denied:=true;
 end;
 if not denied then raise exception 'Stale update accepted';end if;
 perform public.manage_notices('delete',jsonb_build_object('id',saved->>'id','revision',2));
 if exists(select 1 from jsonb_array_elements(public.manage_notices('list',jsonb_build_object('query','공지 관리 롤백 확인')))n where n->>'id'=saved->>'id') then raise exception 'Delete failed';end if;
end $$;
reset role;
rollback;
select 'Hosted notice management create/update/version/delete passed; all writes and notifications rolled back' as result;
