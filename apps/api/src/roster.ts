import crypto from "node:crypto";
import { db } from "./db.js";
import { audit, lockElection, type Tx } from "./services.js";
import {
  AppError,
  requireState,
  dniLookup,
  passwordHash,
  hashSecret,
  canonical,
} from "./security.js";
import {
  parseRosterInput,
  type RosterInput,
  type RosterRow,
  type RosterIssue,
} from "./roster-files.js";

export function credentialExpiry(
  windows: { endsAt: Date | null; startsAt: Date | null }[],
  now = Date.now(),
) {
  // Cover scheduled voting even when the roster is loaded months in advance.
  const end = Math.max(
    now + 30 * 86400000,
    ...windows.flatMap((w) => [
      w.startsAt ? +w.startsAt + 86400000 : 0,
      w.endsAt ? +w.endsAt + 86400000 : 0,
    ]),
  );
  return new Date(end);
}

export async function checkRoster(
  tx: Tx,
  election: { id: string; institutionId: string; windows: { shift: string }[] },
  rows: RosterRow[],
  input: Pick<RosterInput, "skipExisting" | "updateProfiles" | "reason">,
) {
  const keys = rows.map((r) => dniLookup(r.data.dni));
  const students = await tx.student.findMany({
    where: { institutionId: election.institutionId, dniLookup: { in: keys } },
    include: { participations: { where: { electionId: election.id } } },
  });
  const byKey = new Map(students.map((s) => [s.dniLookup, s]));
  const errors: RosterIssue[] = [],
    accepted: RosterRow[] = [],
    skipped: number[] = [],
    updates: { row: number; name: string; changes: string[] }[] = [];
  for (const item of rows) {
    const r = item.data,
      student = byKey.get(dniLookup(r.dni));
    const participation = student?.participations[0];
    const snapshot = participation || student;
    const changes = snapshot
      ? [
          snapshot.displayName !== r.apellidos_nombres ? "nombre" : "",
          snapshot.grade !== r.grado ? "grado" : "",
          snapshot.section !== r.seccion ? "sección" : "",
          snapshot.shift !== r.turno ? "turno" : "",
        ].filter(Boolean)
      : [];
    if (!election.windows.some((w) => w.shift === r.turno))
      errors.push({
        row: item.row,
        field: "turno",
        message: "Turno no incluido en la elección.",
      });
    if (student && !student.active)
      errors.push({
        row: item.row,
        field: "dni",
        message:
          "El registro institucional está inactivo. Solicita revisión al comité.",
      });
    if (participation) {
      const sameEligibility =
        (participation.state !== "ANULADA_POR_COMITE") ===
        (r.habilitado === "true");
      if (!changes.length && sameEligibility && input.skipExisting)
        skipped.push(item.row);
      else
        errors.push({
          row: item.row,
          field: "dni",
          message:
            changes.length || !sameEligibility
              ? "Ya está inscrito con datos distintos. Revisa el registro; no se sobrescribirá."
              : "Este elector ya está inscrito. Puedes omitir los registros idénticos.",
        });
    } else {
      if (student && changes.length) {
        updates.push({ row: item.row, name: r.apellidos_nombres, changes });
        if (!input.updateProfiles || input.reason.trim().length < 10)
          errors.push({
            row: item.row,
            field: "datos",
            message:
              "Los datos institucionales cambiaron. Confirma la actualización e indica su motivo (mínimo 10 caracteres). Se conservarán las elecciones anteriores.",
          });
      }
      accepted.push(item);
    }
  }
  return { errors, accepted, skipped, updates };
}

export async function previewRoster(electionId: string, input: RosterInput) {
  const election = await db.election.findUniqueOrThrow({
    where: { id: electionId },
    include: { windows: true },
  });
  requireState(election.state === "BORRADOR");
  requireState(
    election.authMode === "CODE",
    "Utiliza el padrón escolar con revisión y sin códigos individuales.",
  );
  const parsed = await parseRosterInput(input);
  const checked = await checkRoster(db, election, parsed.rows, input);
  const errors = [...parsed.errors, ...checked.errors].sort(
    (a, b) => a.row - b.row,
  );
  const invalid = new Set(errors.map((e) => e.row));
  return {
    sheet: parsed.sheet,
    total: parsed.total,
    valid: parsed.total - invalid.size,
    invalid: invalid.size,
    newCount: checked.accepted.filter((r) => !invalid.has(r.row)).length,
    skipped: checked.skipped.length,
    errors,
    warnings: parsed.warnings,
    updates: checked.updates,
    expiresAt: credentialExpiry(election.windows).toISOString(),
    preview: parsed.rows.slice(0, 100).map((r) => ({
      row: r.row,
      name: r.data.apellidos_nombres,
      grade: r.data.grado,
      section: r.data.seccion,
      shift: r.data.turno,
      enabled: r.data.habilitado === "true",
      status: invalid.has(r.row)
        ? "Revisar"
        : checked.skipped.includes(r.row)
          ? "Ya inscrito"
          : "Nuevo",
    })),
  };
}

