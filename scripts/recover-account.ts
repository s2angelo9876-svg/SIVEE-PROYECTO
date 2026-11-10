import "dotenv/config";
import { z } from "zod";
import { config } from "../apps/api/src/config.js";
import { db } from "../apps/api/src/db.js";
import { passwordHash, requireState } from "../apps/api/src/security.js";
import { audit } from "../apps/api/src/services.js";
try {
  requireState(
    config.SIVEE_ENV === "production",
    "La recuperación requiere entorno oficial.",
  );
  const input = z
    .object({
      RECOVERY_EMAIL: z.email(),
      RECOVERY_PASSWORD: z.string().min(16).max(200),
      RECOVERY_REASON: z.string().trim().min(15).max(300),
    })
    .parse(process.env);
  const password = await passwordHash(input.RECOVERY_PASSWORD);
  await db.$transaction(async (tx) => {
    const user = await tx.admin.findUniqueOrThrow({
      where: { email: input.RECOVERY_EMAIL.toLowerCase() },
    });
    requireState(
      user.active,
      "Reactiva la cuenta por el procedimiento del comité.",
    );
    await tx.admin.update({
      where: { id: user.id },
      data: { passwordHash: password, mfaSecret: null, mfaEnabled: false },
    });
    await tx.adminSession.updateMany({
      where: { adminId: user.id },
      data: { revoked: true },
    });
    await audit(tx, user.id, null, "ACCOUNT_RECOVERED_BY_OPERATOR", {
      reason: input.RECOVERY_REASON,
    });
  });
  console.log(
    "Cuenta recuperada y sesiones revocadas. Verifica al titular, entrega la contraseña de forma privada e ingresa con correo y contraseña. Retira RECOVERY_PASSWORD del entorno.",
  );
} catch {
  console.error(
    "No se recuperó la cuenta. Comprueba entorno, correo, motivo y contraseña de al menos 16 caracteres.",
  );
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
