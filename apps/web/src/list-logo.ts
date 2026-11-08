export async function readListLogo(file: File): Promise<string> {
  if (
    !["image/png", "image/jpeg"].includes(file.type) ||
    file.size > 5 * 1024 * 1024
  )
    throw new Error("Selecciona un logo PNG o JPG de hasta 5 MB.");
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(
      "No se pudo leer el logo. Selecciona otra imagen PNG o JPG.",
    );
  }
  try {
    const scale = Math.min(1, 256 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context)
      throw new Error(
        "No se pudo preparar el logo. Prueba con otro navegador.",
      );
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const data = canvas.toDataURL("image/png");
    if (data.length > 400100)
      throw new Error(
        "La imagen es demasiado grande. Selecciona un logo más pequeño.",
      );
    return data;
  } finally {
    bitmap.close();
  }
}
