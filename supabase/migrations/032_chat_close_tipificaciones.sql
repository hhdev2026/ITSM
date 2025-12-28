begin;

-- ---------------------------------------------------------------------
-- Chat: cierre con tipificación (para soporte)
-- - Guarda el motivo/resultado en chat_threads.metadata.closure
-- - Propaga la tipificación al evento "closed" para reporting/transcript
-- ---------------------------------------------------------------------

-- Replace: events + timestamps on thread changes (extend "closed" details)
create or replace function public._chat_threads_on_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  closure jsonb;
begin
  perform set_config('row_security', 'off', true);

  if new.assigned_agent_id is distinct from old.assigned_agent_id then
    new.assigned_at := coalesce(new.assigned_at, now());
    perform public._chat_events_insert(
      new.id,
      auth.uid(),
      'assigned',
      jsonb_build_object('from', old.assigned_agent_id, 'to', new.assigned_agent_id, 'status', new.status),
      now()
    );
  end if;

  if new.status is distinct from old.status and new.status = 'Activo' then
    new.accepted_at := coalesce(new.accepted_at, now());
    perform public._chat_events_insert(new.id, auth.uid(), 'accepted', jsonb_build_object('status', new.status), now());
  end if;

  if new.status is distinct from old.status and new.status = 'Cerrado' then
    new.closed_at := coalesce(new.closed_at, now());
    closure := nullif(coalesce(new.metadata->'closure', '{}'::jsonb), '{}'::jsonb);
    perform public._chat_events_insert(
      new.id,
      auth.uid(),
      'closed',
      jsonb_build_object('status', new.status, 'closure', closure),
      now()
    );
  end if;

  return new;
end;
$$;

-- New RPC: close with tipification (support-side)
create or replace function public.chat_close_thread_typed(
  p_thread_id uuid,
  p_code text,
  p_notes text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid;
  req uuid;
  ass uuid;
  me_role public.role_enum;
  clean_code text;
  clean_notes text;
begin
  perform set_config('row_security', 'off', true);
  uid := auth.uid();
  if uid is null then raise exception 'Not authenticated'; end if;

  select t.requester_id, t.assigned_agent_id into req, ass
  from public.chat_threads t
  where t.id = p_thread_id;

  if req is null then raise exception 'not_found'; end if;
  select p.role into me_role from public.profiles p where p.id = uid;

  -- Restrict: only assignee/supervisor/admin can close with a support code.
  if not (uid = ass or me_role in ('supervisor','admin')) then
    raise exception 'forbidden';
  end if;

  clean_code := lower(nullif(trim(coalesce(p_code,'')), ''));
  if clean_code is null then raise exception 'code_required'; end if;

  if clean_code not in (
    'resuelto',
    'derivado',
    'informacion_entregada',
    'no_responde',
    'fuera_de_alcance',
    'duplicado'
  ) then
    raise exception 'invalid_code';
  end if;

  clean_notes := nullif(trim(coalesce(p_notes,'')), '');

  update public.chat_threads
  set metadata = jsonb_set(
        coalesce(metadata, '{}'::jsonb),
        '{closure}',
        jsonb_build_object('code', clean_code, 'notes', clean_notes),
        true
      ),
      status = 'Cerrado',
      closed_at = coalesce(closed_at, now()),
      closed_by = uid,
      updated_at = now()
  where id = p_thread_id;
end;
$$;

revoke all on function public.chat_close_thread_typed(uuid, text, text) from public;
grant execute on function public.chat_close_thread_typed(uuid, text, text) to authenticated;

commit;

