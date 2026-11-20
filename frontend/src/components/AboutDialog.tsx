import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import icon from "@/assets/quel-icon.png";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import * as api from "@/lib/api";
import { openUrl } from "@/lib/browser";
import { copyText } from "@/lib/clipboard";
import { notify } from "@/lib/notify";
import type { AppInfo } from "@/lib/types";
import { closeAbout, restoreAboutFocus } from "@/state/about";
import { useApp } from "@/state/store";
import { checkForUpdates } from "@/state/updates";

// About Quel: Quel > About Quel… (quel.menu) or the palette. The version,
// OS and architecture come from the backend (app-info), read each time it
// opens; until the answer arrives the version line is blank. Check for
// Updates closes it first, so the update dialog never opens on top of it.

const REPO = "https://github.com/abogoyavlensky/quel";
const COPIED_MS = 1500;

const versionInfo = (i: AppInfo) => `Quel ${i.version} (${i.os} ${i.arch})`;

export function AboutDialog() {
  const open = useApp((s) => s.aboutOpen);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    let live = true;
    api.appInfo().then(
      (i) => {
        if (live) setInfo(i);
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, [open]);

  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), COPIED_MS);
    return () => {
      clearTimeout(id);
    };
  }, [copied]);

  const copy = async () => {
    if (!info) return;
    if (await copyText(versionInfo(info))) setCopied(true);
    else notify.error("Could not copy.");
  };

  const checkUpdates = () => {
    closeAbout();
    void checkForUpdates({ manual: true });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && closeAbout()}>
      <DialogContent
        className="sm:max-w-sm"
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          restoreAboutFocus();
        }}
      >
        <div className="flex flex-col items-center gap-1 pt-2 text-center">
          <img src={icon} alt="" width={96} height={96} className="mb-2 size-24 select-none" draggable={false} />
          <DialogTitle className="text-lg">Quel</DialogTitle>
          <p className="h-5 text-sm text-muted-foreground tabular-nums">{info ? `Version ${info.version}` : ""}</p>
          <DialogDescription>A database client</DialogDescription>
        </div>

        <div className="flex flex-col gap-2">
          <Button onClick={checkUpdates}>Check for Updates</Button>
          <Button variant="outline" disabled={!info} onClick={() => void copy()}>
            {copied ? <Check /> : <Copy />}
            {copied ? "Copied" : "Copy version info"}
          </Button>
        </div>

        <div className="flex justify-center gap-4 text-sm">
          <a
            href={REPO}
            className="underline underline-offset-4"
            onClick={(e) => {
              e.preventDefault();
              void openUrl(REPO);
            }}
          >
            GitHub
          </a>
          <a
            href={`${REPO}/releases`}
            className="underline underline-offset-4"
            onClick={(e) => {
              e.preventDefault();
              void openUrl(`${REPO}/releases`);
            }}
          >
            Release notes
          </a>
        </div>

        <p className="text-center text-xs text-muted-foreground">MIT License · © 2026 Andrey Bogoyavlenskiy</p>
      </DialogContent>
    </Dialog>
  );
}
