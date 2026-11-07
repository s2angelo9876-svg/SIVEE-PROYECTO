import type { Tx } from "./services.js";
import { AppError, hashSecret } from "./security.js";

export async function assertAdmission(
  tx: Tx,
  session: {
    admissionId?: string | null;
    studentId: string;
    electionId: string;
  },
  boothToken?: string,
) {
  if (!session.admissionId)
    throw new AppError(
      403,
      "DESK_REQUIRED",
      "La mesa debe autorizar esta cabina.",
    );
  const admission = await tx.admission.findUnique({
    where: { id: session.admissionId },
  });
  const booth =
    admission &&
    (await tx.booth.findUnique({ where: { id: admission.boothId } }));
  if (
    !admission ||
    !booth?.active ||
    !boothToken ||
    booth.electionId !== session.electionId ||
    booth.tokenHash !== hashSecret(boothToken) ||
    admission.studentId !== session.studentId ||
    admission.electionId !== session.electionId ||
    !["APPROVED", "CONSUMED"].includes(admission.state) ||
    +admission.expiresAt <= Date.now()
  )
    throw new AppError(
      401,
      "ADMISSION_EXPIRED",
      "La autorización terminó. Solicita ayuda a la mesa.",
    );
  return admission;
}
