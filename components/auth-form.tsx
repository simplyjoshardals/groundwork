"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import {
  describeAuthError,
  parseCredentials,
  MIN_PASSWORD_LENGTH,
  type AuthMode,
  type FieldErrors,
} from "@/lib/auth/credentials";
import { useCaptcha } from "@/components/captcha-provider";
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
  notice,
}: {
  mode: AuthMode;
  next: string;
  notice?: string;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("idle");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const { state: captcha, dispatch: dispatchCaptcha } = useCaptcha();
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
    return (
      <div role="status" className="flex flex-col gap-2 text-sm">
        <p className="font-medium">Check your email</p>
        <p>
          If {sentTo ? <strong>{sentTo}</strong> : "that address"} can be used
          to sign up, a confirmation link is on its way. Open it to finish
          creating your account.
        </p>
        <Link href="/sign-in" className="underline">
          Back to sign in
        </Link>
      </div>
    );
  }

  const copy = COPY[mode];
  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      {notice ? (
        <p role="alert" className="text-sm text-danger">
          {notice}
        </p>
      ) : null}
      <fieldset disabled={pending} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor={`${mode}-email`} className="text-sm font-medium">
            Email
          </label>
          <input
            id={`${mode}-email`}
            name="email"
            type="email"
            autoComplete="email"
            required
            aria-invalid={fieldErrors.email ? true : undefined}
            aria-describedby={
              fieldErrors.email ? `${mode}-email-error` : undefined
            }
            className="rounded-md border border-control px-3 py-2 text-sm"
          />
          {fieldErrors.email ? (
            <p id={`${mode}-email-error`} className="text-sm text-danger">
              {fieldErrors.email}
            </p>
          ) : null}
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${mode}-password`} className="text-sm font-medium">
            Password
          </label>
          <input
            id={`${mode}-password`}
            name="password"
            type="password"
            autoComplete={copy.autoComplete}
            required
            aria-invalid={fieldErrors.password ? true : undefined}
            aria-describedby={
              fieldErrors.password
                ? `${mode}-password-error`
                : mode === "sign-up"
                  ? `${mode}-password-hint`
                  : undefined
            }
            className="rounded-md border border-control px-3 py-2 text-sm"
          />
          {mode === "sign-up" ? (
            <p id={`${mode}-password-hint`} className="text-xs text-muted">
              At least {MIN_PASSWORD_LENGTH} characters.
            </p>
          ) : null}
          {fieldErrors.password ? (
            <p id={`${mode}-password-error`} className="text-sm text-danger">
              {fieldErrors.password}
            </p>
          ) : null}
        </div>
        <button
          type="submit"
          disabled={captcha.status !== "verified"}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-fg disabled:opacity-60"
        >
          {pending ? copy.pending : copy.submit}
        </button>
      </fieldset>
      {formError ? (
        <p role="alert" className="text-sm text-danger">
          {formError}
        </p>
      ) : null}
    </form>
  );
}
