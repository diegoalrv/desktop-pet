// Tipos de tools.mjs para el chat de Windows (src/lib/candolaChat.ts).
export type Tool = { name: string; description: string; inputSchema: Record<string, unknown> };
export const TOOLS: Tool[];
export function makeCall(
  api: (path: string, body: unknown) => Promise<unknown>,
  external?: boolean,
): (name: string, args?: Record<string, unknown>) => Promise<unknown>;
