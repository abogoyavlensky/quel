import { toast } from "sonner";

// The app's one way to tell the user something short: a toast at the
// bottom right, drawn by the Toaster (components/ui/sonner.tsx), which also
// gives each one a close button. Code outside this file does not import
// sonner. Pass an id to replace a notice rather than stack another.
export interface NoticeOptions {
  id?: string;
  action?: { label: string; onClick: () => void };
}

export const notify = {
  success: (message: string, options?: NoticeOptions) => toast.success(message, options),
  error: (message: string, options?: NoticeOptions) => toast.error(message, options),
  info: (message: string, options?: NoticeOptions) => toast(message, options),
  dismiss: (id?: string) => toast.dismiss(id),
};
