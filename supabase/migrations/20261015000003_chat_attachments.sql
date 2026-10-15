-- Photos and files in member <-> admin chat.
--
-- Each message can carry up to 10 attachments, stored in the private
-- ChatAttachments bucket under "<conversation_id>/<file>". Storage access
-- follows the conversation itself: whoever can read the thread (its member
-- and every admin) can view and upload its files, nobody else can. The
-- message row keeps a small list of {path, name, type, size} so the thread
-- can render them without listing the bucket.

insert into storage.buckets (id, name, public, file_size_limit)
values ('ChatAttachments', 'ChatAttachments', false, 10485760)
on conflict (id) do nothing;

alter table public.conversation_messages
  add column if not exists attachments jsonb not null default '[]'::jsonb;

-- A message is text, attachments, or both -- never neither.
alter table public.conversation_messages
  drop constraint if exists conversation_messages_body_check;
alter table public.conversation_messages
  add constraint conversation_messages_body_check check (
    char_length(btrim(body)) <= 4000
    and (char_length(btrim(body)) >= 1 or jsonb_array_length(attachments) > 0)
  );
alter table public.conversation_messages
  add constraint conversation_messages_attachments_check check (
    jsonb_typeof(attachments) = 'array' and jsonb_array_length(attachments) <= 10
  );

-- Takes the folder name as text (not uuid) so a malformed path in a storage
-- policy just fails the check instead of erroring on the cast.
create or replace function public.can_access_conversation(p_conversation_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.conversations c
    where c.id::text = p_conversation_id
      and (c.member_id = current_member_id() or is_admin())
  );
$$;

revoke execute on function public.can_access_conversation(text) from public, anon;
grant execute on function public.can_access_conversation(text) to authenticated;

-- Attachments can only point at files inside this message's own
-- conversation folder, so a message can't surface another thread's files.
create or replace function public.validate_conversation_message_attachments()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_item jsonb;
begin
  for v_item in select * from jsonb_array_elements(new.attachments) loop
    if jsonb_typeof(v_item) <> 'object'
      or coalesce(v_item->>'path', '') not like new.conversation_id::text || '/%'
    then
      raise exception 'Invalid attachment.';
    end if;
  end loop;
  return new;
end;
$$;

create or replace trigger trg_validate_conversation_message_attachments
before insert or update on public.conversation_messages
for each row execute function public.validate_conversation_message_attachments();

create policy "Conversation parties can view chat attachments"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'ChatAttachments'
    and public.can_access_conversation((storage.foldername(name))[1])
  );

create policy "Conversation parties can upload chat attachments"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'ChatAttachments'
    and public.can_access_conversation((storage.foldername(name))[1])
  );

-- Only so a failed send can clean up the files it just uploaded: your own
-- uploads, and only while no message points at them.
create policy "Uploaders can delete unsent chat attachments"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'ChatAttachments'
    and owner_id = auth.uid()::text
    and not exists (
      select 1 from public.conversation_messages cm
      where cm.attachments @> jsonb_build_array(jsonb_build_object('path', name))
    )
  );

-- Preview text for an attachment-only message, used by the notification
-- and the inbox listing.
create or replace function public.conversation_message_preview(p_body text, p_attachments jsonb)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when char_length(btrim(coalesce(p_body, ''))) > 0
      then left(regexp_replace(btrim(p_body), '\s+', ' ', 'g'), 140)
    when jsonb_array_length(coalesce(p_attachments, '[]'::jsonb)) = 0 then ''
    when jsonb_array_length(p_attachments) = 1
      then case when p_attachments->0->>'type' like 'image/%' then '📷 Photo' else '📎 ' || coalesce(p_attachments->0->>'name', 'File') end
    else '📎 ' || jsonb_array_length(p_attachments) || ' attachments'
  end;
$$;

create or replace function public.handle_conversation_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conv public.conversations%rowtype;
  v_sender_name text;
  v_link text;
  v_preview text;
begin
  update public.conversations
  set last_message_at = new.created_at, status = 'open'
  where id = new.conversation_id
  returning * into v_conv;

  insert into public.conversation_reads (conversation_id, member_id, last_read_at)
  values (new.conversation_id, new.sender_id, new.created_at)
  on conflict (conversation_id, member_id)
  do update set last_read_at = greatest(conversation_reads.last_read_at, excluded.last_read_at);

  v_link := '/messages/' || new.conversation_id;
  v_preview := public.conversation_message_preview(new.body, new.attachments);

  if new.sender_id = v_conv.member_id then
    select name into v_sender_name from public.members where member_id = new.sender_id;

    insert into public.notifications (member_id, type, title, body, link)
    select m.member_id, 'message', 'Message from ' || coalesce(v_sender_name, 'a member'), v_preview, v_link
    from public.members m
    where m.role = 'admin'
      and m.status = 'approved'
      and m.member_id <> new.sender_id
      and not exists (
        select 1 from public.notifications n
        where n.member_id = m.member_id and n.type = 'message' and n.link = v_link and not n.read
      );
  else
    if not exists (
      select 1 from public.notifications n
      where n.member_id = v_conv.member_id and n.type = 'message' and n.link = v_link and not n.read
    ) then
      perform public.create_notification(v_conv.member_id, 'message', 'Message from the admins', v_preview, v_link);
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.list_conversations()
returns table (
  id uuid,
  member_id uuid,
  member_name text,
  subject text,
  status text,
  last_message_at timestamptz,
  last_message_body text,
  last_message_sender_id uuid,
  unread boolean
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    c.id,
    c.member_id,
    m.name,
    c.subject,
    c.status,
    c.last_message_at,
    public.conversation_message_preview(lm.body, lm.attachments),
    lm.sender_id,
    (lm.sender_id is distinct from current_member_id()
      and lm.created_at > coalesce(r.last_read_at, '-infinity'::timestamptz)) as unread
  from public.conversations c
  left join public.members m on m.member_id = c.member_id
  left join public.conversation_reads r on r.conversation_id = c.id and r.member_id = current_member_id()
  left join lateral (
    select cm.body, cm.attachments, cm.sender_id, cm.created_at
    from public.conversation_messages cm
    where cm.conversation_id = c.id
    order by cm.created_at desc
    limit 1
  ) lm on true
  order by c.last_message_at desc;
$$;

revoke execute on function public.validate_conversation_message_attachments() from public, anon, authenticated;
