export class AgentSdkError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "AgentSdkError";
  }
}

export class AgentModeError extends AgentSdkError {
  constructor(mode: string, operation: string) {
    super(`Agent mode '${mode}' cannot perform '${operation}'`, "agent.mode_not_allowed");
    this.name = "AgentModeError";
  }
}

export class AgentLeaseError extends AgentSdkError {
  constructor(message: string, code = "lease.invalid") {
    super(message, code);
    this.name = "AgentLeaseError";
  }
}

export class AgentConflictError extends AgentSdkError {
  constructor(message: string) {
    super(message, "conflict.precondition_failed");
    this.name = "AgentConflictError";
  }
}

export class AgentIsolationError extends AgentSdkError {
  constructor(message: string) {
    super(message, "workspace.isolation_denied");
    this.name = "AgentIsolationError";
  }
}

export class HandoffStateError extends AgentSdkError {
  constructor(message: string, code = "handoff.invalid_state") {
    super(message, code);
    this.name = "HandoffStateError";
  }
}
