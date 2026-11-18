-- Fix forward: the SECURITY DEFINER function from the foundation migration could not see
-- invitations, because FORCE ROW LEVEL SECURITY applies RLS to the table owner as well.
--
-- Replacement: a capability-style policy. A transaction may read an invitation row only if it
-- presents that row's token hash (which only the holder of the emailed token can compute).
DROP FUNCTION IF EXISTS invitation_org_by_token_hash(text);

CREATE POLICY invitation_by_token ON "invitations" FOR SELECT
  USING (token_hash = nullif(current_setting('app.invitation_token_hash', true), ''));
