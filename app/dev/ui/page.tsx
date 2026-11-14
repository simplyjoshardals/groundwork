import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { Badge, type BadgeStatus } from "@/components/ui/badge";
import { Banner, type BannerTone } from "@/components/ui/banner";
import {
  Button,
  buttonClasses,
  type ButtonSize,
  type ButtonVariant,
} from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { CheckIcon, ErrorIcon, InfoIcon, WarningIcon } from "@/components/ui/icons";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ThemeSwitch } from "./theme-switch";

/**
 * TEMPORARY (U0): a dev-only preview of the foundations. Delete this whole
 * folder (app/dev/) before merging. It 404s in production builds.
 */
export const metadata: Metadata = {
  title: "UI preview (temporary)",
  robots: { index: false, follow: false },
};

// Full class names so Tailwind can see them. Pairs are [token, bg, text on it].
const SWATCHES: Array<[string, string, string]> = [
  ["bg", "bg-bg", "text-ink"],
  ["surface", "bg-surface", "text-ink"],
  ["sunken", "bg-sunken", "text-muted"],
  ["raised", "bg-raised", "text-ink"],
  ["accent", "bg-accent", "text-accent-fg"],
  ["accent-hover", "bg-accent-hover", "text-accent-fg"],
  ["accent-soft", "bg-accent-soft", "text-accent"],
  ["highlight-soft", "bg-highlight-soft", "text-ink"],
  ["danger", "bg-danger", "text-danger-fg"],
  ["danger-soft", "bg-danger-soft", "text-danger"],
  ["warn-soft", "bg-warn-soft", "text-warn"],
  ["toast", "bg-toast", "text-toast-fg"],
];

const VARIANTS: Array<[ButtonVariant, string]> = [
  ["primary", "Ask"],
  ["secondary", "Open page 7"],
  ["ghost", "Retry"],
  ["danger", "Delete"],
  ["danger-solid", "Delete document"],
  ["link", "Create an account"],
];
const SIZES: ButtonSize[] = ["sm", "md", "lg"];
const STATUSES: BadgeStatus[] = ["queued", "processing", "ready", "failed", "sample"];
const TONES: Array<[BannerTone, string]> = [
  ["info", "I couldn’t find that in your documents. Try rephrasing, or ask about something the documents cover."],
  ["warn", "You’re offline. Questions and uploads will work again when you’re back."],
  ["danger", "We couldn’t load your documents."],
];

function Section({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1 border-b border-line pb-3">
        <h2 className="text-h2 font-semibold text-ink">{title}</h2>
        {note ? <p className="text-sm text-muted">{note}</p> : null}
      </div>
      {children}
    </section>
  );
}

function Label({ children }: { children: ReactNode }) {
  return <p className="font-mono text-xs text-muted">{children}</p>;
}

