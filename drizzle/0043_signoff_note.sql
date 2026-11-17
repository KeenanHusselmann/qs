-- Why a run was signed although its figures do not reconcile (audit C3).
--
-- A cost plan was signed with its elements R392 800 short of its stated total, and another at
-- R13 313 against R170 743 300 of elements. Sign-off now refuses a step whose money figures do not
-- reconcile, unless the signer writes why – the elements exclude VAT, the plan carries an element
-- this field set does not ask for. That sentence is part of what was signed, so it lives on the run,
-- is written in the same update as the signature, and is frozen with it by `runs_frozen()`.
--
-- Null means the run reconciled, or predates this check. Additive and replayable.
alter table "runs" add column if not exists "signoff_note" text;
