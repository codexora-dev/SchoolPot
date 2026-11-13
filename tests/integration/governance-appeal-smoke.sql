-- Explicit deployment QA only. The target must be the unique, recently created
-- deployqa fixture carrying the exact QA sanction marker; never a real member.
begin;
do $$begin
 if (select count(*) from private.profiles p join private.account_handles h on h.user_id=p.id where h.username like 'deployqa%' and p.created_at>now()-interval '30 minutes' and exists(select 1 from private.sanctions s where s.target_id=p.id and s.reason='배포 검증용 임시 계정 · 실제 회원 제재가 아닙니다.'))<>1 then raise exception 'QA_FIXTURE_NOT_UNIQUE';end if;
end $$;
select set_config('schoolpot.qa.subject',(select p.id::text from private.profiles p join private.account_handles h on h.user_id=p.id where h.username like 'deployqa%' and p.created_at>now()-interval '30 minutes' and exists(select 1 from private.sanctions s where s.target_id=p.id and s.reason='배포 검증용 임시 계정 · 실제 회원 제재가 아닙니다.')),true);
select set_config('schoolpot.qa.revision',(select sanction_revision::text from private.profiles where id=current_setting('schoolpot.qa.subject')::uuid),true),set_config('schoolpot.qa.username',(select username from private.account_handles where user_id=current_setting('schoolpot.qa.subject')::uuid),true);
select set_config('schoolpot.qa.owner',(select jsonb_build_object('sub',s.user_id,'session_id',s.id,'role','authenticated')::text from auth.sessions s join private.user_roles r on r.user_id=s.user_id where r.role='owner' order by s.created_at desc limit 1),true),set_config('schoolpot.qa.moderator',(select jsonb_build_object('sub',s.user_id,'session_id',s.id,'role','authenticated')::text from auth.sessions s join private.user_roles r on r.user_id=s.user_id where r.role='moderator' order by s.created_at desc limit 1),true);
set local role authenticated;
select set_config('request.jwt.claims',current_setting('schoolpot.qa.moderator'),true),set_config('request.jwt.claim.sub',(current_setting('schoolpot.qa.moderator')::jsonb)->>'sub',true);
do $$declare a jsonb;begin
 select value into a from jsonb_array_elements(public.governance('appeals')) where value->>'target_id'=current_setting('schoolpot.qa.subject');
 if a is null then raise exception 'QA_MOD_APPEAL_NOT_VISIBLE';end if;
 perform public.governance('reply_appeal',jsonb_build_object('id',a->>'id','revision',a->'revision','status','reviewing','reply','임시 QA 답변 검사 · 전체 롤백'));
 if exists(select 1 from jsonb_array_elements(public.feedback('admin_list')) f where f->>'nickname'=current_setting('schoolpot.qa.username')) then raise exception 'QA_MOD_SENSITIVE_FEEDBACK_VISIBLE';end if;
 begin perform public.governance('release',jsonb_build_object('target_id',current_setting('schoolpot.qa.subject'),'revision',current_setting('schoolpot.qa.revision')::int,'reason','임시 QA 권한 검사'));raise exception 'QA_MOD_RELEASE_ALLOWED';exception when others then if sqlerrm not like '%FORBIDDEN%' then raise;end if;end;
end $$;
select set_config('request.jwt.claims',current_setting('schoolpot.qa.owner'),true),set_config('request.jwt.claim.sub',(current_setting('schoolpot.qa.owner')::jsonb)->>'sub',true);
do $$declare members jsonb;begin
 if not exists(select 1 from jsonb_array_elements(public.governance('appeals')) a where a->>'target_id'=current_setting('schoolpot.qa.subject')) then raise exception 'QA_OWNER_APPEAL_NOT_VISIBLE';end if;
 if not exists(select 1 from jsonb_array_elements(public.feedback('admin_list')) f where f->>'nickname'=current_setting('schoolpot.qa.username')) then raise exception 'QA_OWNER_RIGHTS_NOT_VISIBLE';end if;
 perform public.governance('release',jsonb_build_object('target_id',current_setting('schoolpot.qa.subject'),'revision',current_setting('schoolpot.qa.revision')::int,'reason','임시 QA 해제 검사 · 전체 롤백'));
 members:=public.governance('members',jsonb_build_object('query',current_setting('schoolpot.qa.subject')));
 if jsonb_array_length(members)<>1 or (members->0->>'restricted')::boolean then raise exception 'QA_RELEASE_FAILED';end if;
end $$;
rollback;
select jsonb_build_object('status','Both administrator appeal access, moderator reply, sensitive inquiry isolation, owner-only release and member lookup passed; all changes rolled back.',
 'notification_ids',(select coalesce(jsonb_agg(n.id),'[]') from private.notifications n where
 (n.governance_kind in ('appeal','appeal_admin') and exists(select 1 from private.sanction_appeals a join private.sanctions s on s.id=a.sanction_id where s.reason='배포 검증용 임시 계정 · 실제 회원 제재가 아닙니다.' and n.xmin=a.xmin)) or
 (n.governance_kind='rights' and exists(select 1 from private.feedback f join private.sanctions s on s.target_id=f.author_id where s.reason='배포 검증용 임시 계정 · 실제 회원 제재가 아닙니다.' and n.xmin=f.xmin)))) result;
