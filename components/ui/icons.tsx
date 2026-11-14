import {
  BookmarkSimpleIcon,
  CheckCircleIcon,
  CheckIcon as PhCheckIcon,
  CircleHalfIcon,
  ClockIcon,
  InfoIcon as PhInfoIcon,
  WarningCircleIcon,
  WarningIcon as PhWarningIcon,
  WarningOctagonIcon,
} from "@phosphor-icons/react/ssr";
import type { IconProps as PhosphorProps } from "@phosphor-icons/react";

// Phosphor is the only icon library. The `/ssr` entry keeps these usable in
// Server Components (no client boundary); types come from the main entry,
// which costs nothing at runtime. Import icons here, never straight from
// Phosphor in a feature component, so the set stays small and consistent.

export type IconProps = Omit<
  PhosphorProps,
  "children" | "weight" | "mirrored" | "alt"
> & {
  /** Pixel size. Banners use 16, badges 12. */
  size?: number;
};

/**
 * Weights: `regular` for general UI, `fill` for status glyphs (badges,
 * banners). Always `aria-hidden`: the text next to an icon carries the
 * meaning, and an icon-only control gets its name from `aria-label`
 * (DESIGN rule 9). Shapes differ by meaning, so color is never the only
 * signal.
 */
const HIDDEN = { "aria-hidden": true, focusable: "false" } as const;

// --- general UI (regular) ---------------------------------------------

export function CheckIcon({ size = 16, ...rest }: IconProps) {
  return <PhCheckIcon size={size} weight="regular" {...HIDDEN} {...rest} />;
}

// --- banner tones (fill): circle-i, triangle, octagon ------------------

export function InfoIcon({ size = 16, ...rest }: IconProps) {
  return <PhInfoIcon size={size} weight="fill" {...HIDDEN} {...rest} />;
}

export function WarningIcon({ size = 16, ...rest }: IconProps) {
  return <PhWarningIcon size={size} weight="fill" {...HIDDEN} {...rest} />;
}

export function ErrorIcon({ size = 16, ...rest }: IconProps) {
  return <WarningOctagonIcon size={size} weight="fill" {...HIDDEN} {...rest} />;
}

// --- badge statuses (fill): clock, half circle, check, "!", bookmark ----

export function QueuedIcon({ size = 12, ...rest }: IconProps) {
  return <ClockIcon size={size} weight="bold" {...HIDDEN} {...rest} />;
}

export function ProcessingIcon({ size = 12, ...rest }: IconProps) {
  return <CircleHalfIcon size={size} weight="fill" {...HIDDEN} {...rest} />;
}

export function ReadyIcon({ size = 12, ...rest }: IconProps) {
  return <CheckCircleIcon size={size} weight="fill" {...HIDDEN} {...rest} />;
}

export function FailedIcon({ size = 12, ...rest }: IconProps) {
  return <WarningCircleIcon size={size} weight="fill" {...HIDDEN} {...rest} />;
}

export function SampleIcon({ size = 12, ...rest }: IconProps) {
  return <BookmarkSimpleIcon size={size} weight="fill" {...HIDDEN} {...rest} />;
}
