import type { ReactNode, SVGProps } from "react";

type IconProps = Omit<SVGProps<SVGSVGElement>, "children"> & {
  /** Pixel size. Banners use 16, badges 12. */
  size?: number;
};

/**
 * Decorative 16 px line icons in `currentColor`. They are always
 * `aria-hidden`: the text next to them carries the meaning, and an
 * icon-only control must get its name from `aria-label` (DESIGN rule 9).
 * Shapes differ by meaning (circle-i, triangle, circle-!, check) so color
 * is never the only signal.
 */
function Icon({
  size = 16,
  className,
  children,
  ...rest
}: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
      {...rest}
    >
      {children}
    </svg>
  );
}

export function InfoIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="8" cy="8" r="6.25" />
      <path d="M8 7.5v3.5" />
      <path d="M8 5.25h.01" />
    </Icon>
  );
}

export function WarningIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M8 2.25 14.25 13H1.75L8 2.25Z" />
      <path d="M8 6.5v3" />
      <path d="M8 11.25h.01" />
    </Icon>
  );
}

export function ErrorIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="8" cy="8" r="6.25" />
      <path d="M8 4.75v3.5" />
      <path d="M8 10.75h.01" />
    </Icon>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m3.5 8.5 3 3 6-7" />
    </Icon>
  );
}
