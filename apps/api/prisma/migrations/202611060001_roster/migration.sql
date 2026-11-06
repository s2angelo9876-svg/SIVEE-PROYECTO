-- Preserve the identity shown in each election when institutional records change.
ALTER TABLE participations ADD COLUMN "displayName" TEXT NOT NULL DEFAULT '';
ALTER TABLE participations ADD COLUMN grade TEXT NOT NULL DEFAULT '';
ALTER TABLE participations ADD COLUMN section TEXT NOT NULL DEFAULT '';
UPDATE participations p SET "displayName"=s."displayName", grade=s.grade, section=s.section
FROM students s WHERE s.id=p."studentId";

-- Also fills snapshots for existing seed scripts and integrations creating participation rows.
CREATE FUNCTION participation_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."displayName"='' OR NEW.grade='' OR NEW.section='' THEN
    SELECT s."displayName", s.grade, s.section INTO NEW."displayName", NEW.grade, NEW.section
    FROM students s WHERE s.id=NEW."studentId";
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER participation_snapshot_insert BEFORE INSERT ON participations
FOR EACH ROW EXECUTE FUNCTION participation_snapshot();

CREATE TABLE roster_imports (
  id UUID PRIMARY KEY,
  "electionId" UUID NOT NULL REFERENCES elections(id),
  "adminId" UUID NOT NULL REFERENCES admins(id),
  source TEXT NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "studentIds" UUID[] NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "roster_imports_electionId_createdAt_idx" ON roster_imports("electionId","createdAt");
CREATE TRIGGER roster_imports_immutable BEFORE UPDATE OR DELETE ON roster_imports
FOR EACH ROW EXECUTE FUNCTION immutable_record();
