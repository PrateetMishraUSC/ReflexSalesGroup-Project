// Entry point for business rules: clean every extracted line, then evaluate the whole offer.
import type { ExtractedOffer } from "@/lib/parse/extract";
import { cleanLine } from "./clean-line";
import { evaluateOffer } from "./offer";

export function reviewOffer(extracted: ExtractedOffer) {
  return evaluateOffer(extracted.lines.map((line) => ({ ...cleanLine(line), decision: null })));
}
