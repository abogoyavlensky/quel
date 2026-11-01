import { Toaster as Sonner, type ToasterProps } from "sonner";

// The app's notices (lib/notify.ts) in its tokens and shapes: a popover
// card, its action as the app's soft accent button, and a close button on
// each one. Light, as the app is.
export function Toaster(props: ToasterProps) {
  return (
    <Sonner
      theme="light"
      position="bottom-right"
      closeButton
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
