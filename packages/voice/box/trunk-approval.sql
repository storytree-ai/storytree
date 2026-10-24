-- Approve the voice door's copy as the storytree project's checkout, as the box's own account
-- (confine.sh runs it with psql, connected to storytree-trunks; the door's role may not write here).
-- Safe to run again.
--
-- The copy is its own machine's trunk: the door's storytree home names a machine id of its own
-- (machine.json), so this trunk sits beside the owner's checkout and never replaces it (there is one
-- trunk per project per machine). Without it every command the door runs is refused as an
-- unapproved checkout. psql sets :'machine', :'machine_name' and :'folder'. The machine is given no
-- short name (Machines, ADR-0982): no lane runs on it, and the pool never picks it.

INSERT INTO trunks (project, machine, machine_name, folder, approved_at, approved_by)
  VALUES ('storytree', :'machine', :'machine_name', :'folder', now(), 'owner ran packages/voice/box/confine.sh (increment_c548b1e7c8fa)')
  ON CONFLICT (project, machine) DO UPDATE
    SET machine_name = EXCLUDED.machine_name, folder = EXCLUDED.folder, approved_at = EXCLUDED.approved_at, approved_by = EXCLUDED.approved_by;
