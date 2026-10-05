import { CalendarDays, MapPin, Sparkles, Ticket, Users } from "lucide-react";
import { ScoreBadge } from "@/components/ScoreBadge";
import { formatEventSchedule, formatStoredPrice } from "@/lib/events";
import type { DashboardEvent } from "@/lib/dashboard/types";
import { CareerSummary } from "@/components/CareerSummary";
import { CareerAttendance } from "@/components/CareerAttendance";

const registrationLabels = {
  open: "Registration open",
  "almost-full": "Almost full",
  waitlist: "Waitlist",
  unknown: "Registration status not listed",
  closed: "Registration closed",
  cancelled: "Cancelled",
} as const;

export function EventCard({
  event,
  rank,
}: {
  event: DashboardEvent;
  rank: number;
}) {
  const location = [event.venue, event.neighborhood, event.borough]
    .filter(Boolean)
    .join(" · ");
  return (
    <article
      className={`event-card ${rank === 1 ? "event-card-top" : ""}`}
      aria-labelledby={`title-${event.id}`}
    >
      <div className="event-main">
        <div className="flex flex-wrap items-center gap-2">
          <span className="event-rank">{String(rank).padStart(2, "0")}</span>
          {event.categories.map((category) => (
            <span
              key={category}
              className={`category category-${category.toLowerCase()}`}
            >
              {category}
            </span>
          ))}
          {event.isNew && (
            <span className="new-label">
              <span aria-hidden="true" />
              New
            </span>
          )}
        </div>
        <div className="event-heading">
          <div>
            <h3 id={`title-${event.id}`}>{event.title}</h3>
            <p className="organizer">
              {event.organizer
                ? `Hosted by ${event.organizer}`
                : "Organizer not listed"}
            </p>
          </div>
          {event.careerAssessment ? (
            <div
              className="career-score"
              aria-label={`Career fit score: ${event.careerAssessment.score} out of 100`}
            >
              <strong>{event.careerAssessment.score}</strong>
              <span>Career fit</span>
            </div>
          ) : (
            <ScoreBadge score={event.networkingScore} prominent />
          )}
        </div>
        {event.careerAssessment && (
          <CareerAttendance
            assessment={event.careerAssessment}
            eventId={event.id}
          />
        )}
        <div className="event-details">
          <p>
            <CalendarDays size={15} aria-hidden="true" />
            <time dateTime={event.startsAt}>{formatEventSchedule(event)}</time>
          </p>
          <p>
            <MapPin size={15} aria-hidden="true" />
            <span>{location || "Venue not listed · New York City"}</span>
          </p>
        </div>
        {event.careerAssessment ? (
          <CareerSummary assessment={event.careerAssessment} />
        ) : (
          <div className="recommendation">
            <h4>
              <Sparkles size={14} aria-hidden="true" />
              {event.recommendation
                ? "Why RightRoom recommends it"
                : "Recommendation pending"}
            </h4>
            <p>
              {event.recommendation ??
                "No recommendation has been added for this event yet."}
            </p>
          </div>
        )}
        {event.potentialDownside && (
          <p className="downside">
            <span>Potential downside</span> {event.potentialDownside}
          </p>
        )}
        <div className="event-footer">
          {!event.careerAssessment && (
            <div className="score-group">
              <Users size={14} aria-hidden="true" />
              <ScoreBadge score={event.founderScore} label="Founder" />
              <span className="score-divider" />
              <ScoreBadge score={event.investorScore} label="Investor" />
            </div>
          )}
          <div className="event-cost">
            <Ticket size={14} aria-hidden="true" />
            <strong>
              {formatStoredPrice(event.priceAmountCents, event.currencyCode)}
            </strong>
            {event.source && <span>via {event.source}</span>}
          </div>
        </div>
      </div>
      <div className="event-status-bar">
        <span
          className={`registration registration-${event.registrationStatus}`}
        >
          <span aria-hidden="true" />
          {registrationLabels[event.registrationStatus]}
        </span>
        {!event.isFixture && event.registrationUrl ? (
          <a
            href={event.registrationUrl}
            target="_blank"
            rel="noopener noreferrer"
            referrerPolicy="no-referrer"
          >
            View event & registration{" "}
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        ) : (
          <span>
            {event.isFixture
              ? "Sample listing · no registration"
              : "Registration link not available"}
          </span>
        )}
      </div>
    </article>
  );
}
