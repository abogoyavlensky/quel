import { Toaster as Sonner, type ToasterProps } from "sonner";

// Toasts in the app's tokens and shapes: a popover card, and its action as
// the app's soft accent button. Light, as the app is.
export function Toaster(props: ToasterProps) {
  return (
    <Sonner
      theme="light"
      position="bottom-right"
      toastOptions={{
        classNames: {
          toast: "!rounded-xl !shadow-lg !text-sm !gap-2.5 !py-3 !px-3.5",
          icon: "!text-muted-foreground",
          actionButton:
            "!h-7 !rounded-md !bg-primary/10 !px-2.5 !text-xs !font-medium !text-primary hover:!bg-primary/15",
        },
      }}
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
