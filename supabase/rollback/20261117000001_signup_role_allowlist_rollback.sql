-- Rollback for 20261117000001_signup_role_allowlist.sql. Restores the signup
-- trigger function exactly as it was (role taken from the signup metadata).
CREATE OR REPLACE FUNCTION public.handle_new_member_signup()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  insert into public.members (name, email, role, status, gain_sharing_eligible)
  values (
    coalesce(new.raw_user_meta_data->>'name', ''),
    new.email,
    coalesce(new.raw_user_meta_data->>'role', 'member'),
    'pending',
    case when coalesce(new.raw_user_meta_data->>'role', 'member') = 'borrower' then false else true end
  );
  return new;
end;
$function$;
