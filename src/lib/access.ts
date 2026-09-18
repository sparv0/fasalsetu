// Site-wide access gate. When ACCESS_CODE is set, every page and action requires a cookie that
// proves the visitor entered the code. The cookie holds a hash, never the code itself.
export const ACCESS_COOKIE = "fs_access";

export async function accessToken(code: string): Promise<string> {
  const data = new TextEncoder().encode(`fasalsetu-access:v1:${code}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function accessCode(): string | undefined {
  return process.env.ACCESS_CODE?.trim() || undefined;
}

export function safeNext(next: string | null | undefined): string {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/access") ? next : "/";
}
