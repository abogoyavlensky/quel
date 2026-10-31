import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Button } from "@/components/ui/button";
import { SqlEditor } from "@/editor/SqlEditor";
import { namespaceOf } from "@/editor/namespace";
import { type Completion, dialectFor } from "@/editor/setup";
import * as api from "@/lib/api";
import { metaKeys } from "@/lib/query";
import type { Engine } from "@/lib/types";
import { retryLoad } from "@/state/runner";
import { activeTabOf, selectedWorkspace, useApp } from "@/state/store";
import { ConnectionsPanel } from "./ConnectionsPanel";
import { EditorTabs } from "./EditorTabs";
import { ProfileDialog } from "./ProfileDialog";
import { ResultTabs } from "./ResultTabs";
import { RunButton } from "./RunButton";
import { RowDetails } from "./RowDetails";
import { StatusBar } from "./StatusBar";
import { StructureTree } from "./StructureTree";
import { TitleBar } from "./TitleBar";
import { UpdateDialog } from "./UpdateDialog";

// The window: the top strip naming the selected connection; under it the
// connections on the left, the selected profile's
// structure under them; on the right that profile's workspace: its editor
// tabs, the active tab's editor above its results; on the far right,
// while open, the row details panel; the status bar below all.
export function AppShell() {
  const workspace = useApp(selectedWorkspace);
  // The editor's dialect comes from the profile, connected or not.
  const engine = useApp((s) => s.profiles.find((p) => p.id === s.selected)?.engine ?? null);
  const selected = useApp((s) => s.selected);
  const tab = workspace && activeTabOf(workspace);
  const completion = useCompletion(workspace?.status === "connected" ? workspace.connId : null, engine);
  const rowDetails = useApp((s) => s.rowDetails);

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <TitleBar />
      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
        {/* Ids keep each panel's size while the row details come and go. */}
        <ResizablePanel id="sidebar" defaultSize="22" minSize={180} className="bg-chrome">
          <ResizablePanelGroup orientation="vertical">
            <ResizablePanel defaultSize="40" minSize={80}>
              <ConnectionsPanel />
            </ResizablePanel>
            <ResizableHandle />
            <ResizablePanel minSize={120}>
              <StructureTree />
            </ResizablePanel>
          </ResizablePanelGroup>
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel id="workspace" minSize={360}>
          {workspace?.loadError ? (
            <div role="alert" className="flex h-full flex-col items-center justify-center gap-3 p-6 text-sm">
              <p className="max-w-md text-center break-words text-destructive">
                Could not load the saved tabs: {workspace.loadError}
              </p>
              <Button size="sm" variant="outline" onClick={() => void retryLoad(workspace.profileId)}>
                Retry
              </Button>
            </div>
          ) : workspace && tab ? (
            <div className="flex h-full min-h-0 flex-col">
              <EditorTabs workspace={workspace} />
              <ResizablePanelGroup orientation="vertical" className="min-h-0 flex-1">
                <ResizablePanel defaultSize="45" minSize={80}>
                  <div className="relative h-full">
                    <SqlEditor tabId={tab.id} engine={engine} completion={completion} />
                    <RunButton key={tab.id} tab={tab} />
                  </div>
                </ResizablePanel>
                <ResizableHandle />
                <ResizablePanel minSize={120}>
                  <ResultTabs tab={tab} />
                </ResizablePanel>
              </ResizablePanelGroup>
            </div>
          ) : selected !== null ? (
            // Its tabs are loading.
            <div className="h-full" />
          ) : (
            <p className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Add a connection to start.
            </p>
          )}
        </ResizablePanel>
        {rowDetails && (
          <>
            <ResizableHandle />
            <ResizablePanel id="row-details" defaultSize="25" minSize={260}>
              <RowDetails />
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>
      <StatusBar />
      <ProfileDialog />
      <UpdateDialog />
    </div>
  );
}

// The connected database's names for the editor's completion, cached with
// the structure tree's metadata. The same object until the data changes,
// so the editor reconfigures only then.
function useCompletion(connId: string | null, engine: Engine | null): Completion | null {
  const { data } = useQuery({
    queryKey: metaKeys.completion(connId ?? ""),
    queryFn: () => api.completionSchema(connId!),
    enabled: connId !== null,
  });
  return useMemo(
    () =>
      connId && data
        ? { schema: namespaceOf(data, dialectFor(engine)), defaultSchema: data["default-schema"] ?? undefined, raw: data }
        : null,
    [connId, data, engine],
  );
}
