import type { ReactNode } from "react";
import { CaptchaProvider } from "@/components/captcha-provider";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-6 p-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Groundwork</h1>
        <p>
          Ask questions about documents and see where each answer comes from.
        </p>
      </header>
      <CaptchaProvider>{children}</CaptchaProvider>
    </main>
  );
}
