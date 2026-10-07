-- OPTIONAL defence-in-depth: PostgreSQL Row Level Security for tenant isolation.
-- The application already scopes every query by organizationId in the service layer.
-- To enable RLS, run the API as a NON-superuser role that does not own the tables, and
-- set EVIDA_RLS=true so each transaction executes:  SELECT set_config('evida.org_id', '<orgId>', true)
-- (see src/common/prisma.service.ts → withTenant()).

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['User','Job','Competency','Question','InterviewPlan','InterviewStage','Candidate',
    'Application','Interview','ConsentRecord','Evidence','Scorecard','DecisionSummary','Decision','File',
    'AIProcessingRun','Webhook','Notification','Recording']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING ("organizationId" = nullif(current_setting('evida.org_id', true), '')::uuid
             OR current_setting('evida.bypass_rls', true) = 'on')$p$, t);
  END LOOP;
END $$;
