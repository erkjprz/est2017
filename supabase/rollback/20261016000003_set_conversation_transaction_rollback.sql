-- Undoes 20261016000003_set_conversation_transaction.
drop function if exists public.set_conversation_transaction(uuid, uuid);
