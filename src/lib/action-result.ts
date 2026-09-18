export type ActionResult = { ok: true; message?: string } | { ok: false; error: string } | null;

// Thrown for failures whose message is safe and useful to show the user.
export class ActionError extends Error {}
