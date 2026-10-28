import { Toaster as Sonner, type ToasterProps } from "sonner";

// Toasts in the app's tokens; the scheme follows the system, as the rest
// of the app does.
export function Toaster(props: ToasterProps) {
  return (
    <Sonner
      theme="system"
      position="bottom-right"
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
        } as React.CSSProperties
      }
      {...props}
    />
  );
}
