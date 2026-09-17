// App errors that map to clear API responses: not found, version conflict, invalid edits, blocked save, retry keys, simulated failure.
import type { Issue } from "@/lib/rules/issues";

export class IdempotencyKeyReusedError extends Error {
  constructor() {
    super("This retry key was already used for a different request. Start a new upload or edit.");
    this.name = "IdempotencyKeyReusedError";
  }
}

export class SimulatedFailureError extends Error {
  constructor(public readonly point: "before-commit" | "after-commit") {
    super(`Simulated failure ${point}`);
    this.name = "SimulatedFailureError";
  }
}

export class NotFoundError extends Error {
  constructor(what = "Offer") {
    super(`${what} not found.`);
    this.name = "NotFoundError";
  }
}

export class VersionConflictError extends Error {
  constructor(public readonly currentVersion: number) {
    super("This offer was changed in another window. Reload to see the latest version, then try again.");
    this.name = "VersionConflictError";
  }
}

export class InvalidEditError extends Error {
  constructor(public readonly issues: Issue[]) {
    super(issues.map((issue) => issue.message).join(" "));
    this.name = "InvalidEditError";
  }
}

export class DecisionNotAllowedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DecisionNotAllowedError";
  }
}

export class NeedsReviewRemainingError extends Error {
  constructor(public readonly count: number) {
    super(`${count} line${count === 1 ? " still needs" : "s still need"} review. Correct or leave them out before saving.`);
    this.name = "NeedsReviewRemainingError";
  }
}
