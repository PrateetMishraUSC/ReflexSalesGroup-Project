// App errors that map to clear API responses: not found, reused retry key, simulated failure.
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
