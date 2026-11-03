import { useState } from "react";
import { DownloadIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { CsvSeparator, ExportFormat } from "@/grid/export";
import { exportResult, setExport } from "@/state/runner";
import { type ResultTab, useApp } from "@/state/store";

// The results footer's Export button: a popover to pick the format (and, for
// CSV, the separator), then copy the result or save it to a file. The
// choice is app-wide (AppState.export), so it opens as it was left.

const FORMATS: { value: ExportFormat; label: string }[] = [
  { value: "csv", label: "CSV" },
  { value: "json", label: "JSON" },
  { value: "markdown", label: "Markdown" },
];

const SEPARATORS: { value: CsvSeparator; label: string }[] = [
  { value: ",", label: "Comma" },
  { value: ";", label: "Semicolon" },
  { value: "\t", label: "Tab" },
];

export function ExportMenu({ tabId, result }: { tabId: string; result: ResultTab }) {
  const { format, separator } = useApp((s) => s.export);
  const [open, setOpen] = useState(false);
  // The export is loading the rest of an open result (the results footer shows
  // the progress): both buttons are disabled until it is done.
  const [busy, setBusy] = useState(false);

  async function run(action: "copy" | "save") {
    setBusy(true);
    try {
      await exportResult(tabId, result.id, action);
    } finally {
      setBusy(false);
      setOpen(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="xs">
          <DownloadIcon data-icon="inline-start" />
          Export
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" side="top" className="w-64">
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          spacing={0}
          aria-label="Format"
          value={format}
          onValueChange={(v) => {
            // Clicking the selected item clears the value: keep one chosen.
            if (v) setExport({ format: v as ExportFormat });
          }}
          className="w-full"
        >
          {FORMATS.map((f) => (
            <ToggleGroupItem key={f.value} value={f.value} className="flex-1">
              {f.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        {format === "csv" && (
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="export-separator">Separator</Label>
            <Select value={separator} onValueChange={(v) => setExport({ separator: v as CsvSeparator })}>
              <SelectTrigger id="export-separator" size="sm" className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {SEPARATORS.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="flex-1" disabled={busy} onClick={() => void run("copy")}>
            Copy
          </Button>
          <Button size="sm" className="flex-1" disabled={busy} onClick={() => void run("save")}>
            Save
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
