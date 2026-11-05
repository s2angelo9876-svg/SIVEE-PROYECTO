-- CreateTable
CREATE TABLE "institutions" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'America/Lima',

    CONSTRAINT "institutions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "elections" (
    "id" UUID NOT NULL,
    "institutionId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "year" INTEGER NOT NULL DEFAULT 2026,
    "scope" TEXT NOT NULL DEFAULT 'Municipio escolar · Secundaria',
    "mode" TEXT NOT NULL DEFAULT 'DEMO',
    "state" TEXT NOT NULL DEFAULT 'BORRADOR',
    "blankAllowed" BOOLEAN NOT NULL DEFAULT true,
    "nullAllowed" BOOLEAN NOT NULL DEFAULT true,
    "regulation" TEXT NOT NULL DEFAULT 'Reglamento de simulación 2026',
    "contact" TEXT NOT NULL DEFAULT 'Solicita ayuda a tu mesa de votación.',
    "version" INTEGER NOT NULL DEFAULT 1,
    "openedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "elections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "windows" (
    "id" UUID NOT NULL,
    "electionId" UUID NOT NULL,
    "shift" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'PROGRAMADA',
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),

    CONSTRAINT "windows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "students" (
    "id" UUID NOT NULL,
    "institutionId" UUID NOT NULL,
    "dniLookup" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "grade" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "shift" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "students_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "participations" (
    "id" UUID NOT NULL,
    "electionId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "shift" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'PENDIENTE',

    CONSTRAINT "participations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "electoral_lists" (
    "id" UUID NOT NULL,
    "electionId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "symbol" TEXT NOT NULL DEFAULT 'sprout',
    "color" TEXT NOT NULL DEFAULT '#167568',
    "candidates" JSONB NOT NULL,
    "proposal" TEXT NOT NULL DEFAULT '',
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "electoral_lists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ballots" (
    "id" UUID NOT NULL,
    "electionId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "listId" UUID,

    CONSTRAINT "ballots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credentials" (
    "id" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "electionId" UUID NOT NULL,
    "codeHash" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voter_sessions" (
    "id" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "studentId" UUID NOT NULL,
    "electionId" UUID NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumed" BOOLEAN NOT NULL DEFAULT false,
    "revoked" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "voter_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admins" (
    "id" UUID NOT NULL,
    "institutionId" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "mfaSecret" TEXT,
    "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "admins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grants" (
    "id" UUID NOT NULL,
    "adminId" UUID NOT NULL,
    "electionScope" TEXT NOT NULL DEFAULT '*',
    "role" TEXT NOT NULL,
    "permissions" TEXT[],

    CONSTRAINT "grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_sessions" (
    "id" UUID NOT NULL,
    "adminId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revoked" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "admin_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit" (
    "id" UUID NOT NULL,
    "electionId" UUID,
    "adminId" UUID,
    "action" TEXT NOT NULL,
    "detail" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approvals" (
    "id" UUID NOT NULL,
    "electionId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "requesterId" UUID NOT NULL,
    "approverId" UUID,
    "reason" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reports" (
    "id" UUID NOT NULL,
    "electionId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "summary" JSONB NOT NULL,
    "sha256" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'BORRADOR',
    "approvedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incidents" (
    "id" UUID NOT NULL,
    "electionId" UUID NOT NULL,
    "shift" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'ABIERTO',
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "incidents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "institutions_code_key" ON "institutions"("code");

-- CreateIndex
CREATE UNIQUE INDEX "windows_electionId_shift_key" ON "windows"("electionId", "shift");

-- CreateIndex
CREATE UNIQUE INDEX "students_institutionId_dniLookup_key" ON "students"("institutionId", "dniLookup");

-- CreateIndex
CREATE UNIQUE INDEX "participations_electionId_studentId_key" ON "participations"("electionId", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "electoral_lists_electionId_number_key" ON "electoral_lists"("electionId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "electoral_lists_id_electionId_key" ON "electoral_lists"("id", "electionId");

-- CreateIndex
CREATE INDEX "ballots_electionId_idx" ON "ballots"("electionId");

-- CreateIndex
CREATE UNIQUE INDEX "credentials_electionId_studentId_key" ON "credentials"("electionId", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "voter_sessions_tokenHash_key" ON "voter_sessions"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "admins_email_key" ON "admins"("email");

-- CreateIndex
CREATE UNIQUE INDEX "grants_adminId_electionScope_role_key" ON "grants"("adminId", "electionScope", "role");

-- CreateIndex
CREATE UNIQUE INDEX "admin_sessions_tokenHash_key" ON "admin_sessions"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "reports_electionId_version_key" ON "reports"("electionId", "version");

-- AddForeignKey
ALTER TABLE "elections" ADD CONSTRAINT "elections_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "institutions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "windows" ADD CONSTRAINT "windows_electionId_fkey" FOREIGN KEY ("electionId") REFERENCES "elections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "institutions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "participations" ADD CONSTRAINT "participations_electionId_fkey" FOREIGN KEY ("electionId") REFERENCES "elections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "participations" ADD CONSTRAINT "participations_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "electoral_lists" ADD CONSTRAINT "electoral_lists_electionId_fkey" FOREIGN KEY ("electionId") REFERENCES "elections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ballots" ADD CONSTRAINT "ballots_electionId_fkey" FOREIGN KEY ("electionId") REFERENCES "elections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ballots" ADD CONSTRAINT "ballots_listId_electionId_fkey" FOREIGN KEY ("listId", "electionId") REFERENCES "electoral_lists"("id", "electionId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_electionId_fkey" FOREIGN KEY ("electionId") REFERENCES "elections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voter_sessions" ADD CONSTRAINT "voter_sessions_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voter_sessions" ADD CONSTRAINT "voter_sessions_electionId_fkey" FOREIGN KEY ("electionId") REFERENCES "elections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admins" ADD CONSTRAINT "admins_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "institutions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grants" ADD CONSTRAINT "grants_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "admins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_sessions" ADD CONSTRAINT "admin_sessions_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "admins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit" ADD CONSTRAINT "audit_electionId_fkey" FOREIGN KEY ("electionId") REFERENCES "elections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit" ADD CONSTRAINT "audit_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_electionId_fkey" FOREIGN KEY ("electionId") REFERENCES "elections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_electionId_fkey" FOREIGN KEY ("electionId") REFERENCES "elections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_electionId_fkey" FOREIGN KEY ("electionId") REFERENCES "elections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Electoral invariants. Ballots deliberately contain no voter/session/timestamp.
ALTER TABLE ballots ADD CONSTRAINT ballot_shape CHECK ((kind='VALIDO' AND "listId" IS NOT NULL) OR (kind IN ('BLANCO','NULO') AND "listId" IS NULL));
ALTER TABLE elections ADD CONSTRAINT election_state CHECK (state IN ('BORRADOR','PREPARADA','EN_CURSO','PAUSADA','CERRADA','CONCILIADA','PUBLICADA','ANULADA'));
ALTER TABLE elections ADD CONSTRAINT election_mode CHECK (mode IN ('DEMO','OFICIAL'));
ALTER TABLE windows ADD CONSTRAINT window_state CHECK (state IN ('PROGRAMADA','ABIERTA','PAUSADA','CERRADA'));
ALTER TABLE windows ADD CONSTRAINT window_shift CHECK (shift IN ('MANANA','TARDE'));
ALTER TABLE participations ADD CONSTRAINT participation_state CHECK (state IN ('PENDIENTE','VOTO_EMITIDO','ANULADA_POR_COMITE'));
CREATE FUNCTION immutable_record() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Record is append-only'; END $$;
CREATE TRIGGER ballots_immutable BEFORE UPDATE OR DELETE ON ballots FOR EACH ROW EXECUTE FUNCTION immutable_record();
CREATE TRIGGER audit_immutable BEFORE UPDATE OR DELETE ON audit FOR EACH ROW EXECUTE FUNCTION immutable_record();
CREATE FUNCTION validate_ballot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM elections WHERE id=NEW."electionId" AND state='EN_CURSO') THEN RAISE EXCEPTION 'Election is not open'; END IF;
 IF NEW.kind='VALIDO' AND NOT EXISTS (SELECT 1 FROM electoral_lists WHERE id=NEW."listId" AND "electionId"=NEW."electionId" AND active=true) THEN RAISE EXCEPTION 'Invalid list'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ballot_valid BEFORE INSERT ON ballots FOR EACH ROW EXECUTE FUNCTION validate_ballot();
CREATE FUNCTION freeze_list() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE eid uuid;
BEGIN
 eid:=COALESCE(NEW."electionId",OLD."electionId");
 IF NOT EXISTS (SELECT 1 FROM elections WHERE id=eid AND state='BORRADOR') THEN RAISE EXCEPTION 'Lists are frozen'; END IF;
 RETURN COALESCE(NEW,OLD);
END $$;
CREATE TRIGGER list_frozen BEFORE INSERT OR UPDATE OR DELETE ON electoral_lists FOR EACH ROW EXECUTE FUNCTION freeze_list();