async function generateCodes(count: number) {
  const result: { code: string; hash: string }[] = [];
  // Bound Argon2 memory and CPU; do not launch thousands of hashes at once.
  for (let i = 0; i < count; i += 4) {
    result.push(
      ...(await Promise.all(
        Array.from({ length: Math.min(4, count - i) }, async () => {
          const code = crypto.randomBytes(12).toString("base64url");
          return { code, hash: await passwordHash(code) };
        }),
      )),
    );
  }
  return result;
}
function receipt(
  batch: { id: string; studentIds: string[]; source: string; createdAt: Date },
  alreadyImported: boolean,
) {
  return {
    batchId: batch.id,
    count: batch.studentIds.length,
    source: batch.source,
    createdAt: batch.createdAt,
    alreadyImported,
    credentials: [] as IssuedCode[],
  };
}
type IssuedCode = {
  studentId: string;
  row?: number;
  displayName: string;
  grade: string;
  section: string;
  shift: string;
  accessCode: string;
  expiresAt: string;
};

export async function importRoster(
  electionId: string,
  adminId: string,
  input: RosterInput,
) {
  const parsed = await parseRosterInput(input);
  if (parsed.errors.length)
    throw new AppError(
      400,
      "INVALID_ROSTER",
      "Corrige todas las filas antes de importar.",
    );
  const requestId = input.requestId || crypto.randomUUID();
  const payloadHash = hashSecret(
    canonical({
      rows: parsed.rows.map((r) => r.data),
      skipExisting: input.skipExisting,
      updateProfiles: input.updateProfiles,
      reason: input.reason,
    }),
  );
  const previous = await db.rosterImport.findUnique({
    where: { id: requestId },
  });
  const replay = (batch: NonNullable<typeof previous>) => {
    if (batch.electionId !== electionId || batch.payloadHash !== payloadHash)
      throw new AppError(
        409,
        "IMPORT_REQUEST_CONFLICT",
        "El identificador corresponde a otra importación. Vuelve a validar el archivo.",
      );
    return receipt(batch, true);
  };
  if (previous) return replay(previous);
  const election = await db.election.findUniqueOrThrow({
    where: { id: electionId },
    include: { windows: true },
  });
  requireState(election.state === "BORRADOR");
  const preflight = await checkRoster(db, election, parsed.rows, input);
  requireState(
    election.authMode === "CODE",
    "Utiliza el padrón escolar con revisión y sin códigos individuales.",
  );
  if (preflight.errors.length)
    throw new AppError(409, "INVALID_ROSTER", preflight.errors[0].message);
  if (!preflight.accepted.length)
    throw new AppError(
      409,
      "NO_NEW_STUDENTS",
      "Todos los estudiantes ya están inscritos; no hay registros nuevos.",
    );
  const codes = await generateCodes(preflight.accepted.length);
  const codeByRow = new Map(
    preflight.accepted.map((r, i) => [r.row, codes[i]]),
  );
  return db.$transaction(
    async (tx) => {
      const e = await lockElection(tx, electionId, true);
      const prior = await tx.rosterImport.findUnique({
        where: { id: requestId },
      });
      if (prior) return replay(prior);
      requireState(e.state === "BORRADOR");
      const checked = await checkRoster(tx, e, parsed.rows, input);
      if (checked.errors.length)
        throw new AppError(409, "INVALID_ROSTER", checked.errors[0].message);
      if (!checked.accepted.length)
        throw new AppError(
          409,
          "NO_NEW_STUDENTS",
          "Los estudiantes ya fueron inscritos por otra operación. Actualiza el padrón.",
        );
      const issued: IssuedCode[] = [],
        expiresAt = credentialExpiry(e.windows);
      for (const item of checked.accepted) {
        const r = item.data,
          code = codeByRow.get(item.row);
        if (!code)
          throw new AppError(
            409,
            "ROSTER_CHANGED",
            "El padrón cambió. Vuelve a validar.",
          );
        const profile = {
          displayName: r.apellidos_nombres,
          grade: r.grado,
          section: r.seccion,
          shift: r.turno,
        };
        const student = await tx.student.upsert({
          where: {
            institutionId_dniLookup: {
              institutionId: e.institutionId,
              dniLookup: dniLookup(r.dni),
            },
          },
          create: {
            institutionId: e.institutionId,
            dniLookup: dniLookup(r.dni),
            ...profile,
          },
          update: input.updateProfiles ? profile : {},
        });
        await tx.participation.create({
          data: {
            electionId,
            studentId: student.id,
            ...profile,
            state: r.habilitado === "true" ? "PENDIENTE" : "ANULADA_POR_COMITE",
          },
        });
        await tx.credential.create({
          data: {
            electionId,
            studentId: student.id,
            codeHash: code.hash,
            active: r.habilitado === "true",
            expiresAt,
          },
        });
        issued.push({
          studentId: student.id,
          row: item.row,
          ...profile,
          accessCode: code.code,
          expiresAt: expiresAt.toISOString(),
        });
      }
      const batch = await tx.rosterImport.create({
        data: {
          id: requestId,
          electionId,
          adminId,
          source: input.individual
            ? "Registro individual"
            : input.file?.name || "Archivo CSV",
          payloadHash,
          studentIds: issued.map((r) => r.studentId),
        },
      });
      await audit(tx, adminId, electionId, "ROSTER_IMPORTED", {
        batchId: batch.id,
        count: issued.length,
        skipped: checked.skipped.length,
        updatedProfiles: checked.updates.length,
        ...(checked.updates.length ? { reason: input.reason } : {}),
      });
      return {
        ...receipt(batch, false),
        skipped: checked.skipped.length,
        credentials: issued,
      };
    },
    { timeout: 60000 },
  );
}

