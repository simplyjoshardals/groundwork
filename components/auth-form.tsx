"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";
import {
  describeAuthError,
  parseCredentials,
  MIN_PASSWORD_LENGTH,
  type AuthMode,
  type FieldErrors,
} from "@/lib/auth/credentials";
import { useCaptcha } from "@/components/captcha-provider";
import { CheckEmailNotice } from "@/components/check-email-notice";
import { OfflineBanner } from "@/components/offline-banner";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { useOnlineStatus } from "@/lib/net/use-online-status";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import {
  CAPTCHA_REJECTED_MESSAGE,
  CAPTCHA_WAIT_MESSAGE,
  isCaptchaRejection,
} from "@/lib/turnstile/state";

type Status = "idle" | "pending" | "check_email";

const COPY: Record<
  AuthMode,
  { submit: string; pending: string; autoComplete: string }
> = {
  "sign-in": {
    submit: "Sign in",
    pending: "Signing in…",
    autoComplete: "current-password",
  },
  "sign-up": {
    submit: "Create account",
    pending: "Creating account…",
    autoComplete: "new-password",
  },
};

/**
 * Email and password form for sign-in and sign-up, talking to Supabase Auth
 * directly from the browser (publishable key; the session lands in cookies).
 * `next` is already validated by the server page. Supabase CAPTCHA protection
 * covers sign-up and sign-in too, so the form carries the Turnstile token that
 * `CaptchaProvider` shares with the rest of the page (single use: every attempt
 * that spent it and stays on the page asks the widget for a new one).
 */
export function AuthForm({
  mode,
  next,
  title,
  notice,
  footer,
}: {
  mode: AuthMode;
  next: string;
  /** The page's `h1`. Replaced by "Check your email" once the link is sent. */
  title: string;
  /** A warn banner above the form (for example an expired confirmation link). */
  notice?: string;
  /** Links and the demo block below the form; hidden with the form on success. */
  footer?: ReactNode;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("idle");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const { state: captcha, dispatch: dispatchCaptcha } = useCaptcha();
  const online = useOnlineStatus();
  const pending = status === "pending";

  function enter() {
    router.replace(next);
    // Re-render the server components with the new session cookies.
    router.refresh();
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const data = new FormData(event.currentTarget);
    const parsed = parseCredentials(
      { email: data.get("email"), password: data.get("password") },
      mode,
    );
    if (!parsed.ok) {
      setFieldErrors(parsed.fieldErrors);
      setFormError(null);
      return;
    }

    if (captcha.status !== "verified") {
      setFieldErrors({});
      setFormError(CAPTCHA_WAIT_MESSAGE);
      return;
    }
    const captchaToken = captcha.token;

    setFieldErrors({});
    setFormError(null);
    setStatus("pending");
    try {
      const auth = createBrowserSupabase().auth;
      if (mode === "sign-in") {
        const { error } = await auth.signInWithPassword({
          ...parsed.value,
          options: { captchaToken },
        });
        if (error) {
          console.warn(`[auth] sign-in failed: ${error.code ?? error.name}`);
          setFormError(
            isCaptchaRejection(error)
              ? CAPTCHA_REJECTED_MESSAGE
              : describeAuthError(error),
          );
          setStatus("idle");
          dispatchCaptcha({ type: "reset" });
          return;
        }
        enter();
        return;
      }

      const { data: result, error } = await auth.signUp({
        ...parsed.value,
        options: {
          captchaToken,
          emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
        },
      });
      if (error) {
        console.warn(`[auth] sign-up failed: ${error.code ?? error.name}`);
        setFormError(
          isCaptchaRejection(error)
            ? CAPTCHA_REJECTED_MESSAGE
            : describeAuthError(error),
        );
        setStatus("idle");
        dispatchCaptcha({ type: "reset" });
        return;
      }
      if (result.session) {
        enter();
        return;
      }
      // Email confirmation is on: no session until the link is opened. The
      // same message is shown for an already-registered address, because
      // Supabase deliberately does not reveal that case.
      setSentTo(parsed.value.email);
      setStatus("check_email");
      // The token was spent and this page stays mounted (the link back to
      // sign-in keeps the provider), so ask for a fresh one.
      dispatchCaptcha({ type: "reset" });
    } catch (err) {
      console.error("[auth] request failed:", err);
      setFormError(describeAuthError(null));
      setStatus("idle");
      dispatchCaptcha({ type: "reset" });
    }
  }

  if (status === "check_email") {
    return <CheckEmailNotice email={sentTo} />;
  }

  const copy = COPY[mode];
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-h1 font-semibold">{title}</h1>
      {notice ? <Banner tone="warn">{notice}</Banner> : null}
      <OfflineBanner>You’re offline.</OfflineBanner>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        {formError ? <Banner tone="danger">{formError}</Banner> : null}
        <fieldset disabled={pending} className="flex min-w-0 flex-col gap-4">
          <Field
            id={`${mode}-email`}
            name="email"
            type="email"
            label="Email"
            autoComplete="email"
            required
            error={fieldErrors.email}
          />
          <Field
            id={`${mode}-password`}
            name="password"
            type="password"
            label="Password"
            autoComplete={copy.autoComplete}
            required
            helper={
              mode === "sign-up"
                ? `At least ${MIN_PASSWORD_LENGTH} characters.`
                : undefined
            }
            error={fieldErrors.password}
          />
          <Button
            type="submit"
            className="w-full"
            disabled={captcha.status !== "verified" || !online}
          >
            {pending ? copy.pending : copy.submit}
          </Button>
        </fieldset>
      </form>
      {footer}
    </div>
  );
}