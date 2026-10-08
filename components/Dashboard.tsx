import Link from "next/link";
import {
  ArrowDownWideNarrow,
  ArrowUpRight,
  FlaskConical,
  MapPin,
  Radar,
  Sparkles,
} from "lucide-react";
import { EventCard } from "@/components/EventCard";
import type { DashboardResult } from "@/lib/dashboard/types";
import { DashboardState } from "@/components/DashboardState";
import {
  AttendanceChoice,
  PersonalShortlist,
} from "@/components/PersonalShortlist";

export function Dashboard({
  result,
  sample = false,
  career = false,
}: {
  result: DashboardResult | { status: "loading"; events: []; hasMore: false };
  sample?: boolean;
  career?: boolean;
}) {
  const events = result.events;
  const newCount = events.filter((event) => event.isNew).length;
  const scoredCount = events.filter((event) =>
    career ? Boolean(event.careerAssessment) : event.networkingScore !== null,
  ).length;
  const freeCount = events.filter(
    (event) => event.priceAmountCents === 0 && event.currencyCode !== null,
  ).length;
  const countsKnown = result.status === "ready" || result.status === "empty";
  const attendanceScope = sample
    ? career
      ? "sample-career"
      : "sample-founder"
    : "published";
  const count = (value: number) =>
    countsKnown ? value.toString().padStart(2, "0") : "—";

  return (
    <>
      <a className="skip-link" href="#picks">
        Skip to event picks
      </a>
      <header className="site-header">
        <div className="page-shell flex flex-wrap items-center justify-between gap-4">
          <Link href="/" className="brand" aria-label="RightRoom home">
            <span className="brand-mark">
              <Radar size={25} strokeWidth={1.5} aria-hidden="true" />
            </span>
            <span>
              Right<span className="brand-light">Room</span>
              <span className="brand-period">.</span>
            </span>
          </Link>
          <div className="header-location">
            <MapPin size={14} aria-hidden="true" />
            <span>New York City</span>
            <span className="header-separator" />
            <span className="edition">
              {sample ? "SAMPLE EDITION" : "PUBLISHED EDITION"}
            </span>
            <Link
              href={
                sample
                  ? career
                    ? "/"
                    : "/events"
                  : career
                    ? "/sample/career"
                    : "/sample"
              }
              prefetch={false}
              className="edition-link"
            >
              {sample ? "Published events" : "View sample"}
            </Link>
            <nav className="edition-nav" aria-label="Event editions">
              <Link href="/" prefetch={false}>
                Career events
              </Link>
              <Link href="/events" prefetch={false}>
                All events
              </Link>
              <Link href="/sample/career" prefetch={false}>
                Career sample
              </Link>
            </nav>
          </div>
        </div>
      </header>
      <main className="page-shell">
        <div className="prototype-notice">
          {sample ? (
            <FlaskConical size={16} aria-hidden="true" />
          ) : (
            <Radar size={16} aria-hidden="true" />
          )}
          <p>
            {sample ? (
              <>
                <strong>
                  {career
                    ? "A fictional career shortlist."
                    : "The original startup proof of concept."}
                </strong>{" "}
                Fictional events, sample scores & availability. These are not
                live listings.
              </>
            ) : (
              <>
                <strong>
                  {career ? "Reviewed career events." : "Reviewed NYC events."}
                </strong>{" "}
                Only reviewed, published listings appear here. Career-profile
                {career
                  ? " ranking explains the evidence behind each pick."
                  : " picks have a separate career view."}
              </>
            )}
          </p>
          <span className="demo-badge">
            {sample
              ? career
                ? "CAREER DEMO"
                : "STARTUP DEMO"
              : "PUBLISHED FEED"}
          </span>
        </div>
        <section className="dashboard-intro" aria-labelledby="page-title">
          <div>
            <p className="eyebrow">
              <span />
              THE NYC CAREER-EVENT SHORTLIST
            </p>
            <h1 id="page-title">
              Less noise.
              <br />
              <span>Better rooms.</span>
            </h1>
            <p className="intro-description">
              Find the events that move your career forward.
              <br className="sm:hidden" /> Meet relevant people, in person.
            </p>
          </div>
          <div className="edition-note">
            <span className="eyebrow">
              {sample ? "THE SAMPLE EDITION" : "THE UPCOMING EDITION"}
            </span>
            <p>
              {sample
                ? career
                  ? "October 1–3, 2026"
                  : "September 1–6, 2026"
                : "The next 30 days"}
            </p>
            <span>For job seekers making their next move.</span>
          </div>
        </section>
        <div
          className="summary-strip"
          aria-label={
            sample ? "Sample shortlist summary" : "Published shortlist summary"
          }
        >
          <div>
            <strong>{count(events.length)}</strong>
            <span>events available</span>
          </div>
          <div>
            <strong>{count(sample && !career ? newCount : scoredCount)}</strong>
            <span>
              {career
                ? "with career-fit scores"
                : sample
                  ? "marked new"
                  : "with networking scores"}
            </span>
          </div>
          <div>
            <strong>{count(freeCount)}</strong>
            <span>free to attend</span>
          </div>
          <p>
            <Sparkles size={15} aria-hidden="true" />
            Good connections start with the right room.
          </p>
        </div>
        <div className="dashboard-grid">
          <section
            id="picks"
            className="picks-section"
            aria-labelledby="picks-heading"
            tabIndex={-1}
          >
            <div className="section-heading">
              <div>
                <h2 id="picks-heading">
                  Your shortlist<span>{countsKnown ? events.length : "—"}</span>
                </h2>
                <p>
                  {sample
                    ? "A few promising rooms. A reason for every pick."
                    : "Upcoming NYC events. Unknown details stay unknown."}
                </p>
              </div>
              <span className="sort-label">
                <ArrowDownWideNarrow size={15} aria-hidden="true" />
                {career
                  ? "Career fit ↓ · then date"
                  : sample
                    ? "Networking score ↓"
                    : "Score ↓ · unscored by date"}
              </span>
            </div>
            {result.status === "ready" || result.status === "empty" ? (
              <>
                <PersonalShortlist
                  key={attendanceScope}
                  scope={attendanceScope}
                  items={events.map((event, index) => ({
                    id: event.id,
                    content: (
                      <EventCard event={event} rank={index + 1}>
                        <AttendanceChoice eventId={event.id} />
                      </EventCard>
                    ),
                  }))}
                  emptyState={<DashboardState status="empty" career={career} />}
                />
                {result.hasMore && (
                  <p className="feed-limit">
                    Showing the top 50 events in the next 30 days.
                  </p>
                )}
              </>
            ) : (
              <DashboardState status={result.status} career={career} />
            )}
          </section>
          <aside className="sidebar" aria-label="About your shortlist">
            <section className="field-note">
              <span className="eyebrow">THE RIGHTROOM FILTER</span>
              <ArrowUpRight
                className="note-arrow"
                size={27}
                aria-hidden="true"
              />
              <h2>
                Worth your time.
                <br />
                Not just on
                <br />
                your calendar.
              </h2>
              <p>
                The best professional event isn’t always the biggest. It’s the
                one where you can learn, meet relevant people, and have a real
                conversation.
              </p>
              <div className="note-bottom">
                <span>Fewer events. Better career connections.</span>
                <Radar size={23} aria-hidden="true" />
              </div>
            </section>
            {career ? (
              <section
                className="score-guide"
                aria-labelledby="career-guide-title"
              >
                <p className="eyebrow">READING THE SIGNAL</p>
                <h2 id="career-guide-title">What makes a useful room?</h2>
                <p>
                  Role fit, relevant people, interaction, domain fit, and
                  practical access contribute to the ranking. Each card shows
                  its components and cautions.
                </p>
                <p>
                  These picks use a product-management and technical-delivery
                  target profile. A tech talk can qualify without founders or
                  advertised jobs.
                </p>
                <p className="guide-footnote">
                  {sample
                    ? "All events and assessments here are fictional illustrations."
                    : "Scores reflect supported details and human review. They do not predict a job offer or guarantee access to a speaker."}
                </p>
              </section>
            ) : (
              <section
                className="score-guide"
                aria-labelledby="score-guide-title"
              >
                <p className="eyebrow">READING THE SIGNAL</p>
                <h2 id="score-guide-title">What’s in the current score?</h2>
                <p>
                  {sample
                    ? "This original startup prototype uses three lenses, each out of 100."
                    : "The current prototype uses three startup-focused lenses. Unscored does not mean zero."}
                </p>
                <dl>
                  <div>
                    <dt>Networking</dt>
                    <dd>
                      Room for meaningful conversations and useful connections.
                    </dd>
                  </div>
                  <div>
                    <dt>Founder</dt>
                    <dd>
                      Opportunity to meet people building and running startups.
                    </dd>
                  </div>
                  <div>
                    <dt>Investor</dt>
                    <dd>
                      Opportunity for direct, relevant investor conversations.
                    </dd>
                  </div>
                </dl>
                <div className="score-legend">
                  <p>
                    <span className="legend-dot exceptional" />
                    <strong>90–100</strong> Exceptional
                  </p>
                  <p>
                    <span className="legend-dot strong" />
                    <strong>80–89</strong> Strong
                  </p>
                  <p>
                    <span className="legend-dot promising" />
                    <strong>0–79</strong> Explore selectively
                  </p>
                </div>
                <p className="guide-footnote">
                  {sample
                    ? "Sample scores illustrate the original startup concept. They are examples, not measured outcomes or personalized career matches."
                    : "Scores appear only when available. Open Career events for the separate career-fit ranking."}
                </p>
              </section>
            )}
            <section className="local-note">
              <MapPin size={18} aria-hidden="true" />
              <div>
                <h2>Built for New York.</h2>
                <p>
                  Neighborhoods matter. So does your time.{" "}
                  {sample
                    ? "All sample events are in person"
                    : "In-person and hybrid NYC events"}
                  , with times shown in New York’s time zone.
                </p>
              </div>
            </section>
          </aside>
        </div>
      </main>
      <footer className="page-shell site-footer">
        <p>
          <Radar size={17} aria-hidden="true" />
          <strong>RightRoom</strong>
          <span>Move your career forward.</span>
        </p>
        <span>
          {sample
            ? "Sample edition · All listings are fictional"
            : "Published edition · No automatic discovery on page load"}
        </span>
      </footer>
    </>
  );
}
