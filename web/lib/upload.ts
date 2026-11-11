// Picks the right reader for an uploaded model file, by its name and contents.
import type { ModelData } from "./engine";
import { parseStella, StellaError } from "./stella";
import { parseVensim, VensimError } from "./vensim";

/** A problem with the uploaded file, worded for the student. */
export class UploadError extends Error {}

export const SUPPORTED = "Stella (.stmx), XMILE (.xmile or .xml) or Vensim (.mdl)";

export function parseModelFile(fileName: string, text: string): ModelData {
  const name = fileName.toLowerCase();
  if (/\.(png|jpe?g|gif|webp|heic|pdf)$/.test(name)) {
    throw new UploadError(`Pictures and PDFs are not supported yet. Please upload a ${SUPPORTED} file.`);
  }
  try {
    if (/\.mdl$/.test(name)) return parseVensim(text);
    if (/\.(stmx|xmile|xml|itmx)$/.test(name) || /<xmile[\s>]/.test(text.slice(0, 2000))) {
      const data = parseStella(text);
      if (!/\.stmx$/.test(name)) data.source = "an uploaded XMILE file";
      return data;
    }
    throw new UploadError(`That file isn't a model this tutor can read. Please upload a ${SUPPORTED} file.`);
  } catch (err) {
    if (err instanceof StellaError || err instanceof VensimError) throw new UploadError(err.message);
    throw err;
  }
}
