const clean = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
// Nomenclature supplied by the school: 1st A–G morning; 2nd–5th A–F morning.
const sections: Record<string, string[]> = {
  "1": [
    "Honestidad",
    "Respeto",
    "Solidaridad",
    "Honradez",
    "Generosidad",
    "Justicia",
    "Tolerancia",
    "Empatía",
    "Resiliencia",
    "Responsabilidad",
    "Perseverancia",
    "Puntualidad",
    "Amistad",
  ],
  "2": [
    "Bondad",
    "Sinceridad",
    "Paciencia",
    "Gratitud",
    "Humildad",
    "Altruismo",
    "Decencia",
    "Fidelidad",
    "Franqueza",
    "Independencia",
    "Lealtad",
    "Prudencia",
  ],
  "3": [
    "Ciro Alegría Bazán",
    "Abraham Valdelomar Pinto",
    "César Vallejo Mendoza",
    "José María Arguedas",
    "Mario Vargas Llosa",
    "Inca Garcilaso de la Vega",
    "Javier Luis Heraud Pérez",
    "Julio Ramón Ribeyro Zúñiga",
    "Manuel Escorza Torres",
    "José Santos Chocano",
    "Ricardo Palma Soriano",
  ],
  "4": [
    "Isaac Newton",
    "Leonhard Euler",
    "Carl Friedrich Gauss",
    "James Maxwell",
    "John Von Neumann",
    "Pierre de Fermat",
    "Albert Einstein",
    "Galileo Galilei",
    "Bernhard Riemann",
    "Federico Villarreal",
    "Santiago Antúnez de Mayolo",
  ],
  "5": [
    "Sócrates",
    "Tales de Mileto",
    "Tomás de Aquino",
    "Friedrich Wilhelm Nietzsche",
    "Nicolás Copérnico",
    "Aristóteles",
    "René Descartes",
    "Immanuel Kant",
    "Karl Heinrich Marx",
    "Friedrich Engels",
    "Platón",
  ],
};
const aliases: Record<string, string> = {
  JAVIERHERAUDPEREZ: "JAVIERLUISHERAUDPEREZ",
  LEONARDEULER: "LEONHARDEULER",
  JHONVONNEUMANN: "JOHNVONNEUMANN",
  THALESDEMILETO: "TALESDEMILETO",
  FRIEDRICHWILHELMNIETZCHE: "FRIEDRICHWILHELMNIETZSCHE",
};
export function schoolShift(
  grade: string,
  section: string,
): "MANANA" | "TARDE" | null {
  const names = sections[grade];
  if (!names) return null;
  const key = clean(section),
    canonical = aliases[key] || key;
  // Additional 2026 section, explicitly confirmed by the user.
  if (grade === "3" && key === "GABRIELGARCIAMARQUEZ") return "TARDE";
  const letter = section
    .trim()
    .toUpperCase()
    .match(/^(?:SECCI[ÓO]N\s+)?([A-M])(?:\s*[-:.)]\s*|$)/)?.[1];
  const index = letter
    ? letter.charCodeAt(0) - 65
    : names.findIndex((name) => clean(name) === canonical);
  if (index < 0 || index >= names.length) return null;
  return index < (grade === "1" ? 7 : 6) ? "MANANA" : "TARDE";
}
