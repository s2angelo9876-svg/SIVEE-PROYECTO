import { db } from "../src/db.js";
import { config } from "../src/config.js";
import { passwordHash, dniLookup } from "../src/security.js";
import { rolePermissions } from "../../../packages/shared/domain.js";
if (config.SIVEE_ENV !== "demo" && config.SIVEE_ENV !== "test")
  throw new Error("Seed prohibido fuera de DEMO/TEST.");
// The committee account anchors the demo even after its institutional code is edited.
const existingCommittee = await db.admin.findUnique({
  where: { email: "comite@sivee.demo" },
  include: { institution: true },
});
const institution =
  existingCommittee?.institution ??
  (await db.institution.upsert({
    where: { code: "DEMO-2026" },
    create: {
      code: "DEMO-2026",
      name: "I.E. Nuevo Horizonte · Institución de demostración",
    },
    update: {},
  }));
for (const [email, name, role] of [
  ["comite@sivee.demo", "Comité Electoral", "COMITE"],
  ["observador@sivee.demo", "Docente observador", "OBSERVADOR"],
  ["operador@sivee.demo", "Operador de padrón", "OPERADOR"],
  ["tecnico@sivee.demo", "Administrador técnico", "ADMIN_TECNICO"],
]) {
  if (!(await db.admin.findUnique({ where: { email } })))
    await db.admin.create({
      data: {
        institutionId: institution.id,
        email,
        name,
        passwordHash: await passwordHash("DemoSivee2026!"),
        grants: {
          create: {
            role,
            electionScope: "*",
            permissions: rolePermissions[role],
          },
        },
      },
    });
}
if (
  !(await db.election.findFirst({ where: { institutionId: institution.id } }))
) {
  const e = await db.election.create({
    data: {
      institutionId: institution.id,
      name: "Elecciones del Municipio Escolar 2026",
      windows: { create: [{ shift: "MANANA" }, { shift: "TARDE" }] },
    },
  });
  const lists = [
    {
      number: 1,
      name: "Juntos por el cambio",
      symbol: "sprout",
      color: "#167568",
      candidate: "Valeria Ejemplo",
      proposal:
        "Una escuela más verde, espacios de escucha y actividades para todas y todos.",
    },
    {
      number: 2,
      name: "Voces del futuro",
      symbol: "sun",
      color: "#167568",
      candidate: "Mateo Demo",
      proposal:
        "Impulsamos el arte, el deporte y la participación de cada estudiante.",
    },
    {
      number: 3,
      name: "Unidos para crecer",
      symbol: "book",
      color: "#167568",
      candidate: "Camila Prueba",
      proposal:
        "Lectura compartida, convivencia respetuosa y nuevas oportunidades de aprender.",
    },
  ];
  for (const l of lists) {
    const { candidate, ...data } = l;
    await db.electoralList.create({
      data: {
        ...data,
        electionId: e.id,
        candidates: [
          { name: candidate, position: "Alcaldía escolar" },
          { name: "Equipo de regidores de ejemplo", position: "Regidurías" },
        ],
      },
    });
  }
  for (let i = 1; i <= 50; i++) {
    const shift = i <= 25 ? "MANANA" : "TARDE";
    const names = [
      "María Ejemplo",
      "Luis Demo",
      "Ana Prueba",
      "Carlos Ficticio",
      "Lucía Ejemplo",
    ];
    const student = await db.student.create({
      data: {
        institutionId: institution.id,
        dniLookup: dniLookup(String(i).padStart(8, "0")),
        displayName: `${names[(i - 1) % 5]} ${String(i).padStart(2, "0")}`,
        grade: String(1 + (i % 5)),
        section: i % 2 ? "A" : "B",
        shift,
      },
    });
    await db.participation.create({
      data: { electionId: e.id, studentId: student.id, shift },
    });
    await db.credential.create({
      data: {
        electionId: e.id,
        studentId: student.id,
        codeHash: await passwordHash(`DEMOCODE-${String(i).padStart(3, "0")}`),
        expiresAt: new Date(Date.now() + 30 * 86400000),
      },
    });
  }
  await db.audit.create({
    data: {
      electionId: e.id,
      action: "DEMO_SEEDED",
      detail: { students: 50, lists: 3 },
    },
  });
  console.log("Datos ficticios creados: 50 electores, 3 listas, 2 turnos.");
} else console.log("La DEMO ya existe; se conservaron los datos.");
await db.$disconnect();
