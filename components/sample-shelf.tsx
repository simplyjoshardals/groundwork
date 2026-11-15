import Link from "next/link";
import { RefreshButton } from "@/components/refresh-button";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { buttonClasses } from "@/components/ui/button";
import { cardClasses } from "@/components/ui/card";
import type { OwnDocument } from "@/lib/documents/list-own-documents";

/**
 * The demo shelf (DESIGN 6.5): the shared sample documents with the Sample
 * badge, plus a quiet card that says uploading needs an account. Rendered on
 * the server from `listSampleDocuments`; `documents` is `null` when that read
 * failed, which shows an error with Try again (never an empty shelf).
 *
 * Row restyling (meta, actions) belongs to U5; the rows here only need a title,
 * the badge and the page count.
 */
export function SampleShelf({
  documents,
}: {
  documents: readonly OwnDocument[] | null;
}) {
  return (
    <section aria-labelledby="documents-heading" className="flex flex-col gap-4">
      <h2 id="documents-heading" className="font-serif text-h3">
        Sample documents
      </h2>

      {documents === null ? (
        <Banner tone="danger" action={<RefreshButton />}>
          We couldn&apos;t load the sample documents.
        </Banner>
      ) : documents.length === 0 ? (
        <Banner tone="info">No sample documents are available right now.</Banner>
      ) : (
        <ul className="flex flex-col gap-2">
          {documents.map((doc) => (
            <li
              key={doc.id}
              className={cardClasses({ className: "flex flex-col gap-2" })}
            >
              <span className="min-w-0 wrap-break-word font-medium">
                {doc.title}
              </span>
              <div className="flex items-center gap-3">
                <Badge status="sample" />
                {doc.pageCount !== null ? (
                  <span className="font-mono text-xs text-muted">
                    {doc.pageCount} {doc.pageCount === 1 ? "page" : "pages"}
                  </span>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className={cardClasses({ className: "bg-sunken" })}>
        <p className="font-medium">Uploading needs an account</p>
        <p className="mt-1 text-sm text-muted">
          Create one to ask questions about your own documents.
        </p>
        <Link
          href="/sign-up"
          className={buttonClasses({
            variant: "secondary",
            size: "sm",
            className: "mt-3",
          })}
        >
          Create an account
        </Link>
      </div>
    </section>
  );
}