import PDFDocument from "pdfkit";
import { AppError } from "./security.js";

export function validateListLogo(symbol: string) {
  if (!symbol.startsWith("data:")) return; // Existing elections retain their stored symbols.
  const [header, base64] = symbol.split(",");
  const image = Buffer.from(base64, "base64");
  if (!image.length || image.length > 300000)
    throw new AppError(
      400,
      "INVALID_LOGO",
      "El logo debe ocupar como máximo 300 KB.",
    );
  const png = image
    .subarray(0, 8)
    .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = image[0] === 255 && image[1] === 216;
  if ((!png && !jpeg) || header !== `data:image/${png ? "png" : "jpeg"};base64`)
    throw new AppError(
      400,
      "INVALID_LOGO",
      "Selecciona una imagen PNG o JPG válida.",
    );
  const document = new PDFDocument();
  document.resume();
  try {
    const raster = (document as any).openImage(image);
    if (
      raster.width < 1 ||
      raster.height < 1 ||
      raster.width > 1024 ||
      raster.height > 1024
    )
      throw new AppError(
        400,
        "INVALID_LOGO",
        "El logo debe medir como máximo 1024 × 1024 píxeles.",
      );
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      400,
      "INVALID_LOGO",
      "No se pudo leer la imagen del logo.",
    );
  } finally {
    document.end();
  }
}
