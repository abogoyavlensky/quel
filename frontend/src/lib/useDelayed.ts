import { useEffect, useState } from "react";

// True once value has been true for ms; false at once when it is not.
export function useDelayed(value: boolean, ms: number): boolean {
  const [elapsed, setElapsed] = useState(false);
  useEffect(() => {
    if (!value) return;
    const id = setTimeout(() => setElapsed(true), ms);
    return () => {
      clearTimeout(id);
      setElapsed(false);
    };
  }, [value, ms]);
  return value && elapsed;
}
