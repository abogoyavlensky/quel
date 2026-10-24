import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Button } from "@/components/ui/button";
import { SqlEditor } from "@/editor/SqlEditor";
import { retryLoad } from "@/state/runner";
import { activeTabOf, selectedWorkspace, useApp } from "@/state/store";
import { ConnectionsPanel } from "./ConnectionsPanel";
import { EditorTabs } from "./EditorTabs";
import { ProfileDialog } from "./ProfileDialog";
import { ResultTabs } from "./ResultTabs";
import { StatusBar } from "./StatusBar";
import { StructureTree } from "./StructureTree";

// The window: the connections on the left, the selected profile's
// structure under them; on the right that profile's workspace: its editor
// tabs, the active tab's editor above its results; the status bar below
// all.
export function AppShell() {
  const workspace = useApp(selectedWorkspace);
  // The editor's dialect comes from the profile, connected or not.
  const engine = useApp((s) => s.profiles.find((p) => p.id === s.selected)?.engine ?? null);
  const selected = useApp((s) => s.selected);
  const tab = workspace && activeTabOf(workspace);

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
        <ResizablePanel defaultSize="22" minSize={180} className="bg-muted/20">
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
        <ResizablePanel minSize={360}>
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
                  <SqlEditor tabId={tab.id} engine={engine} />
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
      </ResizablePanelGroup>
      <StatusBar />
      <ProfileDialog />
    </div>
  );
}
