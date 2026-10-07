-- Audit trail is append-only: UPDATE and DELETE are rejected at the database level.
CREATE OR REPLACE FUNCTION evida_audit_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AuditLog is append-only (attempted %)', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_log_immutable ON "AuditLog";
CREATE TRIGGER audit_log_immutable
  BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION evida_audit_immutable();

-- Hiring decisions are never edited in place; a change is a new row that supersedes the old one.
CREATE OR REPLACE FUNCTION evida_decision_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Decision rows are immutable; create a superseding decision instead';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS decision_immutable ON "Decision";
CREATE TRIGGER decision_immutable
  BEFORE UPDATE OR DELETE ON "Decision"
  FOR EACH ROW EXECUTE FUNCTION evida_decision_immutable();

-- Range checks the ORM cannot express.
ALTER TABLE "Score" ADD CONSTRAINT score_value_range CHECK ("value" IS NULL OR ("value" BETWEEN 1 AND 5));
ALTER TABLE "Evidence" ADD CONSTRAINT evidence_confidence_range CHECK ("confidence" >= 0 AND "confidence" <= 1);
ALTER TABLE "CandidateFeedback" ADD CONSTRAINT feedback_rating_range CHECK ("rating" BETWEEN 1 AND 5);

-- Full-text search over candidates (PostgreSQL FTS before introducing OpenSearch).
CREATE OR REPLACE FUNCTION evida_candidate_search_doc(n text, pos text, comp text, skills text[])
RETURNS tsvector LANGUAGE sql IMMUTABLE AS $$
  SELECT to_tsvector('simple'::regconfig,
    coalesce(n,'') || ' ' || coalesce(pos,'') || ' ' || coalesce(comp,'') || ' ' || coalesce(array_to_string(skills, ' '),''))
$$;
CREATE INDEX IF NOT EXISTS candidate_fts ON "Candidate"
  USING GIN (evida_candidate_search_doc("name", "currentPosition", "currentCompany", "skills"));
