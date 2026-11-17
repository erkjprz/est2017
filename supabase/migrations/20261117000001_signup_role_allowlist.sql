-- A signup's role came straight from the signup metadata, which the caller
-- controls: calling the signup API directly with role = 'admin' produced a
-- pending row that the Admin queue lists with ordinary member requests, and
-- approving it only flips status -- so one tap would have made an admin.
-- Only 'borrower' is honoured now; anything else signs up as a member.
-- Admins are still made from the Members page.
create or replace function public.handle_new_member_signup()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_role text := case when new.raw_user_meta_data->>'role' = 'borrower' then 'borrower' else 'member' end;
begin
  insert into public.members (name, email, role, status, gain_sharing_eligible)
  values (
    coalesce(new.raw_user_meta_data->>'name', ''),
    new.email,
    v_role,
    'pending',
    v_role <> 'borrower'
  );
  return new;
end;
$function$;
