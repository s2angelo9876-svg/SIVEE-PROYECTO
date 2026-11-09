import crypto from "node:crypto";
import type { Tx } from "./services.js";
import { audit } from "./services.js";
import { dniLookup } from "./security.js";
import { decryptDocument } from "./private-data.js";
import { schoolIssues } from "./school-files.js";
import { schoolShift } from "./school-shifts.js";

export async function schoolRecords(tx: Tx, electionId: string) {
  const stored = await tx.schoolDraft.findMany({
    where: { electionId },
    orderBy: [{ grade: "asc" }, { section: "asc" }, { displayName: "asc" }],
  });
  const rows = stored.map(({ documentEncrypted, ...row }) => ({
    ...row,
    document: decryptDocument(documentEncrypted),
    shift: schoolShift(row.grade, row.section) ?? row.shift,
  }));
  const frequencies = new Map<string, number>();
  for (const r of rows)
    if (!r.excluded && r.document)
      frequencies.set(r.document, (frequencies.get(r.document) || 0) + 1);
  return rows.map((r) => ({
    ...r,
    issues: [
      ...schoolIssues(r),
      ...(!r.excluded && r.document && frequencies.get(r.document)! > 1
        ? ["DNI repetido; no se crea otra inscripción."]
        : []),
    ],
  }));
}

export async function registerSchoolRecords(
  tx: Tx,
  election: { id: string; institutionId: string; windows: { shift: string }[] },
  adminId: string,
) {
  const rows = await schoolRecords(tx, election.id);
  const candidates = rows.filter(
    (r) => !r.publishedAt && !r.excluded && !r.issues.length,
  );
  if (!candidates.length) return { count: 0 };
  const existing = await tx.student.findMany({
    where: {
      institutionId: election.institutionId,
      dniLookup: { in: candidates.map((r) => dniLookup(r.document)) },
    },
    include: { participations: { where: { electionId: election.id } } },
  });
  const byDni = new Map(existing.map((s) => [s.dniLookup, s]));
  const students = [],
    participations = [],
    registeredIds: string[] = [];
  for (const r of candidates) {
    const key = dniLookup(r.document),
      old = byDni.get(key);
    if (old && !old.active) continue;
    const id = old?.id || crypto.randomUUID();
    const profile = {
      displayName: r.displayName,
      grade: r.grade,
      section: r.section,
      // Compatibility field for unclassified sections; never gates DNI access.
      shift: r.shift ?? old?.shift ?? election.windows[0].shift,
    };
    if (!old)
      students.push({
        id,
        institutionId: election.institutionId,
        dniLookup: key,
        ...profile,
      });
    if (!old?.participations.length)
      participations.push({
        electionId: election.id,
        studentId: id,
        ...profile,
      });
    registeredIds.push(r.id);
  }
  if (students.length) await tx.student.createMany({ data: students });
  if (participations.length)
    await tx.participation.createMany({ data: participations });
  if (registeredIds.length) {
    await tx.schoolDraft.updateMany({
      where: { id: { in: registeredIds } },
      data: { publishedAt: new Date(), version: { increment: 1 } },
    });
    await audit(tx, adminId, election.id, "SCHOOL_ROSTER_REGISTERED", {
      count: participations.length,
      records: registeredIds.length,
    });
  }
  return { count: participations.length };
}
