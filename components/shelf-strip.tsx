import type { ReactNode } from "react";
import { cn } from "@/components/ui/cn";
import type { OwnDocument } from "@/lib/documents/list-own-documents";
import {
  SHELF_SLOTS,
  SPINE_DEFAULT_PX,
  SPINE_DEFAULT_WIDTH_PX,
  shelfOrder,
  spineHeightPx,
  spineWidthPx,
} from "@/lib/documents/shelf";

/** Heights of the slot states that are not a document. */
const EMPTY_SLOT_PX = 44;
const GHOST_SLOT_PX = 50;

function Spine({
  doc,
  lifted,
}: {
  doc: OwnDocument;
  lifted: boolean;
}) {
  const status = doc.status;
  return (
    <div
      title={doc.title}
      style={{ height: spineHeightPx(doc), width: spineWidthPx(doc) }}
      className={cn(
        "spine relative min-w-0 flex-initial rounded-t-[3px]",
        status === "ready" && "bg-accent",
        // A tint of the accent, not `accent-soft`: that token is a near-black in
        // dark mode and the spine disappeared.
        status === "processing" && "spine--pulse bg-accent/35",
        status === "queued" &&
          "border-[1.5px] border-b-0 border-dashed border-control",
        status === "failed" && "spine--failed bg-danger",
        lifted && "spine--lift",
      )}
    />
  );
}

/**
 * The shelf as a strip of slots (U5), a compact shelf (it is only as wide as its books and
 * never wider than its column, so a spine is book-shaped and not a wide tile), one slot for every document the shelf
 * can hold. A document stands in its slot as a spine: taller for more pages,
 * green when ready, softly pulsing while it is processed, dashed while queued,
 * and leaning over if it failed. The next empty slot is where an upload lands:
 * it lights up when the person points at the upload button, and a ghost spine
 * rises in it while a file is dragged over the page. It shows how full the
 * shelf is without any words, so the document limit needs no explaining.
 *
 * Purely visual: every fact in it is also in the list, the caption and the
 * upload control, so it is hidden from assistive technology. The `title` of a
 * spine is the document's name for sighted users who hover it.
 */
export function ShelfStrip({
  documents,
  arriving,
  dragging,
  previewNext,
  activeId,
}: {
  /** The shelf's documents, in any order; `null` while they load. */
  documents: readonly OwnDocument[] | null;
  /** A file is on its way and the shelf has no row for it yet. */
  arriving: boolean;
  /** A file is being dragged over the page. */
  dragging: boolean;
  /** The person is pointing at the upload button. */
  previewNext: boolean;
  /** The document whose row is hovered or focused: its spine lifts. */
  activeId: string | null;
}) {
  const slots: ReactNode[] = [];
  for (const doc of shelfOrder(documents ?? []).slice(0, SHELF_SLOTS)) {
    slots.push(<Spine key={doc.id} doc={doc} lifted={doc.id === activeId} />);
  }
  if (arriving && slots.length < SHELF_SLOTS) {
    slots.push(
      <div
        key="arriving"
        style={{ height: SPINE_DEFAULT_PX, width: SPINE_DEFAULT_WIDTH_PX }}
        className="spine spine--land min-w-0 flex-initial rounded-t-[3px] border-[1.5px] border-b-0 border-dashed border-control"
      />,
    );
  }
  const filled = slots.length;
  for (let i = filled; i < SHELF_SLOTS; i += 1) {
    const isNext = i === filled;
    if (isNext && dragging) {
      slots.push(
        <div
          key={`empty-${i}`}
          style={{ height: GHOST_SLOT_PX, width: SPINE_DEFAULT_WIDTH_PX }}
          className="spine spine--ghost min-w-0 flex-initial rounded-t-[3px] border-[1.5px] border-b-0 border-dashed border-accent bg-accent-soft"
        />,
      );
    } else {
      slots.push(
        <div
          key={`empty-${i}`}
          style={{ height: EMPTY_SLOT_PX, width: SPINE_DEFAULT_WIDTH_PX }}
          className={cn(
            "min-w-0 flex-initial rounded-t-[3px] border-[1.5px] border-b-0 border-dashed transition-colors duration-(--dur-fast)",
            isNext && previewNext
              ? "border-accent bg-accent-soft"
              : "border-line",
          )}
        />,
      );
    }
  }

  return (
    <div aria-hidden="true" className="w-fit max-w-full">
      <div className="flex h-16 items-end gap-1">{slots}</div>
      <div className="h-0.5 rounded-full bg-control" />
    </div>
  );
}
