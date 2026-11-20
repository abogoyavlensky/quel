import { markPieces } from "./markPieces";

// A plain value with the row details filter's matches highlighted.
export function MarkedText({ text, ranges }: { text: string; ranges: ReadonlyArray<[number, number]> }) {
  return <>{ranges.length === 0 ? text : markPieces(text, 0, ranges, "m")}</>;
}
