// Entry point for parsing an uploaded file: open workbook, detect layout, extract candidate lines.
import { detectLayout } from "./detect";
import { extractLines, type ExtractedOffer } from "./extract";
import { readWorkbook } from "./workbook";

export function parseUpload(data: Buffer): ExtractedOffer {
  return extractLines(detectLayout(readWorkbook(data)));
}
