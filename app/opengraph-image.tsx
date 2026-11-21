import { ImageResponse } from "next/og";
import { OG_COLORS, OG_SIZE, loadNewsreader } from "@/lib/brand/og";

export const alt = "Groundwork: ask your documents, see the source";
export const size = OG_SIZE;
export const contentType = "image/png";

/**
 * The social image (DESIGN 2): the wordmark with its accent rule, the
 * headline, and one footnote with its passage highlighted, the product in one
 * frame. Flat colours only (no gradient, DESIGN rule 9). Satori supports a
 * subset of CSS: every element with more than one child is `display: flex`.
 * Static: it is generated once at build time.
 */
export default async function OpengraphImage() {
  const font = await loadNewsreader();
  const serif = font ? "Newsreader" : "sans-serif";

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        background: OG_COLORS.bg,
        color: OG_COLORS.ink,
        padding: "64px 80px",
        fontFamily: serif,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", width: 188 }}>
        <div
          style={{
            fontSize: 40,
            fontWeight: 600,
            letterSpacing: "-0.01em",
            lineHeight: 1.1,
          }}
        >
          Groundwork
        </div>
        <div
          style={{
            height: 4,
            marginTop: 6,
            background: OG_COLORS.accent,
          }}
        />
      </div>

      <div
        style={{
          display: "flex",
          fontSize: 92,
          fontWeight: 600,
          letterSpacing: "-0.02em",
          lineHeight: 1.04,
          maxWidth: 960,
        }}
      >
        Answers that show their sources.
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 12,
          borderTop: `2px solid ${OG_COLORS.line}`,
          paddingTop: 24,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            fontSize: 32,
            lineHeight: 1.4,
            maxWidth: 1000,
          }}
        >
          <span>Full-time employees get&nbsp;</span>
          <span style={{ background: OG_COLORS.highlight }}>
            26 days of paid annual leave
          </span>
          <span>&nbsp;in each leave year.</span>
          <span
            style={{
              marginLeft: 8,
              padding: "0 8px",
              fontSize: 22,
              fontWeight: 600,
              borderRadius: 4,
              background: OG_COLORS.accentSoft,
              color: OG_COLORS.accent,
            }}
          >
            1
          </span>
        </div>
        <div style={{ display: "flex", fontSize: 24, color: OG_COLORS.muted }}>
          1 · Employee handbook, p. 3
        </div>
      </div>
    </div>,
    {
      ...size,
      fonts: font
        ? [{ name: "Newsreader", data: font, weight: 600, style: "normal" }]
        : undefined,
    },
  );
}
