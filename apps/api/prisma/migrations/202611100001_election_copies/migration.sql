CREATE TABLE election_copies (
  id UUID PRIMARY KEY,
  "electionId" UUID NOT NULL REFERENCES elections(id),
  "adminId" UUID NOT NULL REFERENCES admins(id),
  label TEXT NOT NULL,
  "payloadEncrypted" TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  summary JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "election_copies_electionId_createdAt_idx" ON election_copies("electionId", "createdAt");
CREATE TRIGGER election_copies_immutable BEFORE UPDATE OR DELETE ON election_copies
FOR EACH ROW EXECUTE FUNCTION immutable_record();
CREATE TABLE election_copy_recoveries (
  "requestId" UUID PRIMARY KEY,
  "copyId" UUID NOT NULL REFERENCES election_copies(id),
  "electionId" UUID NOT NULL UNIQUE REFERENCES elections(id),
  "adminId" UUID NOT NULL REFERENCES admins(id),
  "requestHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TRIGGER election_copy_recoveries_immutable BEFORE UPDATE OR DELETE ON election_copy_recoveries
FOR EACH ROW EXECUTE FUNCTION immutable_record();