export default function UiPreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();

  return (
    <main className="mx-auto flex w-full max-w-[68rem] flex-col gap-12 px-4 py-8 md:px-6 xl:px-8">
      <header className="flex flex-col gap-3">
        <h1 className="text-h1 font-semibold text-ink">U0 foundations preview</h1>
        <p className="max-w-[36rem] text-base text-muted">
          Temporary, dev-only. Hover and focus states: Tab through the page, or
          use DevTools “Force state”. Touch sizes: DevTools device mode.
        </p>
        <ThemeSwitch />
      </header>

      <Section title="Color tokens" note="Each tile shows its paired text color. Switch theme to compare.">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {SWATCHES.map(([name, bg, fg]) => (
            <div
              key={name}
              className={`flex h-16 items-end rounded-md border border-line p-3 text-xs font-medium ${bg} ${fg}`}
            >
              {name}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="rounded-md border border-line bg-surface p-3 text-sm text-ink">border-line (card edge)</div>
          <div className="rounded-md border border-control bg-surface p-3 text-sm text-ink">border-control (operable)</div>
          <div className="rounded-md bg-surface p-3 text-sm text-ink outline-2 outline-offset-2 outline-focus">focus ring (static sample)</div>
        </div>
      </Section>

      <Section title="Elevation" note="Light: soft warm shadows. Dark: borders and rings, no card shadow.">
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
          <div className="rounded-lg border border-line bg-surface p-4 text-sm text-ink">Level 0: edge only</div>
          <div className="rounded-lg border border-line bg-surface p-4 text-sm text-ink shadow-card">Level 1: shadow-card</div>
          <div className="rounded-xl border border-line bg-raised p-4 text-sm text-ink shadow-pop">Level 2: shadow-pop</div>
        </div>
        <div className="rounded-xl border border-line bg-raised p-4 text-sm text-ink shadow-sheet">Level 3: shadow-sheet</div>
      </Section>

      <Section title="Type" note="Serif for answers and headings, sans for UI, mono for refs and numbers.">
        <div className="flex flex-col gap-4">
          <p className="font-serif text-display font-semibold text-ink">Answers that show their sources.</p>
          <h1 className="text-h1 font-semibold text-ink">text-h1: That page isn’t on the shelf.</h1>
          <h2 className="text-h2 font-semibold text-ink">text-h2: Nothing on the shelf yet.</h2>
          <h3 className="text-h3 font-semibold text-ink">text-h3: Delete “report.pdf”?</h3>
          <p className="max-w-[36rem] font-serif text-read text-ink">
            text-read: The quarterly parking permit policy is reviewed by the
            facilities committee each spring, according to the notes on page 7.
            It was last revised in March.
          </p>
          <p className="text-lg text-ink">text-lg: Ask your documents a question.</p>
          <p className="text-base text-ink">text-base: Inputs and body copy are 16 px.</p>
          <p className="text-sm text-ink">text-sm: Buttons, list rows, banners.</p>
          <p className="text-xs font-medium text-muted">text-xs: Badges, meta, helper text.</p>
          <p className="font-mono text-sm tabular-nums text-ink">p. 7 · 14 of 20 left today · 1,204 KB</p>
          <p className="font-mono text-sm font-medium tabular-nums text-ink">Mono 500: Source 2</p>
        </div>
      </Section>

      <Section title="Button" note="Rows are variants, columns are sizes. Second line of each row is disabled.">
        <div className="flex flex-col gap-6">
          {VARIANTS.map(([variant, label]) => (
            <div key={variant} className="flex flex-col gap-2">
              <Label>{variant}</Label>
              <div className="flex flex-wrap items-center gap-3">
                {variant === "link" ? (
                  <Button variant="link">{label}</Button>
                ) : (
                  SIZES.map((size) => (
                    <Button key={size} variant={variant} size={size}>
                      {label}
                    </Button>
                  ))
                )}
              </div>
              <div className="flex flex-wrap items-center gap-3">
                {variant === "link" ? (
                  <Button variant="link" disabled>{label}</Button>
                ) : (
                  SIZES.map((size) => (
                    <Button key={size} variant={variant} size={size} disabled>
                      {label}
                    </Button>
                  ))
                )}
              </div>
            </div>
          ))}
          <div className="flex flex-col gap-2">
            <Label>pending: label swapped, fixed min-w, no spinner</Label>
            <div className="flex flex-wrap items-center gap-3">
              <Button className="min-w-24" disabled>Asking…</Button>
              <Button variant="secondary" className="min-w-36" disabled>Preparing demo…</Button>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Label>link styled as a button (buttonClasses on an anchor)</Label>
            <div>
              <a href="#top" className={buttonClasses({ variant: "primary", size: "lg" })}>
                Try demo
              </a>
            </div>
          </div>
        </div>
      </Section>

      <Section title="Input and Field">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label>input: rest, filled, disabled</Label>
            <Input aria-label="Rest" placeholder="name@example.com" />
            <Input aria-label="Filled" defaultValue="reader@example.com" />
            <Input aria-label="Disabled" defaultValue="Disabled" disabled />
          </div>
          <div className="flex flex-col gap-4">
            <Label>field: helper, error, both</Label>
            <Field id="demo-password" label="Password" type="password" helper="At least 8 characters." />
            <Field id="demo-email" label="Email" defaultValue="not-an-email" error="Enter an email address like name@example.com." />
            <Field id="demo-both" label="Display name" defaultValue="R" helper="Shown in the header." error="Use at least 2 characters." />
          </div>
        </div>
      </Section>

      <Section title="Badge" note="Queued is hollow, Processing pulses (static under reduced motion), Ready has a check.">
        <div className="flex flex-wrap items-center gap-3">
          {STATUSES.map((s) => (
            <Badge key={s} status={s} />
          ))}
        </div>
      </Section>

      <Section title="Card">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Card>
            <p className="text-sm font-medium text-ink">Compact (p-4)</p>
            <p className="text-sm text-muted">Edge only, no shadow.</p>
          </Card>
          <Card padding="roomy">
            <p className="text-sm font-medium text-ink">Roomy (p-6)</p>
            <p className="text-sm text-muted">For empty states and the auth card.</p>
          </Card>
          <Card interactive>
            <p className="text-sm font-medium text-ink">Interactive</p>
            <p className="text-sm text-muted">Hover: edge darkens, shadow-card (light only).</p>
          </Card>
        </div>
      </Section>

      <Section title="Banner" note="Info and warn are role=status, danger is role=alert. With and without an action.">
        <div className="flex flex-col gap-3">
          {TONES.map(([tone, text]) => (
            <Banner key={tone} tone={tone}>{text}</Banner>
          ))}
          {TONES.map(([tone, text]) => (
            <Banner
              key={`${tone}-action`}
              tone={tone}
              action={<Button variant="secondary" size="sm">Retry</Button>}
            >
              {text}
            </Banner>
          ))}
        </div>
      </Section>

      <Section title="Skeleton" note="Shaped like what is coming. Shimmer runs one band; static under reduced motion.">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <div className="flex flex-col gap-3" aria-busy="true">
            <Label>answer: 3 lines at text-read height, last 60%</Label>
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-3/5" />
          </div>
          <div className="flex flex-col gap-3" aria-busy="true">
            <Label>document row (56 px)</Label>
            <div className="flex h-14 items-center gap-4 rounded-lg border border-line bg-surface px-4">
              <Skeleton className="h-4 w-2/5" />
              <Skeleton shape="pill" className="h-5 w-16" />
              <Skeleton className="h-3 w-1/5" />
            </div>
            <Label>header counter (80 × 16)</Label>
            <Skeleton className="h-4 w-20" />
          </div>
          <div className="flex flex-col gap-3" aria-busy="true">
            <Label>viewer page (8.5 : 11)</Label>
            <div className="flex aspect-[8.5/11] max-w-xs flex-col gap-3 rounded-sm border border-line bg-surface p-6">
              {Array.from({ length: 8 }, (_, i) => (
                <Skeleton key={i} className={i % 4 === 3 ? "h-3 w-2/3" : "h-3 w-full"} />
              ))}
            </div>
          </div>
        </div>
      </Section>

      <Section title="Icons" note="aria-hidden; the shape differs by meaning, not just the color.">
        <div className="flex flex-wrap items-center gap-6 text-ink">
          <span className="flex items-center gap-2 text-sm"><InfoIcon /> info</span>
          <span className="flex items-center gap-2 text-sm text-warn"><WarningIcon /> warning</span>
          <span className="flex items-center gap-2 text-sm text-danger"><ErrorIcon /> error</span>
          <span className="flex items-center gap-2 text-sm text-accent"><CheckIcon /> check</span>
        </div>
      </Section>
    </main>
  );
}
