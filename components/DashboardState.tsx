import Link from "next/link";
import type { DashboardResult } from "@/lib/dashboard/types";

const messages = {
  loading: {
    title: "Loading your shortlist",
    description:
      "Checking for published NYC events. This will only take a moment.",
  },
  empty: {
    title: "No published events yet",
    description:
      "RightRoom has not published any NYC events in the next 30 days. Explore the fictional demo while the next edition is reviewed.",
  },
  unconfigured: {
    title: "This edition isn’t available yet",
    description:
      "The published event feed has not been prepared. You can still explore the clearly labeled fictional demo.",
  },
  unavailable: {
    title: "The event feed is temporarily unavailable",
    description:
      "We couldn’t load published events. No sample events have been substituted. Please try again shortly.",
  },
} as const;

export function DashboardState({
  status,
  career = false,
}: {
  status: Exclude<DashboardResult["status"], "ready"> | "loading";
  career?: boolean;
}) {
  const message = messages[status];
  return (
    <div
      className="feed-state"
      role="status"
      aria-live="polite"
      aria-busy={status === "loading"}
    >
      <span className="eyebrow">
        {status === "loading" ? "CHECKING THE ROOMS" : "PUBLISHED EVENT FEED"}
      </span>
      <h3>
        {career && status === "empty"
          ? "No current technical-PM events yet"
          : message.title}
      </h3>
      <p>
        {career && status === "empty"
          ? "RightRoom has not published any technical-PM events in the next 30 days. Explore the fictional demo while the next pilot edition is reviewed."
          : message.description}
      </p>
      {status !== "loading" && (
        <div className="feed-actions">
          {status === "unavailable" && (
            <form action={career ? "/" : "/events"} method="get">
              <button type="submit">Try again</button>
            </form>
          )}
          <Link href={career ? "/sample/career" : "/sample"} prefetch={false}>
            Explore sample edition
          </Link>
          {career && status === "empty" && (
            <Link href="/events" prefetch={false}>
              Browse all published events
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
