import type { ReactNode } from "react";
import { CaptchaProvider } from "@/components/captcha-provider";
import { PlainHeader } from "@/components/plain-header";
import { Card } from "@/components/ui/card";

/**
 * The centered auth card (DESIGN 4.1, 6.2). The CAPTCHA provider stays here:
 * sign-in and sign-up both send a Turnstile token to Supabase, so the forms
 * need it. It sits inside the card, so the widget lands at the bottom of the
 * card rather than below the page. The pages own their spacing and the invisible
 * widget adds none, so the card's bottom padding matches its top. One provider
 * for both pages means moving between them does not start a new check.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <PlainHeader />
      <main className="flex flex-1 items-start justify-center px-4 pb-12 pt-8 md:items-center md:px-6">
        <Card padding="roomy" className="w-full max-w-[26rem] md:p-8">
          <CaptchaProvider>{children}</CaptchaProvider>
        </Card>
      </main>
    </>
  );
}
