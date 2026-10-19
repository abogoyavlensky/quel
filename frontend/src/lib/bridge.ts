import { Call, Events } from "@wailsio/runtime";

// The one bound method the wails package exposes: it dispatches by handler
// name to the let-go fns registered in quel.api.
export const BRIDGE =
  "github.com/abogoyavlensky/letgo-packages/wails/shim.Bridge.Call";

// Call a backend handler. A throw on the let-go side rejects the promise
// with its message.
export function call<T>(name: string, ...args: unknown[]): Promise<T> {
  return Call.ByName(BRIDGE, name, args) as Promise<T>;
}

// Listen for an event the backend emits (menu actions, ...). Returns the
// fn that removes the listener.
export function onEvent(name: string, fn: (data: unknown) => void): () => void {
  return Events.On(name, (ev) => fn(ev.data));
}
