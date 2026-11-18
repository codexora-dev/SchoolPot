-- V2 is additive. Apply to production only after explicit deployment approval.
-- No role transfers, destructive resets, demo data or secrets.
-- Stop if the reviewed production role inventory has changed. Fresh databases have no assigned roles.
do $$begin
 if exists(select 1 from private.user_roles) and (
 (select count(*) from private.user_roles)<>2 or exists(select 1 from private.user_roles r left join private.account_handles h on h.user_id=r.user_id
 where h.username is null or not ((h.username='kminjae803' and r.role='owner') or (h.username='yoonjihoo_0221' and r.role='moderator')))) then raise exception 'UNREVIEWED_ADMIN';end if;
end $$;

alter table private.notifications
 add column type text not null default 'system',
 add column event_key text,
 add column notice_id uuid references private.notices(id) on delete cascade,
 add column comment_id uuid references private.comments(id) on delete cascade,
 add column important boolean not null default false;
alter table private.notifications add column updated_at timestamptz not null default now();
create unique index notifications_event_unique on private.notifications(user_id,event_key) where event_key is not null;
create index notifications_unread on private.notifications(user_id,created_at desc,id desc) where read_at is null;
alter table private.notices add column notify_members boolean not null default true;
alter table private.reports drop constraint reports_status_check;
alter table private.reports add constraint reports_status_check check(status in ('pending','reviewing','resolved','dismissed'));

