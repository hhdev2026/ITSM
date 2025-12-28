begin;

-- ---------------------------------------------------------------------
-- MeshCentral linkage for Assets
-- - Some devices may not provide a reliable serial_number.
-- - We store MeshCentral node id to upsert/deduplicate and link to remote_devices.
-- ---------------------------------------------------------------------

alter table public.assets add column if not exists mesh_node_id text;

create index if not exists assets_dept_mesh_node_idx on public.assets (department_id, mesh_node_id);
create unique index if not exists assets_dept_mesh_node_uq on public.assets (department_id, mesh_node_id)
where mesh_node_id is not null and length(trim(mesh_node_id)) > 0;

commit;

