import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { FindPanel } from "./FindPanel";
import { GoToLinePanel } from "./GoToLinePanel";
import { panelSnapshot, subscribePanels } from "./panels";

// The editor's panels, portalled into the dom CodeMirror made for them
// (editor/panels.ts). A rebuilt panel has a new dom, hence a new key: its
// controls remount and take focus again if a command opened it.

const ids = new WeakMap<HTMLElement, number>();
let nextId = 0;
const keyOf = (dom: HTMLElement) => {
  let id = ids.get(dom);
  if (id === undefined) ids.set(dom, (id = ++nextId));
  return String(id);
};

export function EditorPanels() {
  const s = useSyncExternalStore(subscribePanels, panelSnapshot);
  return (
    <>
      {s.find ? createPortal(<FindPanel host={s.find} rev={s.rev} />, s.find.dom, keyOf(s.find.dom)) : null}
      {s.goto ? createPortal(<GoToLinePanel host={s.goto} rev={s.rev} />, s.goto.dom, keyOf(s.goto.dom)) : null}
    </>
  );
}