create table private.notification_preferences(
 user_id uuid primary key references auth.users(id) on delete cascade,
 push_enabled boolean not null default false,
 comment_enabled boolean not null default true, reply_enabled boolean not null default true,
 mention_enabled boolean not null default true, notice_enabled boolean not null default true,
 subscription_enabled boolean not null default true, report_enabled boolean not null default true,
 quiet_hours_enabled boolean not null default false, quiet_hours_start time not null default '22:00',
 quiet_hours_end time not null default '07:00', timezone text not null default 'Asia/Seoul',
 mention_discoverable boolean not null default false, inbox_revision bigint not null default 0, revision integer not null default 1,
 check(not quiet_hours_enabled or quiet_hours_start<>quiet_hours_end)
);
create table private.post_subscriptions(
 user_id uuid references auth.users(id) on delete cascade,post_id uuid references private.posts(id) on delete cascade,
 created_at timestamptz not null default now(),primary key(user_id,post_id)
);
create index post_subscriptions_post on private.post_subscriptions(post_id);
create table private.bookmarks(
 user_id uuid references auth.users(id) on delete cascade,post_id uuid references private.posts(id) on delete cascade,
 created_at timestamptz not null default now(),primary key(user_id,post_id)
);
create index bookmarks_post on private.bookmarks(post_id);
create table private.mentions(
 id uuid primary key default gen_random_uuid(),actor_id uuid not null references auth.users(id) on delete cascade,
 recipient_id uuid not null references auth.users(id) on delete cascade,
 post_id uuid not null references private.posts(id) on delete cascade,
 comment_id uuid references private.comments(id) on delete cascade,
 created_at timestamptz not null default now()
);
create unique index mentions_post_unique on private.mentions(post_id,recipient_id) where comment_id is null;
create unique index mentions_comment_unique on private.mentions(comment_id,recipient_id) where comment_id is not null;
create index mentions_actor on private.mentions(actor_id);
create index mentions_recipient on private.mentions(recipient_id);
create table private.push_subscriptions(
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,
 session_id uuid not null references auth.sessions(id) on delete cascade,
 endpoint text not null unique check(char_length(endpoint) between 30 and 2048),
 p256dh text not null check(char_length(p256dh)=87),auth text not null check(char_length(auth)=22),
 device_name text not null default '브라우저' check(char_length(device_name) between 1 and 60),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),last_success_at timestamptz,disabled_at timestamptz
);
create index push_subscriptions_user on private.push_subscriptions(user_id);
create index push_subscriptions_session on private.push_subscriptions(session_id);
create table private.notification_deliveries(
 id uuid primary key default gen_random_uuid(),notification_id uuid not null references private.notifications(id) on delete cascade,
 subscription_id uuid not null references private.push_subscriptions(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 status text not null default 'pending' check(status in ('pending','sending','sent','skipped','failed')),
 attempts integer not null default 0,available_at timestamptz not null default now(),
 lease_token uuid,leased_until timestamptz,finished_at timestamptz,
 unique(notification_id,subscription_id)
);
create index deliveries_due on private.notification_deliveries(available_at) where status in ('pending','sending');
create index deliveries_subscription on private.notification_deliveries(subscription_id);
create index deliveries_user on private.notification_deliveries(user_id,finished_at desc);
create table private.notification_delivery_logs(
 id bigint generated always as identity primary key,delivery_id uuid not null references private.notification_deliveries(id) on delete cascade,
 attempt integer not null,status_code integer not null,created_at timestamptz not null default now(),unique(delivery_id,attempt)
);
create index delivery_logs_created on private.notification_delivery_logs(created_at);
alter table private.notification_preferences enable row level security;
alter table private.post_subscriptions enable row level security;
alter table private.bookmarks enable row level security;
alter table private.mentions enable row level security;
alter table private.push_subscriptions enable row level security;
alter table private.notification_deliveries enable row level security;
alter table private.notification_delivery_logs enable row level security;
revoke all on private.notification_preferences,private.post_subscriptions,private.bookmarks,private.mentions,private.push_subscriptions,private.notification_deliveries,private.notification_delivery_logs from public,anon,authenticated;

create function private.v2_inbox_change() returns trigger language plpgsql security definer set search_path='' as $$
declare u uuid;begin
 u:=case when tg_op='DELETE' then old.user_id else new.user_id end;
 if exists(select 1 from auth.users where id=u) then
 insert into private.notification_preferences(user_id,inbox_revision) values(u,1) on conflict(user_id) do update set inbox_revision=private.notification_preferences.inbox_revision+1;
 end if;
 if tg_op='DELETE' then return old;else return new;end if;
end $$;
create trigger v2_inbox_change after insert or update or delete on private.notifications for each row execute function private.v2_inbox_change();
revoke all on function private.v2_inbox_change() from public,anon,authenticated;
create function private.v2_appeal_limit() returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform 1 from private.sanctions where id=new.sanction_id for update;
 if (select count(*) from private.sanction_appeals where sanction_id=new.sanction_id and target_id=new.target_id)>=3 then raise exception 'RATE_LIMIT';end if;
 return new;
end $$;
create trigger v2_appeal_limit before insert on private.sanction_appeals for each row execute function private.v2_appeal_limit();
revoke all on function private.v2_appeal_limit() from public,anon,authenticated;

-- Internal helpers are never callable by clients, and never reveal an anonymous actor.
create function private.v2_post_access(p_id uuid,u uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.posts p join private.boards b on b.id=p.board_id
 where p.id=p_id and b.is_active and not exists(select 1 from private.user_blocks x where
 (x.user_id=u and x.blocked_id=p.author_id) or (x.blocked_id=u and x.user_id=p.author_id)))
$$;
create function private.v2_enabled(u uuid,k text) returns boolean language sql stable security definer set search_path='' as $$
 select case when k in ('sanction','release','appeal','system') then true else
 coalesce((select notifications_enabled from private.profiles where id=u),false) and
 coalesce((select case k when 'comment' then comment_enabled when 'reply' then reply_enabled when 'mention' then mention_enabled
 when 'notice' then notice_enabled when 'subscription' then subscription_enabled when 'report' then report_enabled else true end
 from private.notification_preferences where user_id=u),true) end
$$;
create function private.v2_notify(u uuid,k text,msg text,ev text,p uuid default null,c uuid default null,n uuid default null,urgent boolean default false) returns void
 language plpgsql security definer set search_path='' as $$
begin
 if u is null or not exists(select 1 from auth.users a join private.account_handles h on h.user_id=a.id join private.profiles f on f.id=a.id where a.id=u and a.deleted_at is null and not coalesce(a.is_anonymous,false)) then return;end if;
 if not private.v2_enabled(u,k) then return;end if;
 if k not in ('sanction','release','appeal','system') and (not exists(select 1 from private.memberships m join private.class_settings cs on m.school_year=cs.school_year where m.user_id=u and m.class_number<=cs.counts[m.grade]) or exists(select 1 from private.profiles where id=u and suspended_until>now())) then return;end if;
 if p is not null and not private.v2_post_access(p,u) then return;end if;
 insert into private.notifications(user_id,type,message,event_key,post_id,comment_id,notice_id,important)
 values(u,k,msg,ev,p,c,n,urgent) on conflict(user_id,event_key) where event_key is not null do nothing;
end $$;
create function private.v2_comment_event() returns trigger language plpgsql security definer set search_path='' as $$
declare target uuid;begin
 -- One event key per comment, including reply, subscription and mention conditions.
 select author_id into target from private.comments where id=new.parent_id;
 if target is distinct from new.author_id and not exists(select 1 from private.user_blocks where (user_id=target and blocked_id=new.author_id) or (blocked_id=target and user_id=new.author_id)) then
 perform private.v2_notify(target,'reply','작성하신 댓글에 새로운 답글이 달렸습니다.','comment:'||new.id,new.post_id,new.id);end if;
 select author_id into target from private.posts where id=new.post_id;
 if target is distinct from new.author_id and not exists(select 1 from private.user_blocks where (user_id=target and blocked_id=new.author_id) or (blocked_id=target and user_id=new.author_id)) then
 perform private.v2_notify(target,'comment','작성하신 게시글에 새로운 댓글이 달렸습니다.','comment:'||new.id,new.post_id,new.id);end if;
 for target in select user_id from private.post_subscriptions where post_id=new.post_id and user_id<>new.author_id loop
 if not exists(select 1 from private.user_blocks where (user_id=target and blocked_id=new.author_id) or (blocked_id=target and user_id=new.author_id)) then
 perform private.v2_notify(target,'subscription','구독 중인 게시글에 새로운 댓글이 등록되었습니다.','comment:'||new.id,new.post_id,new.id);end if;
 end loop;return new;
end $$;
create trigger v2_comment_event after insert on private.comments for each row execute function private.v2_comment_event();
create function private.v2_notice_event() returns trigger language plpgsql security definer set search_path='' as $$
declare target uuid;begin
 if new.notify_members then
 for target in select id from private.profiles where id is distinct from new.author_id loop
 perform private.v2_notify(target,'notice','새로운 공지사항이 등록되었습니다.','notice:'||new.id,null,null,new.id,new.owner_only);
 end loop;end if;return new;
end $$;
create trigger v2_notice_event after insert on private.notices for each row execute function private.v2_notice_event();
create function private.v2_report_event() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status is distinct from old.status and new.status in ('resolved','dismissed') and new.reporter_id is distinct from auth.uid() then
 perform private.v2_notify(new.reporter_id,'report','접수하신 신고의 처리가 완료되었습니다.','report:'||new.id||':'||new.revision);
 end if;return new;
end $$;
create trigger v2_report_event after update on private.reports for each row execute function private.v2_report_event();
create function private.v2_notification_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.user_id=auth.uid() and (new.feedback_id is not null or new.governance_kind in ('appeal_admin','request','rights')) then return null;end if;
 if new.governance_kind='sanction' then if new.type<>'release' then new.type:='sanction';end if;new.important:=true;
 elsif new.governance_kind='appeal' then new.type:='appeal';new.important:=true;end if;
 return new;
end $$;
create trigger v2_notification_guard before insert on private.notifications for each row execute function private.v2_notification_guard();
revoke all on function private.v2_notification_guard() from public,anon,authenticated;
create function private.v2_queue_event() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into private.notification_deliveries(notification_id,subscription_id,user_id,available_at)
 select new.id,s.id,new.user_id,now()+case when new.important or new.governance_kind is not null then interval '0 seconds' else interval '45 seconds' end
 from private.push_subscriptions s join private.notification_preferences p on p.user_id=s.user_id
 where s.user_id=new.user_id and s.disabled_at is null and p.push_enabled;
 return new;
end $$;
create trigger v2_queue_event after insert on private.notifications for each row execute function private.v2_queue_event();

alter table private.sanctions add column expiry_notified_at timestamptz;
create index sanctions_expiry_pending on private.sanctions(ends_at) where expiry_notified_at is null and revoked_at is null and kind in ('suspend','review');
create function private.v2_expire_sanctions() returns void language plpgsql security definer set search_path='' as $$
declare s record;begin
 for s in select id,target_id from private.sanctions where kind in ('suspend','review') and ends_at<=now() and revoked_at is null and expiry_notified_at is null limit 100 for update skip locked loop
 if not exists(select 1 from private.profiles where id=s.target_id and suspended_until>now()) then
 perform private.v2_notify(s.target_id,'release','회원님의 계정 이용 제한이 해제되었습니다.','expiry:'||s.id,null,null,null,true);
 end if;update private.sanctions set expiry_notified_at=now() where id=s.id;end loop;
end $$;

create function private.v2_mentions(u uuid,p uuid,c uuid,items jsonb) returns void language plpgsql security definer set search_path='' as $$
declare target uuid;new_id uuid;begin
 if items is null then return;end if;
 if jsonb_typeof(items)<>'array' or jsonb_array_length(items)>5 then raise exception 'INVALID_INPUT';end if;
 for target in select distinct value::uuid from jsonb_array_elements_text(items) loop
 if target=u then continue;end if;
 if exists(select 1 from private.mentions where actor_id=u and recipient_id=target and post_id=p and comment_id is not distinct from c) then continue;end if;
 if not exists(select 1 from private.notification_preferences pref join private.profiles f on f.id=pref.user_id join private.account_handles h on h.user_id=f.id join auth.users a on a.id=f.id where pref.user_id=target and pref.mention_discoverable and a.deleted_at is null and not coalesce(a.is_anonymous,false) and (f.suspended_until is null or f.suspended_until<=now()))
 or not private.v2_post_access(p,target) or exists(select 1 from private.user_blocks where (user_id=u and blocked_id=target) or (user_id=target and blocked_id=u)) then raise exception 'INVALID_INPUT';end if;
 insert into private.mentions(actor_id,recipient_id,post_id,comment_id) values(u,target,p,c) on conflict do nothing returning id into new_id;
 if new_id is not null then
 perform private.consume_rate(u,'mentions',20,3600);
 perform private.v2_notify(target,'mention','다른 사용자가 회원님을 언급했습니다.',case when c is null then 'post:'||p else 'comment:'||c end,p,c);
 end if;new_id:=null;
 end loop;
end $$;

create function private.v2(p_action text,p_payload jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();r text:=private.actor_role(); v_id uuid; p_id uuid; result jsonb; pref private.notification_preferences; sub private.push_subscriptions; n integer; off integer;begin
 if p_payload is null or jsonb_typeof(p_payload)<>'object' or pg_column_size(p_payload)>30000 then raise exception 'INVALID_INPUT';end if;
 if exists(select 1 from private.profiles where id=u and suspended_until>now()) then raise exception 'SUSPENDED';end if;
 perform private.require_membership(u);
 perform private.consume_rate(u,'v2',120,60);
 off:=least(greatest(coalesce((p_payload->>'offset')::int,0),0),10000);
 if p_action in ('notifications','unread') then
 perform private.v2_expire_sanctions();
 select count(*) into n from private.notifications t where t.user_id=u and t.read_at is null and (t.post_id is null or private.v2_post_access(t.post_id,u)) and not exists(select 1 from private.comments c join private.user_blocks b on (b.user_id=u and b.blocked_id=c.author_id) or (b.blocked_id=u and b.user_id=c.author_id) where c.id=t.comment_id);
 if p_action='unread' then return jsonb_build_object('unread',n,'version',coalesce((select inbox_revision from private.notification_preferences where user_id=u),0));end if;
 return jsonb_build_object('unread',n,'items',coalesce((select jsonb_agg(item order by created_at desc,id desc) from(
 select t.created_at,t.id,jsonb_build_object('id',t.id,'message',t.message,'type',t.type,'post_id',t.post_id,'comment_id',t.comment_id,'notice_id',t.notice_id,'feedback_id',t.feedback_id,'governance_kind',t.governance_kind,'important',t.important,'created_at',t.created_at,'read_at',t.read_at) item
 from private.notifications t where t.user_id=u and (t.post_id is null or private.v2_post_access(t.post_id,u)) and not exists(select 1 from private.comments c join private.user_blocks b on (b.user_id=u and b.blocked_id=c.author_id) or (b.blocked_id=u and b.user_id=c.author_id) where c.id=t.comment_id) order by t.created_at desc,t.id desc limit 20 offset off)a),'[]'::jsonb));
 elsif p_action in ('read','unread_one','delete') then
 v_id:=nullif(p_payload->>'id','')::uuid;
 if v_id is null and p_action<>'read' then raise exception 'INVALID_INPUT';end if;
 if p_action='delete' then delete from private.notifications where user_id=u and id=v_id;
 else update private.notifications set read_at=case when p_action='unread_one' then null else now() end where user_id=u and (v_id is null or id=v_id);end if;
 return jsonb_build_object('ok',true);
 elsif p_action in ('preferences','save_preferences') then
 insert into private.notification_preferences(user_id) values(u) on conflict do nothing;
 select * into pref from private.notification_preferences where user_id=u for update;
 if p_action='save_preferences' then
 if pref.revision is distinct from (p_payload->>'revision')::int then raise exception 'STALE_CHANGE';end if;
 if not exists(select 1 from pg_timezone_names where name=coalesce(p_payload->>'timezone','Asia/Seoul')) then raise exception 'INVALID_INPUT';end if;
 update private.notification_preferences set
 push_enabled=coalesce((p_payload->>'push_enabled')::boolean,pref.push_enabled),
 comment_enabled=coalesce((p_payload->>'comment_enabled')::boolean,pref.comment_enabled),reply_enabled=coalesce((p_payload->>'reply_enabled')::boolean,pref.reply_enabled),
 mention_enabled=coalesce((p_payload->>'mention_enabled')::boolean,pref.mention_enabled),notice_enabled=coalesce((p_payload->>'notice_enabled')::boolean,pref.notice_enabled),
 subscription_enabled=coalesce((p_payload->>'subscription_enabled')::boolean,pref.subscription_enabled),report_enabled=coalesce((p_payload->>'report_enabled')::boolean,pref.report_enabled),
 mention_discoverable=coalesce((p_payload->>'mention_discoverable')::boolean,pref.mention_discoverable),
 quiet_hours_enabled=coalesce((p_payload->>'quiet_hours_enabled')::boolean,pref.quiet_hours_enabled),
 quiet_hours_start=coalesce((p_payload->>'quiet_hours_start')::time,pref.quiet_hours_start),quiet_hours_end=coalesce((p_payload->>'quiet_hours_end')::time,pref.quiet_hours_end),
 timezone=coalesce(p_payload->>'timezone',pref.timezone),revision=revision+1 where user_id=u returning * into pref;
 end if;return to_jsonb(pref)-'user_id';
 elsif p_action in ('bookmark','subscribe','post_state') then
 p_id:=(p_payload->>'post_id')::uuid;
 if not private.v2_post_access(p_id,u) then raise exception 'NOT_FOUND';end if;
 if p_action='bookmark' then
 if (p_payload->>'enabled')::boolean then insert into private.bookmarks(user_id,post_id) values(u,p_id) on conflict do nothing;else delete from private.bookmarks where user_id=u and post_id=p_id;end if;
 elsif p_action='subscribe' then
 if (p_payload->>'enabled')::boolean then insert into private.post_subscriptions(user_id,post_id) values(u,p_id) on conflict do nothing;else delete from private.post_subscriptions where user_id=u and post_id=p_id;end if;end if;
 return jsonb_build_object('bookmarked',exists(select 1 from private.bookmarks where user_id=u and post_id=p_id),'subscribed',exists(select 1 from private.post_subscriptions where user_id=u and post_id=p_id));
 elsif p_action='activity' then
 if coalesce(p_payload->>'kind','posts') not in ('posts','comments','bookmarks','subscriptions','reports') then raise exception 'INVALID_INPUT';end if;
 if p_payload->>'kind'='reports' then
 return coalesce((select jsonb_agg(jsonb_build_object('id',id,'status',status,'created_at',created_at,'resolution_reason',case when status in ('resolved','dismissed') then '신고 검토를 완료했습니다. 다른 회원의 비공개 정보는 제공하지 않습니다.' else '' end) order by created_at desc,id desc) from(select id,status,created_at,resolution_reason from private.reports where reporter_id=u order by created_at desc,id desc limit 20 offset off)t),'[]'::jsonb);
 elsif p_payload->>'kind'='comments' then
 return coalesce((select jsonb_agg(jsonb_build_object('id',id,'post_id',post_id,'body',body,'created_at',created_at) order by created_at desc,id desc) from(select c.* from private.comments c where c.author_id=u and private.v2_post_access(c.post_id,u) order by created_at desc,id desc limit 20 offset off)t),'[]'::jsonb);
 end if;
 return coalesce((select jsonb_agg(private.post_json(p,u) order by p.created_at desc,p.id desc) from(
 select p.* from private.posts p where private.v2_post_access(p.id,u) and case coalesce(p_payload->>'kind','posts')
 when 'bookmarks' then exists(select 1 from private.bookmarks where user_id=u and post_id=p.id)
 when 'subscriptions' then exists(select 1 from private.post_subscriptions where user_id=u and post_id=p.id) else p.author_id=u end
 order by p.created_at desc,p.id desc limit 20 offset off)p),'[]'::jsonb);
 elsif p_action='mention_search' then
 if char_length(btrim(coalesce(p_payload->>'query','')))<2 then return '[]';end if;
 perform private.consume_rate(u,'mention_search',30,60);
 return coalesce((select jsonb_agg(jsonb_build_object('id',candidate.id,'nickname',candidate.nickname)) from (select f.id,f.nickname from private.profiles f join auth.users a on a.id=f.id and a.deleted_at is null and not coalesce(a.is_anonymous,false) join private.account_handles h on h.user_id=f.id join private.notification_preferences directory_pref on directory_pref.user_id=f.id join private.memberships m on m.user_id=f.id join private.class_settings cs on m.school_year=cs.school_year where directory_pref.mention_discoverable and f.id<>u and (f.suspended_until is null or f.suspended_until<=now()) and position(lower(left(p_payload->>'query',40)) in lower(f.nickname))>0 and not exists(select 1 from private.user_blocks where (user_id=u and blocked_id=f.id) or (user_id=f.id and blocked_id=u)) and m.class_number<=cs.counts[m.grade] order by f.nickname,f.id limit 10)candidate),'[]'::jsonb);
 elsif p_action='member_profile' then
 v_id:=(p_payload->>'id')::uuid;
 if not exists(select 1 from private.notification_preferences pref2 join private.profiles f on f.id=pref2.user_id join auth.users a on a.id=f.id and a.deleted_at is null and not coalesce(a.is_anonymous,false) join private.account_handles h on h.user_id=f.id join private.memberships m on m.user_id=f.id join private.class_settings cs on cs.school_year=m.school_year where pref2.user_id=v_id and pref2.mention_discoverable and (f.suspended_until is null or f.suspended_until<=now()) and m.class_number<=cs.counts[m.grade]) or exists(select 1 from private.user_blocks where (user_id=u and blocked_id=v_id) or (user_id=v_id and blocked_id=u)) then raise exception 'NOT_FOUND';end if;
 return jsonb_build_object('nickname',(select nickname from private.profiles where id=v_id),'posts',coalesce((select jsonb_agg(private.post_json(p,u)) from(select * from private.posts where author_id=v_id and not anonymous and private.v2_post_access(id,u) order by created_at desc limit 20)p),'[]'::jsonb));
 elsif p_action='push_save' then
 perform private.consume_rate(u,'push_writes',20,3600);
 if p_payload->>'endpoint' !~ '^https://(fcm[.]googleapis[.]com|updates[.]push[.]services[.]mozilla[.]com|web[.]push[.]apple[.]com|[a-z0-9-]+[.]notify[.]windows[.]com|[a-z0-9-]+[.]push[.]mozilla[.]com)/' or p_payload->>'p256dh' !~ '^[A-Za-z0-9_-]{87}$' or p_payload->>'auth' !~ '^[A-Za-z0-9_-]{22}$' then raise exception 'INVALID_INPUT';end if;
 if (select count(*) from private.push_subscriptions where user_id=u and disabled_at is null)>=10 and not exists(select 1 from private.push_subscriptions where user_id=u and endpoint=p_payload->>'endpoint') then raise exception 'RATE_LIMIT';end if;
 insert into private.push_subscriptions(user_id,session_id,endpoint,p256dh,auth,device_name) values(u,(auth.jwt()->>'session_id')::uuid,p_payload->>'endpoint',p_payload->>'p256dh',p_payload->>'auth',left(coalesce(p_payload->>'device_name','브라우저'),60))
 on conflict(endpoint) do update set session_id=excluded.session_id,p256dh=excluded.p256dh,auth=excluded.auth,device_name=excluded.device_name,disabled_at=null,updated_at=now() where private.push_subscriptions.user_id=u
 returning * into sub;
 if sub.id is null then raise exception 'FORBIDDEN';end if;
 return jsonb_build_object('id',sub.id);
 elsif p_action='push_devices' then
 return coalesce((select jsonb_agg(jsonb_build_object('id',id,'device_name',device_name,'created_at',created_at,'last_success_at',last_success_at,'disabled_at',disabled_at,'current_session',session_id=(auth.jwt()->>'session_id')::uuid) order by created_at desc) from private.push_subscriptions where user_id=u),'[]'::jsonb);
 elsif p_action='push_delete' then
 delete from private.push_subscriptions where user_id=u and (id=nullif(p_payload->>'id','')::uuid or endpoint=p_payload->>'endpoint');return jsonb_build_object('ok',true);
 elsif p_action='delivery_stats' then
 if r<>'owner' then raise exception 'FORBIDDEN';end if;
 insert into private.admin_audit_logs(actor_id,action) values(u,'notification_delivery_read');
 return jsonb_build_object('counts',coalesce((select jsonb_object_agg(status,n) from(select status,count(*) n from private.notification_deliveries group by status)t),'{}'::jsonb),
 'recent',coalesce((select jsonb_agg(jsonb_build_object('attempt',attempt,'status_code',status_code,'created_at',created_at) order by created_at desc) from(select attempt,status_code,created_at from private.notification_delivery_logs order by created_at desc limit 50)t),'[]'::jsonb));
 else raise exception 'INVALID_INPUT';end if;
end $$;
create function public.schoolpot_v2(p_action text,p_payload jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$select private.v2(p_action,p_payload)$$;
revoke all on function public.schoolpot_v2(text,jsonb),private.v2(text,jsonb) from public,anon;
grant execute on function public.schoolpot_v2(text,jsonb),private.v2(text,jsonb) to authenticated;

-- Preserve all V1 authorization and add post-specific private state/mentions after it succeeds.
alter function private.community(text,jsonb) rename to community_v1;
revoke all on function private.community_v1(text,jsonb) from public,anon,authenticated;
create function private.community(p_action text,p_payload jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;u uuid:=auth.uid();pid uuid;cid uuid;begin
 if p_action='notifications' then return private.v2('notifications',p_payload)->'items';
 elsif p_action='read_notifications' then return private.v2('read',p_payload);end if;
 result:=private.community_v1(p_action,p_payload);
 if p_action='get_post' then
 if exists(select 1 from private.posts p join private.user_blocks b on (b.user_id=u and b.blocked_id=p.author_id) or (b.blocked_id=u and b.user_id=p.author_id) where p.id=(p_payload->>'id')::uuid) then raise exception 'NOT_FOUND';end if;
 if nullif(p_payload->>'comment_id','') is not null then result:=result||jsonb_build_object('notification_comment_deleted',not exists(select 1 from private.comments where id=(p_payload->>'comment_id')::uuid and post_id=(p_payload->>'id')::uuid));end if;
 if private.v2_post_access((p_payload->>'id')::uuid,u) then result:=result||private.v2('post_state',jsonb_build_object('post_id',p_payload->>'id'));end if;
 result:=result||jsonb_build_object('mentions',coalesce((select jsonb_agg(jsonb_build_object('nickname',p.nickname,'id',p.id,'comment_id',m.comment_id)) from private.mentions m join private.profiles p on p.id=m.recipient_id join private.notification_preferences pref on pref.user_id=p.id and pref.mention_discoverable where m.post_id=(p_payload->>'id')::uuid and not exists(select 1 from private.user_blocks b where (b.user_id=u and b.blocked_id=p.id) or (b.user_id=p.id and b.blocked_id=u))),'[]'::jsonb));
 elsif p_action in ('save_post','save_comment') then
 if p_action='save_post' then pid:=(result->>'id')::uuid;
 else cid:=(result->>'id')::uuid;select post_id into pid from private.comments where id=cid;end if;
 perform private.v2_mentions(u,pid,cid,p_payload->'mentions');
 end if;
 return result;
end $$;
revoke all on function private.community(text,jsonb) from public,anon;
grant execute on function private.community(text,jsonb) to authenticated;

create or replace function private.community_legacy(p_action text,p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 u uuid:=auth.uid(); is_admin boolean; v_id uuid; v_parent uuid; v_post private.posts; v_comment private.comments;
 result jsonb; v_profile private.profiles; m private.memberships; v_assessment private.performance_assessments; v_board text; v_kind text; v_label integer; v_target uuid; v_title text; v_body text;
begin
 if u is null or not exists(select 1 from auth.users where id=u and deleted_at is null and not coalesce(is_anonymous,false)) then raise exception 'AUTH_REQUIRED';end if;
 if not exists(select 1 from auth.sessions where id=nullif(auth.jwt()->>'session_id','')::uuid and user_id=u) then raise exception 'AUTH_REQUIRED';end if;
 if not exists(select 1 from private.account_handles where user_id=u) then raise exception 'ACCOUNT_REQUIRED';end if;
 if p_action not in ('me','delete_account_access') and exists(select 1 from private.profiles where id=u and suspended_until>now()) then raise exception 'SUSPENDED';end if;
 is_admin:=exists(select 1 from private.user_roles where user_id=u and (role='owner' or (role='moderator' and p_action like 'admin_%')));
 if p_payload is null or pg_column_size(p_payload)>60000 or jsonb_typeof(p_payload)<>'object' then raise exception 'INVALID_INPUT';end if;
 perform private.consume_rate(u,'requests',180,60);
 if p_action='neis_access' then perform private.consume_rate(u,'neis',30,60);return '{"ok":true}'::jsonb;end if;
 if p_action='delete_account_access' then perform private.consume_rate(u,'delete_account',5,3600);return '{"ok":true}'::jsonb;end if;
 select * into v_profile from private.profiles where id=u;
 if p_action='me' then
  return jsonb_build_object('profile',case when v_profile.id is null then null else jsonb_build_object('nickname',v_profile.nickname,'grade',v_profile.grade,'notifications_enabled',v_profile.notifications_enabled) end,'is_admin',is_admin,'membership',(select jsonb_build_object('school_year',school_year,'grade',grade,'class_number',class_number,'policy_version',policy_version,'revision',revision,'collection_basis',collection_basis) from private.memberships where user_id=u),
   'enrollment_current',exists(select 1 from private.memberships mm cross join private.class_settings cc cross join private.privacy_policy pp where mm.user_id=u and mm.school_year=cc.school_year and mm.class_number<=cc.counts[mm.grade] ));
 elsif p_action='save_profile' then
  insert into private.profiles(id,nickname,notifications_enabled)
  values(u,btrim(p_payload->>'nickname'),coalesce((p_payload->>'notifications_enabled')::boolean,true))
  on conflict(id) do update set nickname=excluded.nickname,notifications_enabled=excluded.notifications_enabled;
  return jsonb_build_object('ok',true);
 end if;
 if v_profile.id is null then raise exception 'INVALID_INPUT: profile required';end if;
 if p_action like 'admin_%' and not is_admin then raise exception 'FORBIDDEN';end if;
 if p_action not like 'admin_%' and p_action not in ('notifications','read_notifications','delete_post','delete_comment','delete_assessment') then m:=private.require_membership(u);end if;
 if p_action='list_posts' then
  return coalesce((select jsonb_agg(item) from (
   select private.post_json(p,u) item from private.posts p
   where exists(select 1 from private.boards b where b.id=p.board_id and (b.is_active or is_admin)) and (coalesce(p_payload->>'board','')='' or p.board_id=p_payload->>'board')
   and (coalesce(p_payload->>'query','')='' or position(lower(left(p_payload->>'query',120)) in lower(p.title||' '||p.body))>0)
   and (coalesce(p_payload->>'period','') not in ('day','week') or p.created_at>now()-case when p_payload->>'period'='day' then interval '1 day' else interval '7 days' end)
   order by case when p_payload->>'sort'='popular' then (select count(*) from private.post_likes where post_id=p.id) else 0 end desc,p.created_at desc,p.id
   limit 20 offset least(greatest(coalesce((p_payload->>'offset')::int,0),0),10000)
  ) s),'[]'::jsonb);
 elsif p_action='get_post' then
  select * into v_post from private.posts where id=(p_payload->>'id')::uuid;
  if not found then raise exception 'NOT_FOUND';end if;
  if not is_admin and v_post.author_id is distinct from u and not exists(select 1 from private.boards where id=v_post.board_id and is_active) then raise exception 'NOT_FOUND';end if;
  insert into private.post_views(post_id,user_id) values(v_post.id,u) on conflict do nothing;
  result:=private.post_json(v_post,u)||jsonb_build_object('can_interact',is_admin or exists(select 1 from private.boards where id=v_post.board_id and is_active and can_post),'board_name',(select name from private.boards where id=v_post.board_id));
  result:=result||jsonb_build_object('replies',coalesce((select jsonb_agg(jsonb_build_object(
   'id',c.id,'parent_id',c.parent_id,'body',c.body,'is_mine',c.author_id=u,'anonymous',c.anonymous,
   'author',case when c.anonymous then case when c.author_id=v_post.author_id then '익명 · 글쓴이' else '익명 '||coalesce((select label::text from private.anonymous_labels where post_id=v_post.id and user_id=c.author_id),'알 수 없음') end else coalesce((select nickname from private.profiles where id=c.author_id),'탈퇴한 사용자') end,
   'created_at',c.created_at,'updated_at',c.updated_at,'likes',(select count(*) from private.comment_likes where comment_id=c.id),
   'liked',exists(select 1 from private.comment_likes where comment_id=c.id and user_id=u)) order by c.created_at,c.id) from (select * from private.comments where post_id=v_post.id order by created_at,id limit 50 offset least(greatest(coalesce((p_payload->>'comments_offset')::int,0),0),10000)) c),'[]'::jsonb));
  if exists(select 1 from private.polls where post_id=v_post.id) then
   result:=result||jsonb_build_object('poll',jsonb_build_object('closes_at',(select closes_at from private.polls where post_id=v_post.id),'voted',exists(select 1 from private.poll_votes where post_id=v_post.id and user_id=u),'options',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'label',o.label,'votes',(select count(*) from private.poll_votes where option_id=o.id)) order by o.position) from private.poll_options o where o.post_id=v_post.id),'[]'::jsonb)));
  end if;
  return result;
 elsif p_action in ('save_post','delete_post') then
  perform private.consume_rate(u,'posts',10,600);
  v_id:=nullif(p_payload->>'id','')::uuid;
  if v_id is not null then
   select * into v_post from private.posts where id=v_id for update;
   if not found then raise exception 'NOT_FOUND';end if;
   if v_post.author_id is distinct from u then raise exception 'FORBIDDEN';end if;
  end if;
  if p_action='delete_post' then
   if v_id is null then raise exception 'INVALID_INPUT';end if;
   delete from private.posts where id=v_id;return jsonb_build_object('ok',true);
  end if;
  v_board:=coalesce(v_post.board_id,p_payload->>'board');
  v_kind:=private.check_board_write(v_board,is_admin);v_title:=btrim(p_payload->>'title');v_body:=btrim(p_payload->>'body');
  if v_id is null then
   insert into private.posts(board_id,author_id,title,body,anonymous) values(v_board,u,v_title,v_body,v_kind='anonymous' or coalesce((p_payload->>'anonymous')::boolean,false)) returning id into v_id;
   if v_kind='poll' then
    if jsonb_typeof(p_payload->'options') is distinct from 'array' or coalesce(jsonb_array_length(p_payload->'options'),0) not between 2 and 6 then raise exception 'INVALID_INPUT';end if;
    insert into private.polls(post_id) values(v_id);
    insert into private.poll_options(post_id,label,position) select v_id,btrim(value),ordinality from jsonb_array_elements_text(p_payload->'options') with ordinality;
   end if;
  else
   update private.posts set title=v_title,body=v_body,updated_at=now() where id=v_id;
  end if;
  return jsonb_build_object('id',v_id);
 elsif p_action='save_comment' then
  perform private.consume_rate(u,'comments',30,600);
  v_id:=nullif(p_payload->>'id','')::uuid;
  if v_id is not null then
   select * into v_comment from private.comments where id=v_id for update;
   if not found then raise exception 'NOT_FOUND';end if;
   if v_comment.author_id is distinct from u then raise exception 'FORBIDDEN';end if;
   perform private.check_board_write((select board_id from private.posts where id=v_comment.post_id),is_admin);
   update private.comments set body=btrim(p_payload->>'body'),updated_at=now() where id=v_id;
  else
   select * into v_post from private.posts where id=(p_payload->>'post_id')::uuid for update;
   if not found then raise exception 'NOT_FOUND';end if;
   perform private.check_board_write(v_post.board_id,is_admin);
   v_parent:=nullif(p_payload->>'parent_id','')::uuid;
   if v_parent is not null and not exists(select 1 from private.comments where id=v_parent and post_id=v_post.id and parent_id is null) then raise exception 'INVALID_INPUT';end if;
   insert into private.anonymous_labels values(v_post.id,u,coalesce((select max(label)+1 from private.anonymous_labels where post_id=v_post.id),1)) on conflict(post_id,user_id) do nothing;
   insert into private.comments(post_id,parent_id,author_id,body,anonymous) values(v_post.id,v_parent,u,btrim(p_payload->>'body'),v_post.anonymous or coalesce((p_payload->>'anonymous')::boolean,false)) returning id into v_id;

  end if;
  return jsonb_build_object('id',v_id);
 elsif p_action='delete_comment' then
  v_id:=(p_payload->>'id')::uuid;
  if not exists(select 1 from private.comments where id=v_id and author_id=u) then raise exception 'FORBIDDEN';end if;
  delete from private.comments where id=v_id;return jsonb_build_object('ok',true);
 elsif p_action='like' then
  perform private.consume_rate(u,'likes',60,60);v_id:=(p_payload->>'id')::uuid;
  perform private.check_board_write((select board_id from private.posts where id=case when p_payload->>'kind'='post' then v_id else (select post_id from private.comments where id=v_id) end),is_admin);
  if p_payload->>'kind'='post' then
   if (p_payload->>'liked')::boolean then insert into private.post_likes values(v_id,u) on conflict do nothing;else delete from private.post_likes where post_id=v_id and user_id=u;end if;
  elsif p_payload->>'kind'='comment' then
   if (p_payload->>'liked')::boolean then insert into private.comment_likes values(v_id,u) on conflict do nothing;else delete from private.comment_likes where comment_id=v_id and user_id=u;end if;
  else raise exception 'INVALID_INPUT';end if;
  return jsonb_build_object('ok',true);
 elsif p_action='vote' then
  v_id:=(p_payload->>'post_id')::uuid;
  perform private.check_board_write((select board_id from private.posts where id=v_id),is_admin);
  if not exists(select 1 from private.polls where post_id=v_id and (closes_at is null or closes_at>now())) then raise exception 'FORBIDDEN';end if;
  if exists(select 1 from private.poll_votes where post_id=v_id and user_id=u) then raise exception 'ALREADY_VOTED';end if;
  insert into private.poll_votes values(v_id,u,(p_payload->>'option_id')::uuid);return jsonb_build_object('ok',true);
 elsif p_action='report' then
  perform private.consume_rate(u,'reports',10,3600);
  if p_payload->>'kind'='comment' then insert into private.reports(reporter_id,comment_id,reason) values(u,(p_payload->>'id')::uuid,btrim(p_payload->>'reason'));
  elsif p_payload->>'kind'='post' then insert into private.reports(reporter_id,post_id,reason) values(u,(p_payload->>'id')::uuid,btrim(p_payload->>'reason'));
  else raise exception 'INVALID_INPUT';end if;
  return jsonb_build_object('ok',true);
 elsif p_action='notifications' then
  return coalesce((select jsonb_agg(to_jsonb(n)-'user_id' order by n.created_at desc) from(select * from private.notifications where user_id=u order by created_at desc limit 100)n),'[]'::jsonb);
 elsif p_action='read_notifications' then
  update private.notifications set read_at=now() where user_id=u and (p_payload->>'id' is null or id=(p_payload->>'id')::uuid);return jsonb_build_object('ok',true);
 elsif p_action='notice_list' then
  return coalesce((select jsonb_agg(to_jsonb(n) order by n.created_at desc,n.id desc) from (
   select id,title,created_at,owner_only from private.notices
   where position(lower(left(coalesce(p_payload->>'query',''),120)) in lower(title))>0
   order by created_at desc,id desc limit 20 offset least(greatest(coalesce((p_payload->>'offset')::int,0),0),10000)
  )n),'[]'::jsonb);
 elsif p_action='get_notice' then
  v_id:=(p_payload->>'id')::uuid;
  select to_jsonb(n)-'author_id' into result from private.notices n where id=v_id;
  if not found then raise exception 'NOT_FOUND';end if;
  return result;
 elsif p_action='notices' then
  return coalesce((select jsonb_agg(to_jsonb(n)-'author_id' order by n.created_at desc) from (select * from private.notices order by created_at desc limit 50)n),'[]'::jsonb);

 elsif p_action in ('assessments','assessments_unassigned') then
  return coalesce((select jsonb_agg((to_jsonb(a)-'author_id')||jsonb_build_object('is_mine',author_id=u) order by due_date,id) from (
   select * from private.performance_assessments where
   ((p_action='assessments' and school_year=m.school_year and grade=m.grade and class_number=m.class_number and due_date between coalesce(nullif(p_payload->>'from','')::date,current_date-30) and coalesce(nullif(p_payload->>'to','')::date,current_date+90))
    or (p_action='assessments_unassigned' and author_id=u and class_number is null)) order by due_date,id limit 200)a),'[]'::jsonb);
 elsif p_action='save_assessment' then
  perform private.consume_rate(u,'assessments',15,3600);v_id:=nullif(p_payload->>'id','')::uuid;
  if v_id is not null then
   select * into v_assessment from private.performance_assessments where id=v_id for update;
   if not found or v_assessment.author_id is distinct from u then raise exception 'NOT_FOUND';end if;
   if v_assessment.class_number is not null and row(v_assessment.school_year,v_assessment.grade,v_assessment.class_number) is distinct from row(m.school_year,m.grade,m.class_number) then raise exception 'NOT_FOUND';end if;
   update private.performance_assessments set title=btrim(p_payload->>'title'),subject=btrim(p_payload->>'subject'),grade=m.grade,school_year=m.school_year,class_number=m.class_number,due_date=(p_payload->>'due_date')::date,body=coalesce(p_payload->>'body','') where id=v_id;
  else
   insert into private.performance_assessments(author_id,title,subject,grade,school_year,class_number,due_date,body) values(u,btrim(p_payload->>'title'),btrim(p_payload->>'subject'),m.grade,m.school_year,m.class_number,(p_payload->>'due_date')::date,coalesce(p_payload->>'body','')) returning id into v_id;
  end if;return jsonb_build_object('id',v_id);
 elsif p_action='delete_assessment' then
  v_id:=(p_payload->>'id')::uuid;
  if not exists(select 1 from private.performance_assessments where id=v_id and author_id=u) then raise exception 'FORBIDDEN';end if;
  delete from private.performance_assessments where id=v_id;return jsonb_build_object('ok',true);
 elsif p_action='report_assessment' then
  perform private.consume_rate(u,'reports',10,3600);
  if not exists(select 1 from private.performance_assessments where id=(p_payload->>'id')::uuid and school_year=m.school_year and grade=m.grade and class_number=m.class_number) then raise exception 'NOT_FOUND';end if;
  insert into private.assessment_reports(assessment_id,reporter_id,reason) values((p_payload->>'id')::uuid,u,btrim(p_payload->>'reason'));return jsonb_build_object('ok',true);
 elsif p_action='admin_stats' then
  return jsonb_build_object('members',(select count(*) from private.profiles),'posts',(select count(*) from private.posts),'comments',(select count(*) from private.comments),'reports',(select count(*) from private.reports where status='pending'),'feedback',(select count(*) from private.feedback where status in ('new','reviewing')));
 elsif p_action='admin_members' then
  return coalesce((select jsonb_agg(to_jsonb(p)) from(select id,nickname,grade,suspended_until,created_at from private.profiles where position(lower(coalesce(p_payload->>'query','')) in lower(nickname))>0 order by created_at desc limit 50)p),'[]'::jsonb);
 elsif p_action='admin_reports' then
  insert into private.admin_audit_logs(actor_id,action) values(u,'admin_reports_read');
  return jsonb_build_object('content',coalesce((select jsonb_agg((to_jsonb(r)-'reporter_id')||jsonb_build_object('subject_user_id',coalesce((select author_id from private.comments where id=r.comment_id),(select author_id from private.posts where id=r.post_id)),'context_post_id',coalesce(r.post_id,(select post_id from private.comments where id=r.comment_id)))) from(select * from private.reports order by created_at desc limit 100)r),'[]'::jsonb),'assessments',coalesce((select jsonb_agg(to_jsonb(r)-'reporter_id') from(select r.* from private.assessment_reports r join private.performance_assessments a on a.id=r.assessment_id join private.memberships mm on mm.user_id=u and row(mm.school_year,mm.grade,mm.class_number)=row(a.school_year,a.grade,a.class_number) where mm.school_year=(select school_year from private.class_settings where id) order by r.created_at desc limit 100)r),'[]'::jsonb));
 elsif p_action='admin_audit' then
  return coalesce((select jsonb_agg(to_jsonb(a)) from(select * from private.admin_audit_logs order by created_at desc limit 100)a),'[]'::jsonb);
 elsif p_action='admin_resolve' then
  v_id:=(p_payload->>'id')::uuid;
  if p_payload->>'status' not in ('reviewing','resolved','dismissed') then raise exception 'INVALID_INPUT';end if;
  if p_payload->>'kind'='assessment' then
   m:=private.require_membership(u);
   if not exists(select 1 from private.assessment_reports r join private.performance_assessments a on a.id=r.assessment_id where r.id=v_id and row(a.school_year,a.grade,a.class_number)=row(m.school_year,m.grade,m.class_number)) then raise exception 'NOT_FOUND';end if;
   update private.assessment_reports set status=p_payload->>'status' where id=v_id;else update private.reports set status=p_payload->>'status' where id=v_id;end if;
 elsif p_action='admin_suspend' then
  v_id:=(p_payload->>'id')::uuid;
  if exists(select 1 from private.user_roles where user_id=v_id) then raise exception 'FORBIDDEN';end if;
  update private.profiles set suspended_until=case when (p_payload->>'suspend')::boolean then now()+interval '7 days' else null end where id=v_id;
 elsif p_action='admin_delete' then
  v_id:=(p_payload->>'id')::uuid;
  if p_payload->>'kind'='post' then delete from private.posts where id=v_id;
  elsif p_payload->>'kind'='comment' then delete from private.comments where id=v_id;
  elsif p_payload->>'kind'='assessment' then
   m:=private.require_membership(u);
   if not exists(select 1 from private.performance_assessments a where a.id=v_id and row(a.school_year,a.grade,a.class_number)=row(m.school_year,m.grade,m.class_number)) then raise exception 'NOT_FOUND';end if;
   delete from private.performance_assessments where id=v_id;
  elsif p_payload->>'kind'='notice' then delete from private.notices where id=v_id;
  else raise exception 'INVALID_INPUT';end if;
 elsif p_action='admin_notice' then
  if coalesce(p_payload->>'content_format','text') not in ('text','markdown','html') then raise exception 'INVALID_INPUT';end if;
  insert into private.notices(author_id,title,body,content_format,owner_only,notify_members) values(u,btrim(p_payload->>'title'),btrim(p_payload->>'body'),coalesce(p_payload->>'content_format','text'),coalesce((p_payload->>'owner_only')::boolean,false),coalesce((p_payload->>'notify_members')::boolean,true)) returning id into v_id;

 else raise exception 'INVALID_INPUT: unknown action';
 end if;
 insert into private.admin_audit_logs(actor_id,action,target_id) values(u,p_action,v_id);
 return jsonb_build_object('ok',true,'id',v_id);
end $$;


-- Server-only delivery worker. Data API callers cannot claim recipients or endpoints.
create function private.push_delivery(p_action text,p_payload jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare job record;pref private.notification_preferences;local_now timestamp;due timestamptz;v_id uuid;code integer;result jsonb:='[]';batch integer:=0;begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'FORBIDDEN';end if;
 if p_action='claim' then
 perform pg_advisory_xact_lock(7031322);
 perform private.v2_expire_sanctions();
 delete from private.push_subscriptions where disabled_at<now()-interval '30 days';
 delete from private.notification_delivery_logs where created_at<now()-interval '30 days';
 delete from private.notification_deliveries where finished_at<now()-interval '30 days';
 update private.notification_deliveries set status='failed',finished_at=now(),lease_token=null,leased_until=null where status in ('pending','sending') and (attempts>=3 or available_at<now()-interval '7 days') and (leased_until is null or leased_until<=now());
 for job in select d.*,s.endpoint,s.p256dh,s.auth,s.session_id,s.disabled_at,n.read_at,n.type,n.post_id,n.comment_id,n.governance_kind,n.notice_id,n.feedback_id,n.created_at
 from private.notification_deliveries d join private.push_subscriptions s on s.id=d.subscription_id join private.notifications n on n.id=d.notification_id
 where ((d.status='pending' and d.available_at<=now()) or (d.status='sending' and d.leased_until<=now())) and d.attempts<3
 order by d.available_at,d.id limit 100 for update of d skip locked loop
 select * into pref from private.notification_preferences where user_id=job.user_id;
 if job.disabled_at is not null or job.read_at is not null or pref.push_enabled is distinct from true or not private.v2_enabled(job.user_id,job.type)
 or not exists(select 1 from auth.sessions where id=job.session_id and user_id=job.user_id)
 or not exists(select 1 from auth.users a join private.account_handles h on h.user_id=a.id where a.id=job.user_id and a.deleted_at is null and not coalesce(a.is_anonymous,false))
 or (job.post_id is not null and not private.v2_post_access(job.post_id,job.user_id))
 or (exists(select 1 from private.profiles where id=job.user_id and suspended_until>now()) and coalesce(job.governance_kind,'') not in ('sanction','appeal','rights') and job.type<>'release')
 or (job.comment_id is not null and exists(select 1 from private.comments c join private.user_blocks b on (b.user_id=job.user_id and b.blocked_id=c.author_id) or (b.blocked_id=job.user_id and b.user_id=c.author_id) where c.id=job.comment_id)) then
 update private.notification_deliveries set status='skipped',finished_at=now(),lease_token=null,leased_until=null where id=job.id;continue;end if;
 local_now:=now() at time zone pref.timezone;
 if pref.quiet_hours_enabled and ((pref.quiet_hours_start<pref.quiet_hours_end and local_now::time>=pref.quiet_hours_start and local_now::time<pref.quiet_hours_end)
 or (pref.quiet_hours_start>pref.quiet_hours_end and (local_now::time>=pref.quiet_hours_start or local_now::time<pref.quiet_hours_end))) then
 due:=(local_now::date+pref.quiet_hours_end) at time zone pref.timezone;
 if due<=now() then due:=((local_now::date+1)+pref.quiet_hours_end) at time zone pref.timezone;end if;
 update private.notification_deliveries set status='pending',available_at=due,lease_token=null,leased_until=null where id=job.id;continue;end if;
 if exists(select 1 from private.notification_deliveries d where d.id<>job.id and d.subscription_id=job.subscription_id and d.status='sending' and d.leased_until>now()) then
 update private.notification_deliveries set status='pending',available_at=now()+interval '2 minutes',lease_token=null,leased_until=null where id=job.id;continue;end if;
 -- Group a short burst into one generic notification on each device, leaving every inbox row intact.
 if exists(select 1 from private.notification_deliveries d where d.subscription_id=job.subscription_id and d.status='sent' and d.finished_at>now()-interval '2 minutes' and job.created_at<=d.finished_at) then
 update private.notification_deliveries set status='skipped',finished_at=now() where id=job.id;continue;end if;
 if (select count(*) from private.notification_deliveries d where d.user_id=job.user_id and ((d.status='sent' and d.finished_at>now()-interval '1 hour') or (d.status='sending' and d.leased_until>now())))>=20 then
 update private.notification_deliveries set status='pending',available_at=now()+interval '1 hour',lease_token=null,leased_until=null where id=job.id;continue;end if;
 update private.notification_deliveries set status='sending',attempts=attempts+1,lease_token=gen_random_uuid(),leased_until=now()+interval '5 minutes' where id=job.id returning lease_token into v_id;
 result:=result||jsonb_build_array(jsonb_build_object('id',job.id,'lease_token',v_id,'endpoint',job.endpoint,'p256dh',job.p256dh,'auth',job.auth,'tag','schoolpot-news','path',case when job.governance_kind='appeal_admin' then '#/admin?tab=appeals' when job.governance_kind='request' then '#/admin?tab=requests' when job.governance_kind='rights' then '#/admin?tab=feedback' when job.governance_kind='role' then '#/profile' when job.governance_kind is not null or job.type in ('sanction','release') then '#/account-status' when job.type='report' then '#/activity?kind=reports' when job.feedback_id is not null then '#/feedback' when job.post_id is not null then '#/post/'||job.post_id||case when job.comment_id is not null then '?comment='||job.comment_id else '' end when job.notice_id is not null then '#/notice/'||job.notice_id else '#/notifications' end));
 batch:=batch+1;if batch>=25 then exit;end if;
 end loop;return result;
 elsif p_action='finish' then
 select * into job from private.notification_deliveries where id=(p_payload->>'id')::uuid and status='sending' and lease_token=(p_payload->>'lease_token')::uuid and leased_until>now() for update;
 if not found then raise exception 'STALE_CHANGE';end if;
 code:=(p_payload->>'status_code')::int;
 if code is null or code not between 0 and 599 then raise exception 'INVALID_INPUT';end if;
 insert into private.notification_delivery_logs(delivery_id,attempt,status_code) values(job.id,job.attempts,code);
 if code between 200 and 299 then
 update private.notification_deliveries set status='sent',finished_at=now(),lease_token=null,leased_until=null where id=job.id;
 update private.push_subscriptions set last_success_at=now() where id=job.subscription_id;
 elsif code in (404,410) then
 update private.push_subscriptions set disabled_at=now() where id=job.subscription_id;
 update private.notification_deliveries set status='failed',finished_at=now(),lease_token=null,leased_until=null where id=job.id;
 elsif job.attempts<3 and (code=0 or code=429 or code>=500) then
 update private.notification_deliveries set status='pending',available_at=now()+case when job.attempts=1 then interval '2 minutes' else interval '10 minutes' end,lease_token=null,leased_until=null where id=job.id;
 else update private.notification_deliveries set status='failed',finished_at=now(),lease_token=null,leased_until=null where id=job.id;end if;
 return jsonb_build_object('ok',true);
 else raise exception 'INVALID_INPUT';end if;
end $$;
create function public.push_delivery(p_action text,p_payload jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$select private.push_delivery(p_action,p_payload)$$;
revoke all on function public.push_delivery(text,jsonb),private.push_delivery(text,jsonb) from public,anon,authenticated;
grant usage on schema private to service_role;
grant execute on function public.push_delivery(text,jsonb),private.push_delivery(text,jsonb) to service_role;
revoke all on function private.v2_post_access(uuid,uuid),private.v2_enabled(uuid,text),private.v2_notify(uuid,text,text,text,uuid,uuid,uuid,boolean),private.v2_comment_event(),private.v2_notice_event(),private.v2_report_event(),private.v2_queue_event(),private.v2_expire_sanctions(),private.v2_mentions(uuid,uuid,uuid,jsonb) from public,anon,authenticated;

-- Add only server-derived display state to the existing guarded governance API.
-- Disambiguate the actor role from the target role output alias in LIMIT.
create or replace function private.governance(p_action text,p_payload jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); v_role text:=private.actor_role(); v_id uuid; target uuid; result jsonb; req private.sanction_requests; appeal private.sanction_appeals; previous text; desired text; v_status text; rev integer;begin
 if p_payload is null or jsonb_typeof(p_payload)<>'object' or pg_column_size(p_payload)>30000 then raise exception 'INVALID_INPUT';end if;
 perform private.consume_rate(u,'governance',100,60);
 if p_action not in ('mine','appeal','rights','rights_mine') then
  if exists(select 1 from private.profiles where private.profiles.id=u and suspended_until>now()) then raise exception 'SUSPENDED';end if;
  if v_role not in ('owner','moderator') then raise exception 'FORBIDDEN';end if;
 end if;
 if p_action='mine' then
  return jsonb_build_object('sanctions',coalesce((select jsonb_agg((to_jsonb(s)-'target_id'-'actor_id'-'operation_id'-'request_id')||jsonb_build_object('state',case when s.revoked_at is not null then 'released' when s.kind in ('advice','warning') then 'nonblocking' when s.ends_at<=now() then 'expired' else 'active' end,'can_appeal',(select count(*) from private.sanction_appeals a where a.sanction_id=s.id and a.target_id=u)<3) order by starts_at desc) from(select * from private.sanctions where target_id=u order by starts_at desc limit 100 offset least(greatest(coalesce((p_payload->>'offset')::int,0),0),10000))s),'[]'::jsonb),
   'appeals',coalesce((select jsonb_agg(to_jsonb(a)-'target_id'-'handler_id' order by created_at desc) from(select * from private.sanction_appeals where target_id=u order by created_at desc limit 100)a),'[]'::jsonb));
 elsif p_action='appeal' then
  perform private.consume_rate(u,'appeals',5,3600);
  v_id:=(p_payload->>'sanction_id')::uuid;
  if not exists(select 1 from private.sanctions where private.sanctions.id=v_id and target_id=u) then raise exception 'NOT_FOUND';end if;
  insert into private.sanction_appeals(target_id,sanction_id,body) values(u,v_id,btrim(p_payload->>'body')) returning private.sanction_appeals.id into v_id;
  insert into private.notifications(user_id,message,governance_kind) select user_id,'새 제재 이의 제기가 접수됐어요.','appeal_admin' from private.user_roles;
  return jsonb_build_object('id',v_id);
 elsif p_action='rights' then
  perform private.consume_rate(u,'feedback_create',5,3600);
  insert into private.feedback(author_id,kind,title,body,sensitive) values(u,'other','계정·개인정보 문의',btrim(p_payload->>'body'),true) returning private.feedback.id into v_id;
  insert into private.notifications(user_id,message,governance_kind) select user_id,'계정·개인정보 문의가 접수됐어요.','rights' from private.user_roles where private.user_roles.role='owner';
  return jsonb_build_object('id',v_id);
 elsif p_action='rights_mine' then
  return coalesce((select jsonb_agg(to_jsonb(f)-'author_id' order by created_at desc) from(select * from private.feedback where author_id=u and sensitive order by created_at desc limit 20)f),'[]'::jsonb);
 elsif p_action in ('targets','members') then
  if p_action='members' and v_role<>'owner' then raise exception 'FORBIDDEN';end if;
  if v_role='moderator' and char_length(btrim(coalesce(p_payload->>'query','')))<3 then raise exception 'INVALID_INPUT';end if;
  perform private.consume_rate(u,'member_lookup',30,60);
  insert into private.admin_audit_logs(actor_id,action) values(u,'member_lookup');
  return coalesce((select jsonb_agg(to_jsonb(t)) from(select p.id,p.nickname,h.username,coalesce(r.role,'member') role,p.role_revision,p.sanction_revision,case when p.suspended_until='infinity' then null else p.suspended_until end suspended_until,p.suspended_until='infinity' permanent,p.suspended_until>now() restricted from private.profiles p join private.account_handles h on h.user_id=p.id left join private.user_roles r on r.user_id=p.id where position(lower(left(coalesce(p_payload->>'query',''),120)) in lower(p.nickname||' '||h.username||' '||p.id::text))>0 order by h.username limit case when v_role='owner' then 50 else 10 end offset least(greatest(coalesce((p_payload->>'offset')::int,0),0),10000))t),'[]'::jsonb);
 elsif p_action='request' then
  perform private.consume_rate(u,'sanction_request',10,3600);
  target:=(p_payload->>'target_id')::uuid;
  if not exists(select 1 from private.profiles where private.profiles.id=target) then raise exception 'NOT_FOUND';end if;
  if exists(select 1 from private.user_roles where user_id=target and private.user_roles.role='owner') then raise exception 'OWNER_TRANSFER_REQUIRED';end if;
  if nullif(p_payload->>'post_id','') is not null and not exists(select 1 from private.posts where private.posts.id=(p_payload->>'post_id')::uuid and (author_id=target or exists(select 1 from private.comments c where c.id=nullif(p_payload->>'comment_id','')::uuid and c.author_id=target and c.post_id=private.posts.id))) then raise exception 'INVALID_EVIDENCE';end if;
  if nullif(p_payload->>'comment_id','') is not null and not exists(select 1 from private.comments where private.comments.id=(p_payload->>'comment_id')::uuid and author_id=target and (nullif(p_payload->>'post_id','') is null or post_id=(p_payload->>'post_id')::uuid)) then raise exception 'INVALID_EVIDENCE';end if;
  if nullif(p_payload->>'report_id','') is not null and not exists(select 1 from private.reports r left join private.posts p on p.id=r.post_id left join private.comments c on c.id=r.comment_id where r.id=(p_payload->>'report_id')::uuid and coalesce(c.author_id,p.author_id)=target and (nullif(p_payload->>'post_id','') is null or coalesce(r.post_id,c.post_id)=(p_payload->>'post_id')::uuid) and (nullif(p_payload->>'comment_id','') is null or r.comment_id=(p_payload->>'comment_id')::uuid)) then raise exception 'INVALID_EVIDENCE';end if;
  if p_payload->>'level'='range' and (coalesce((p_payload->>'days')::int,0) not between 7 and 30) then raise exception 'INVALID_INPUT';end if;
  v_id:=nullif(p_payload->>'id','')::uuid;
  if v_id is not null then
   select * into req from private.sanction_requests where private.sanction_requests.id=v_id for update;
   if not found or req.requester_id<>u or req.status<>'needs_info' then raise exception 'FORBIDDEN';end if;
   if req.revision is distinct from (p_payload->>'revision')::int then raise exception 'STALE_CHANGE';end if;
   update private.sanction_requests set target_id=target,category=btrim(p_payload->>'category'),reason=btrim(p_payload->>'reason'),rule=btrim(p_payload->>'rule'),proposed=p_payload->>'level',days=(p_payload->>'days')::int,post_id=nullif(p_payload->>'post_id','')::uuid,comment_id=nullif(p_payload->>'comment_id','')::uuid,report_id=nullif(p_payload->>'report_id','')::uuid,status='pending',revision=revision+1,updated_at=now() where private.sanction_requests.id=v_id;
  else
   insert into private.sanction_requests(target_id,requester_id,category,reason,rule,proposed,days,post_id,comment_id,report_id) values(target,u,btrim(p_payload->>'category'),btrim(p_payload->>'reason'),btrim(p_payload->>'rule'),p_payload->>'level',(p_payload->>'days')::int,nullif(p_payload->>'post_id','')::uuid,nullif(p_payload->>'comment_id','')::uuid,nullif(p_payload->>'report_id','')::uuid) returning private.sanction_requests.id into v_id;
  end if;
  insert into private.notifications(user_id,message,governance_kind) select user_id,'새 제재 요청이 접수됐어요.','request' from private.user_roles where private.user_roles.role='owner';
 elsif p_action='requests' then
  insert into private.admin_audit_logs(actor_id,action) values(u,'sanction_requests_read');
  return coalesce((select jsonb_agg(to_jsonb(r)||jsonb_build_object('nickname',(select nickname from private.profiles where private.profiles.id=r.target_id)) order by created_at desc) from(select * from private.sanction_requests where (v_role='owner' or requester_id=u) and (coalesce(p_payload->>'status','')='' or status=p_payload->>'status') order by created_at desc limit 100 offset least(greatest(coalesce((p_payload->>'offset')::int,0),0),10000))r),'[]'::jsonb);
 elsif p_action in ('decide','cancel') then
  v_id:=(p_payload->>'id')::uuid;
  select * into req from private.sanction_requests where private.sanction_requests.id=v_id for update;
  if not found then raise exception 'NOT_FOUND';end if;
  if p_action='decide' and v_role<>'owner' then raise exception 'FORBIDDEN';end if;
  if p_action='cancel' and req.requester_id<>u then raise exception 'FORBIDDEN';end if;
  if req.status='approved' and p_action='decide' and p_payload->>'status'='approved' then return jsonb_build_object('ok',true,'already_applied',true);end if;
  if req.revision is distinct from (p_payload->>'revision')::int then raise exception 'STALE_CHANGE';end if;
  if req.status in ('approved','rejected','cancelled') then raise exception 'STALE_CHANGE';end if;
  v_status:=case when p_action='cancel' then 'cancelled' else p_payload->>'status' end;
  if v_status is null or v_status not in ('reviewing','needs_info','approved','rejected','cancelled') or (p_action='decide' and v_status='cancelled') then raise exception 'INVALID_INPUT';end if;
  if coalesce(char_length(btrim(p_payload->>'decision_reason')),0) not between 2 and 2000 then raise exception 'INVALID_INPUT';end if;
  if v_status='approved' then result:=private.apply_sanction(p_payload||jsonb_build_object('target_id',req.target_id,'operation_id',req.id),req.id);end if;
  update private.sanction_requests set status=v_status,decision_reason=btrim(p_payload->>'decision_reason'),handler_id=u,revision=revision+1,updated_at=now() where private.sanction_requests.id=v_id;
  insert into private.notifications(user_id,message,governance_kind) values(req.requester_id,'제재 요청 처리 상태가 변경됐어요.','request');
 elsif p_action='appeals' then
  insert into private.admin_audit_logs(actor_id,action) values(u,'appeals_read');
  return coalesce((select jsonb_agg((to_jsonb(a))||jsonb_build_object('nickname',(select nickname from private.profiles where private.profiles.id=a.target_id),'sanction',(select to_jsonb(s)-'actor_id'-'operation_id'-'target_id' from private.sanctions s where s.id=a.sanction_id)) order by created_at desc) from(select * from private.sanction_appeals order by created_at desc limit 100 offset least(greatest(coalesce((p_payload->>'offset')::int,0),0),10000))a),'[]'::jsonb);
 elsif p_action='reply_appeal' then
  v_id:=(p_payload->>'id')::uuid;
  select * into appeal from private.sanction_appeals where private.sanction_appeals.id=v_id for update;
  if not found then raise exception 'NOT_FOUND';end if;
  if appeal.revision is distinct from (p_payload->>'revision')::int then raise exception 'STALE_CHANGE';end if;
  if coalesce(char_length(btrim(p_payload->>'reply')),0) not between 2 and 4000 then raise exception 'INVALID_INPUT';end if;
  update private.sanction_appeals set status=p_payload->>'status',reply=btrim(p_payload->>'reply'),handler_id=u,revision=revision+1,updated_at=now() where private.sanction_appeals.id=v_id;
  insert into private.notifications(user_id,message,governance_kind) values(appeal.target_id,'이의 제기에 답변이 등록됐어요.','appeal');
 elsif p_action in ('apply','release','roles','role_history','role_set','sanctions','security') then
  if v_role<>'owner' then raise exception 'FORBIDDEN';end if;
  if p_action='apply' then perform private.consume_rate(u,'sanction_writes',30,600);return private.apply_sanction(p_payload);end if;
  if p_action='sanctions' then
   insert into private.admin_audit_logs(actor_id,action) values(u,'sanctions_read');
   return coalesce((select jsonb_agg(to_jsonb(s)-'operation_id' order by starts_at desc) from(select * from private.sanctions where nullif(p_payload->>'target_id','') is null or target_id=(p_payload->>'target_id')::uuid order by starts_at desc limit 100 offset least(greatest(coalesce((p_payload->>'offset')::int,0),0),10000))s),'[]'::jsonb);
  elsif p_action='release' then
   target:=(p_payload->>'target_id')::uuid;
   select sanction_revision into rev from private.profiles where private.profiles.id=target for update;
   if not found then raise exception 'NOT_FOUND';end if;
   if rev is distinct from (p_payload->>'revision')::int then raise exception 'STALE_CHANGE';end if;
   if coalesce(char_length(btrim(p_payload->>'reason')),0) not between 2 and 2000 then raise exception 'INVALID_INPUT';end if;
   update private.sanctions set revoked_at=now(),revoke_reason=btrim(p_payload->>'reason') where target_id=target and revoked_at is null and (kind='permanent' or ends_at>now());
   update private.profiles set suspended_until=null,sanction_revision=sanction_revision+1 where private.profiles.id=target;
   insert into private.notifications(user_id,message,governance_kind,type,important) values(target,'이용 제한이 해제됐어요.','sanction','release',true);v_id:=target;
  elsif p_action='roles' then
   insert into private.admin_audit_logs(actor_id,action) values(u,'roles_read');
   return coalesce((select jsonb_agg(to_jsonb(r)||jsonb_build_object('username',h.username,'nickname',p.nickname,'role_revision',p.role_revision,'restricted',p.suspended_until>now())) from private.user_roles r join private.profiles p on p.id=r.user_id join private.account_handles h on h.user_id=r.user_id),'[]'::jsonb);
  elsif p_action='role_history' then return coalesce((select jsonb_agg(to_jsonb(r) order by created_at desc) from(select * from private.role_history order by created_at desc limit 100 offset least(greatest(coalesce((p_payload->>'offset')::int,0),0),10000))r),'[]'::jsonb);
  elsif p_action='role_set' then
   target:=(p_payload->>'target_id')::uuid;desired:=p_payload->>'role';
   select role_revision into rev from private.profiles where private.profiles.id=target for update;
   if not found then raise exception 'NOT_FOUND';end if;
   if rev is distinct from (p_payload->>'revision')::int then raise exception 'STALE_CHANGE';end if;
   previous:=coalesce((select private.user_roles.role from private.user_roles where user_id=target),'member');
   if previous='owner' or desired is null or desired not in ('moderator','member') then raise exception 'OWNER_TRANSFER_REQUIRED';end if;
   if coalesce(char_length(btrim(p_payload->>'reason')),0) not between 2 and 2000 then raise exception 'INVALID_INPUT';end if;
   if desired='moderator' and exists(select 1 from private.profiles where private.profiles.id=target and suspended_until>now()) then raise exception 'SUSPENDED';end if;
   if desired='member' then delete from private.user_roles where user_id=target;
   else insert into private.user_roles(user_id,role,assigned_by) values(target,desired,u) on conflict(user_id) do update set role=excluded.role,assigned_at=now(),assigned_by=u;end if;
   update private.profiles set role_revision=role_revision+1 where private.profiles.id=target;
   insert into private.role_history(target_id,actor_id,previous_role,next_role,reason) values(target,u,previous,desired,btrim(p_payload->>'reason'));
   insert into private.notifications(user_id,message,governance_kind) values(target,'관리자 역할이 변경됐어요.','role');v_id:=target;
  elsif p_action='security' then
   return jsonb_build_object('private_tables',(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relkind='r'),'rls_enabled',(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relkind='r' and c.relrowsecurity),'owners',(select count(*) from private.user_roles where private.user_roles.role='owner'),'active_restrictions',(select count(*) from private.profiles where suspended_until>now()),'server_time',now());
  end if;
 else raise exception 'INVALID_INPUT';end if;
 insert into private.admin_audit_logs(actor_id,action,target_id,details) values(u,'governance_'||p_action,v_id,jsonb_build_object('reason',coalesce(p_payload->>'decision_reason',p_payload->>'reason'),'status',v_status,'previous_role',previous,'next_role',desired));
 return coalesce(result,jsonb_build_object('ok',true,'id',v_id));
end $$;

-- Keep notice permissions and revision checks; show the original send choice.
create or replace function private.manage_notices(p_action text,p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_role text:=private.actor_role(); u uuid:=auth.uid(); me jsonb; current_notice private.notices; v_id uuid; v_title text; v_body text; v_format text; result jsonb;
begin
 me:=private.community('me','{}');
 if (me->>'is_admin')::boolean is distinct from true then raise exception 'FORBIDDEN';end if;
 if exists(select 1 from private.profiles where id=u and suspended_until>now()) then raise exception 'SUSPENDED';end if;
 if p_payload is null or jsonb_typeof(p_payload)<>'object' or pg_column_size(p_payload)>60000 then raise exception 'INVALID_INPUT';end if;
 if p_action='list' then
  return coalesce((select jsonb_agg(to_jsonb(n) order by n.created_at desc,n.id desc) from (
   select id,title,content_format,created_at,updated_at,revision,owner_only,notify_members,(v_role='owner' or not owner_only) can_edit,(v_role='owner' or (not owner_only and author_id=u)) can_delete from private.notices
   where position(lower(left(coalesce(p_payload->>'query',''),120)) in lower(title))>0
   order by created_at desc,id desc limit 20 offset least(greatest(coalesce((p_payload->>'offset')::int,0),0),10000)
  )n),'[]'::jsonb);
 end if;
 if p_action not in ('get','save','delete') then raise exception 'INVALID_INPUT';end if;
 v_id:=nullif(p_payload->>'id','')::uuid;
 if p_action='get' then
  select (to_jsonb(n)-'author_id')||jsonb_build_object('can_edit',v_role='owner' or not n.owner_only,'can_delete',v_role='owner' or (not n.owner_only and n.author_id=u)) into result from private.notices n where id=v_id;
  if not found then raise exception 'NOT_FOUND';end if;return result;
 end if;
 perform private.consume_rate(u,'notice_writes',30,600);
 if v_id is not null then
  select * into current_notice from private.notices where id=v_id for update;
  if not found then raise exception 'NOT_FOUND';end if;
  if v_role<>'owner' and (current_notice.owner_only or (p_action='delete' and current_notice.author_id is distinct from u)) then raise exception 'FORBIDDEN';end if;
  if current_notice.revision is distinct from (p_payload->>'revision')::integer then raise exception 'STALE_NOTICE';end if;
 end if;
 if p_action='delete' then
  if v_id is null then raise exception 'INVALID_INPUT';end if;
  delete from private.notices where id=v_id;
 else
  v_title:=btrim(p_payload->>'title');v_body:=btrim(p_payload->>'body');v_format:=coalesce(p_payload->>'content_format','text');
  if v_title is null or char_length(v_title) not between 2 and 120 or v_body is null or char_length(v_body) not between 1 and 20000 or v_format not in ('text','markdown','html') then raise exception 'INVALID_INPUT';end if;
  if v_role<>'owner' and coalesce((p_payload->>'owner_only')::boolean,false) then raise exception 'FORBIDDEN';end if;
  if v_id is null then
   if coalesce((p_payload->>'notify_members')::boolean,true) then perform private.consume_rate(u,'notice_broadcast',3,3600);end if;
   -- The existing creation path alone sends the new-notice notification.
   result:=private.community_legacy('admin_notice',p_payload);
   update private.notices set owner_only=coalesce((p_payload->>'owner_only')::boolean,false) where id=(result->>'id')::uuid;return result;
  end if;
  update private.notices set title=v_title,body=v_body,content_format=v_format,owner_only=coalesce((p_payload->>'owner_only')::boolean,current_notice.owner_only),updated_at=now(),revision=revision+1 where id=v_id;
 end if;
 insert into private.admin_audit_logs(actor_id,action,target_id) values(u,'notice_'||p_action,v_id);
 return jsonb_build_object('ok',true,'id',v_id);
end $$;
