import { QueryClient } from "@tanstack/react-query";

// The one query client, for metadata reads (the structure tree and the
// editor's completion). Nothing refetches on its own: a failed read shows
// its error and a Retry, and cached metadata is reloaded only when the
// user presses the tree's refresh button.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, staleTime: Infinity, refetchOnWindowFocus: false },
  },
});

// Every key holds the conn-id, so a reconnect (a new conn-id) never sees
// the previous connection's data; all(connId) covers everything cached
// for one connection.
export const metaKeys = {
  all: (connId: string) => ["meta", connId] as const,
  schemas: (connId: string) => ["meta", connId, "schemas"] as const,
  schema: (connId: string, schema: string) => ["meta", connId, "schema", schema] as const,
  object: (connId: string, schema: string, name: string) => ["meta", connId, "object", schema, name] as const,
  completion: (connId: string) => ["meta", connId, "completion"] as const,
};
