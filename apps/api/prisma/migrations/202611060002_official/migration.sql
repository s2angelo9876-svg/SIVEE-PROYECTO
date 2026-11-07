ALTER TABLE elections ADD COLUMN "authMode" TEXT NOT NULL DEFAULT 'CODE';
CREATE TABLE institution_branding ("institutionId" UUID PRIMARY KEY REFERENCES institutions(id), mime TEXT NOT NULL, image BYTEA NOT NULL);
ALTER TABLE elections ADD CONSTRAINT election_auth_mode CHECK ("authMode" IN ('CODE','DESK'));
ALTER TABLE admin_sessions ADD COLUMN purpose TEXT NOT NULL DEFAULT 'FULL' CHECK (purpose IN ('FULL','MFA_SETUP'));
CREATE TABLE school_imports (
  id UUID PRIMARY KEY, "electionId" UUID NOT NULL REFERENCES elections(id),
  "adminId" UUID NOT NULL REFERENCES admins(id), source TEXT NOT NULL,
  "payloadHash" TEXT NOT NULL, total INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "school_imports_electionId_createdAt_idx" ON school_imports("electionId","createdAt");
CREATE TRIGGER school_imports_immutable BEFORE UPDATE OR DELETE ON school_imports FOR EACH ROW EXECUTE FUNCTION immutable_record();
CREATE TABLE school_drafts (
  id UUID PRIMARY KEY, "electionId" UUID NOT NULL REFERENCES elections(id),
  "batchId" UUID NOT NULL REFERENCES school_imports(id), "studentCode" TEXT NOT NULL,
  "sourceRow" INTEGER NOT NULL, "documentEncrypted" TEXT NOT NULL,
  "displayName" TEXT NOT NULL, grade TEXT NOT NULL, section TEXT NOT NULL,
  shift TEXT CHECK (shift IN ('MANANA','TARDE')), enrollment TEXT NOT NULL,
  "enrollmentApproved" BOOLEAN NOT NULL DEFAULT false, excluded BOOLEAN NOT NULL DEFAULT false,
  reason TEXT NOT NULL DEFAULT '', version INTEGER NOT NULL DEFAULT 1, "publishedAt" TIMESTAMP(3)
);
CREATE UNIQUE INDEX "school_drafts_electionId_studentCode_key" ON school_drafts("electionId","studentCode");
CREATE INDEX "school_drafts_electionId_publishedAt_idx" ON school_drafts("electionId","publishedAt");
CREATE TABLE booths (
  id UUID PRIMARY KEY, "electionId" UUID NOT NULL REFERENCES elections(id), name TEXT NOT NULL,
  "assignedAdminId" UUID NOT NULL REFERENCES admins(id), active BOOLEAN NOT NULL DEFAULT true,
  "tokenHash" TEXT UNIQUE, "pairingHash" TEXT, "pairingExpiresAt" TIMESTAMP(3)
);
CREATE UNIQUE INDEX "booths_electionId_name_key" ON booths("electionId",name);
CREATE TABLE admissions (
  id UUID PRIMARY KEY, "electionId" UUID NOT NULL REFERENCES elections(id),
  "boothId" UUID NOT NULL REFERENCES booths(id), "studentId" UUID NOT NULL REFERENCES students(id),
  state TEXT NOT NULL DEFAULT 'WAITING' CHECK (state IN ('WAITING','APPROVED','CANCELLED','EXPIRED','CONSUMED')),
  "expiresAt" TIMESTAMP(3) NOT NULL, "approvedBy" UUID REFERENCES admins(id),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "admissions_boothId_createdAt_idx" ON admissions("boothId","createdAt");
CREATE INDEX "admissions_electionId_studentId_idx" ON admissions("electionId","studentId");
CREATE UNIQUE INDEX admission_one_student ON admissions("electionId","studentId") WHERE state IN ('WAITING','APPROVED');
CREATE UNIQUE INDEX admission_one_booth ON admissions("boothId") WHERE state IN ('WAITING','APPROVED');
ALTER TABLE voter_sessions ADD COLUMN "admissionId" UUID REFERENCES admissions(id);
UPDATE grants SET permissions=array_append(permissions,'desk:verify') WHERE role IN ('COMITE','MESA') AND NOT ('desk:verify'=ANY(permissions));
UPDATE grants SET permissions=array_append(permissions,'desk:manage') WHERE role='COMITE' AND NOT ('desk:manage'=ANY(permissions));
