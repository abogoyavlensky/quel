import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { SqlEditor } from "@/editor/SqlEditor";
import { useApp } from "@/state/store";
import { ConnectionsPanel } from "./ConnectionsPanel";
import { EditorTabs } from "./EditorTabs";
import { ProfileDialog } from "./ProfileDialog";
import { ResultTabs } from "./ResultTabs";
import { StatusBar } from "./StatusBar";

// The window: the connections on the left; on the right the editor tabs, the
// active tab's editor above its results; the status bar below all.
export function AppShell() {
  const tab = useApp((s) => s.tabs.find((t) => t.id === s.activeTab)!);
  const engine = useApp((s) => s.conn?.engine ?? null);

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
        <ResizablePanel defaultSize="22" minSize={180} className="bg-muted/20">
          <ConnectionsPanel />
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel minSize={360}>
          <div className="flex h-full min-h-0 flex-col">
            <EditorTabs />
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
        </ResizablePanel>
      </ResizablePanelGroup>
      <StatusBar />
      <ProfileDialog />
    </div>
  );
}
