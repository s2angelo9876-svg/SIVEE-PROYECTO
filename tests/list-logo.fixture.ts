import { deflateSync, crc32 } from "node:zlib";
export function logoPng(width = 2, height = 2, payloadBytes = 0) {
  const chunk = (kind: string, data: Buffer) => {
    const type = Buffer.from(kind),
      size = Buffer.alloc(4),
      checksum = Buffer.alloc(4);
    size.writeUInt32BE(data.length);
    checksum.writeUInt32BE(crc32(Buffer.concat([type, data])));
    return Buffer.concat([size, type, data, checksum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const pixels = Buffer.alloc((1 + width * 3) * height, 64);
  for (let y = 0; y < height; y++) pixels[y * (1 + width * 3)] = 0;
  const chunks = [
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(pixels)),
  ];
  if (payloadBytes) chunks.push(chunk("tEXt", Buffer.alloc(payloadBytes, 65)));
  chunks.push(chunk("IEND", Buffer.alloc(0)));
  return Buffer.concat(chunks);
}
export const logoData = (image: Buffer) =>
  "data:image/png;base64," + image.toString("base64");