export async function importHistory(electionId: string) {
  const batches = await db.rosterImport.findMany({
    where: { electionId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return batches.map((b) => receipt(b, true));
}

export async function reissueCodes(
  electionId: string,
  adminId: string,
  input: { studentId?: string; batchId?: string; reason: string },
) {
  let ids: string[];
  if (input.batchId) {
    const batch = await db.rosterImport.findFirst({
      where: { id: input.batchId, electionId },
    });
    if (!batch)
      throw new AppError(404, "NOT_FOUND", "Importación no encontrada.");
    ids = batch.studentIds;
  } else ids = [input.studentId!];
  const initial = await db.participation.findMany({
    where: { electionId, studentId: { in: ids } },
  });
  if (initial.length !== ids.length)
    throw new AppError(
      404,
      "NOT_FOUND",
      "Elector no encontrado en esta elección.",
    );
  const election = await db.election.findUniqueOrThrow({
    where: { id: electionId },
    include: { windows: true },
  });
  const allowed = (e: typeof election, rows: typeof initial) => {
    requireState(
      e.authMode === "CODE",
      "Esta elección utiliza DNI en cabinas registradas, sin códigos individuales.",
    );
    requireState(
      ["BORRADOR", "PREPARADA", "EN_CURSO", "PAUSADA"].includes(e.state),
      "La elección ya no admite reemisión de códigos.",
    );
    if (input.batchId)
      requireState(
        e.state === "BORRADOR",
        "La reemisión de un lote completo solo se permite en BORRADOR. Durante la jornada usa la consulta individual.",
      );
    requireState(
      rows.every(
        (p) =>
          p.state !== "VOTO_EMITIDO" &&
          (input.batchId || p.state === "PENDIENTE") &&
          e.windows.some((w) => w.shift === p.shift && w.state !== "CERRADA"),
      ),
      "No se puede reemitir: el elector no está habilitado, ya participó o su turno está cerrado.",
    );
  };
  allowed(election, initial);
  const versions = new Map(
    (
      await db.credential.findMany({
        where: { electionId, studentId: { in: ids } },
        select: { studentId: true, codeHash: true },
      })
    ).map((c) => [c.studentId, c.codeHash]),
  );
  const codes = await generateCodes(ids.length);
  return db.$transaction(
    async (tx) => {
      const e = await lockElection(tx, electionId, true);
      const rows = await tx.participation.findMany({
        where: { electionId, studentId: { in: ids } },
        include: { student: true },
      });
      allowed(e, rows);
      const currentCodes = await tx.credential.findMany({
        where: { electionId, studentId: { in: ids } },
        select: { studentId: true, codeHash: true },
      });
      requireState(
        currentCodes.length === ids.length &&
          currentCodes.every((c) => c.codeHash === versions.get(c.studentId)),
        "Otra operación acaba de reemplazar estos códigos. Consulta con el responsable antes de reemitirlos.",
      );
      requireState(
        rows.every((p) => p.student.active),
        "Hay estudiantes institucionalmente inactivos en la solicitud.",
      );
      const expiresAt = credentialExpiry(e.windows),
        issued: IssuedCode[] = [];
      for (let i = 0; i < ids.length; i++) {
        const p = rows.find((p) => p.studentId === ids[i])!;
        await tx.credential.update({
          where: {
            electionId_studentId: { electionId, studentId: p.studentId },
          },
          data: {
            codeHash: codes[i].hash,
            expiresAt,
            attempts: 0,
            lockedUntil: null,
            active: p.state === "PENDIENTE",
          },
        });
        await tx.voterSession.updateMany({
          where: { electionId, studentId: p.studentId },
          data: { revoked: true },
        });
        issued.push({
          studentId: p.studentId,
          displayName: p.displayName,
          grade: p.grade,
          section: p.section,
          shift: p.shift,
          accessCode: codes[i].code,
          expiresAt: expiresAt.toISOString(),
        });
      }
      await audit(tx, adminId, electionId, "CREDENTIALS_REISSUED", {
        count: issued.length,
        reason: input.reason,
        ...(input.batchId
          ? { batchId: input.batchId }
          : { studentId: input.studentId! }),
      });
      return { count: issued.length, credentials: issued };
    },
    { timeout: 60000 },
  );
}
