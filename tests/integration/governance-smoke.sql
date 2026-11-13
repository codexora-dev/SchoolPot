-- Run only on the explicitly approved project. All audit/rate writes are rolled back.
-- Existing session rows are used for DB dispatch verification, not external JWT authentication.
begin;
select set_config('schoolpot.qa.owner', (select jsonb_build_object('sub',s.user_id,'session_id',s.id,'role','authenticated')::text from auth.sessions s join private.user_roles r on r.user_id=s.user_id where r.role='owner' order by s.created_at desc limit 1),true);
select set_config('schoolpot.qa.moderator', (select jsonb_build_object('sub',s.user_id,'session_id',s.id,'role','authenticated')::text from auth.sessions s join private.user_roles r on r.user_id=s.user_id where r.role='moderator' order by s.created_at desc limit 1),true);
select set_config('schoolpot.qa.member', (select jsonb_build_object('sub',s.user_id,'session_id',s.id,'role','authenticated')::text from auth.sessions s join private.profiles p on p.id=s.user_id join private.memberships m on m.user_id=s.user_id where not exists(select 1 from private.user_roles r where r.user_id=s.user_id) and (p.suspended_until is null or p.suspended_until<=now()) order by s.created_at desc limit 1),true);
set local role authenticated;
select set_config('request.jwt.claims',current_setting('schoolpot.qa.owner'),true),set_config('request.jwt.claim.sub',(current_setting('schoolpot.qa.owner')::jsonb)->>'sub',true);
do $$begin
 if public.community('me')->>'role' is distinct from 'owner' then raise exception 'QA_OWNER_ROLE';end if;
 if public.community('admin_stats')->>'members' is null then raise exception 'QA_OWNER_STATS';end if;
 if jsonb_array_length(public.governance('members',jsonb_build_object('query',auth.uid()::text)))<>1 then raise exception 'QA_OWNER_LOOKUP';end if;
 if jsonb_array_length(public.governance('roles'))<>2 then raise exception 'QA_OWNER_ROLES';end if;
 begin perform public.community('delete_account_access');raise exception 'QA_OWNER_DELETE_ALLOWED';exception when others then if sqlerrm not like '%OWNER_TRANSFER_REQUIRED%' then raise;end if;end;
end $$;
select set_config('request.jwt.claims',current_setting('schoolpot.qa.moderator'),true),set_config('request.jwt.claim.sub',(current_setting('schoolpot.qa.moderator')::jsonb)->>'sub',true);
do $$begin
 if public.community('me')->>'role' is distinct from 'moderator' then raise exception 'QA_MODERATOR_ROLE';end if;
 if public.community('admin_stats')->>'members' is null then raise exception 'QA_MODERATOR_STATS';end if;
 if jsonb_array_length(public.governance('targets',jsonb_build_object('query',auth.uid()::text)))<>1 then raise exception 'QA_MODERATOR_LOOKUP';end if;
 perform public.governance('requests');perform public.governance('appeals');perform public.manage_notices('list');
 begin perform public.governance('roles');raise exception 'QA_MODERATOR_ROLE_EDIT_ALLOWED';exception when others then if sqlerrm not like '%FORBIDDEN%' then raise;end if;end;
 begin perform public.governance('apply','{}');raise exception 'QA_MODERATOR_SANCTION_ALLOWED';exception when others then if sqlerrm not like '%FORBIDDEN%' then raise;end if;end;
 begin perform public.governance('release','{}');raise exception 'QA_MODERATOR_RELEASE_ALLOWED';exception when others then if sqlerrm not like '%FORBIDDEN%' then raise;end if;end;
 begin perform public.manage_boards('list');raise exception 'QA_MODERATOR_BOARDS_ALLOWED';exception when others then if sqlerrm not like '%FORBIDDEN%' then raise;end if;end;
 begin perform public.community('admin_audit');raise exception 'QA_MODERATOR_AUDIT_ALLOWED';exception when others then if sqlerrm not like '%FORBIDDEN%' then raise;end if;end;
end $$;
select set_config('request.jwt.claims',current_setting('schoolpot.qa.member'),true),set_config('request.jwt.claim.sub',(current_setting('schoolpot.qa.member')::jsonb)->>'sub',true);
do $$begin
 if public.community('me')->>'role' is distinct from 'member' then raise exception 'QA_MEMBER_ROLE';end if;
 perform public.governance('mine');
 begin perform public.community('admin_stats');raise exception 'QA_MEMBER_ADMIN_ALLOWED';exception when others then if sqlerrm not like '%FORBIDDEN%' then raise;end if;end;
 begin perform public.governance('requests');raise exception 'QA_MEMBER_REQUESTS_ALLOWED';exception when others then if sqlerrm not like '%FORBIDDEN%' then raise;end if;end;
 begin perform public.manage_notices('list');raise exception 'QA_MEMBER_NOTICES_ALLOWED';exception when others then if sqlerrm not like '%FORBIDDEN%' then raise;end if;end;
end $$;
rollback;
select 'Hosted PostgreSQL owner/moderator/member dispatcher checks passed; all changes rolled back.' result;
