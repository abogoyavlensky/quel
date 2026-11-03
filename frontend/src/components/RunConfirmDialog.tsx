import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { ConfirmReason } from "@/sql/guard";
import { answerRunConfirm } from "@/state/runner";
import { useApp } from "@/state/store";
import { ConnMark } from "./ConnMark";

// At most this many statements are listed; the rest are counted.
const SHOWN = 5;

const why: Record<ConfirmReason, string> = {
  writes: "These statements may change data or structure.",
  always: "This connection asks before every query.",
  unknown: "This connection is read-only, and Quel can't tell whether these statements change anything.",
};

// The question a run policy asks before a run (state/runner.ts). Cancel
// has the focus when it opens (Radix's default for an alert dialog), so a
// reflexive Enter runs nothing; Escape and Cancel answer No. An alert
// dialog does not close on an outside click.
export function RunConfirmDialog() {
  const q = useApp((s) => s.runConfirm);
  const profile = useApp((s) => s.profiles.find((p) => p.id === s.runConfirm?.profileId));
  if (!q) return null;
  const more = q.statements.length - SHOWN;

  return (
    <AlertDialog open onOpenChange={(open) => !open && answerRunConfirm(false)}>
      <AlertDialogContent className="sm:max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            {profile && <ConnMark engine={profile.engine} color={profile.color} />}
            Run on {profile?.name ?? "this connection"}?
          </AlertDialogTitle>
          <AlertDialogDescription>{why[q.reason]}</AlertDialogDescription>
        </AlertDialogHeader>
        <ul aria-label="Statements" className="flex min-w-0 flex-col gap-1.5">
          {q.statements.slice(0, SHOWN).map((sql, i) => (
            <li key={i} className="min-w-0 rounded-md bg-muted px-2.5 py-1.5">
              <pre className="line-clamp-3 font-mono text-xs break-words whitespace-pre-wrap">{sql}</pre>
            </li>
          ))}
          {more > 0 && <li className="text-xs text-muted-foreground">and {more} more</li>}
        </ul>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={() => answerRunConfirm(true)}>
            {q.total === 1 ? "Run" : `Run ${q.total} statements`}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
