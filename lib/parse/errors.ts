// Error type for files we refuse, with a stable code and a user-facing message.
export type UnsupportedFileCode =
  | "EMPTY_FILE"
  | "FILE_TOO_LARGE"
  | "LEGACY_XLS"
  | "NOT_XLSX"
  | "UNREADABLE"
  | "NO_HEADER"
  | "MISSING_COLUMNS"
  | "DUPLICATE_COLUMN"
  | "AMBIGUOUS_LAYOUT";

export class UnsupportedFileError extends Error {
  constructor(
    public readonly code: UnsupportedFileCode,
    message: string,
  ) {
    super(message);
    this.name = "UnsupportedFileError";
  }
}
