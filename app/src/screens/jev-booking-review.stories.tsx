import type { Meta, StoryObj } from "@storybook/react";
import { SAMPLE_JEV_BOOKINGS, SAMPLE_JEV_BOOKING_API } from "../dev/journal-composer-sample";
import { StoryRoute } from "../ui/story-route";
import { JevBookingReview } from "./jev-booking-review";

/**
 * FLOW-955 (board LedgerReviewCard). לאישור while Jev's bookings wait: the proposed entry, אישור and ביטול,
 * and the hint under them. Invented data only.
 */
const meta = {
  title: "Screens/Jev booking review",
  parameters: { flowRouter: false },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** The loan Jev booked as the deposit plus closing costs, two more cards after it. */
export const LoanBooked: Story = {
  render: () => (
    <StoryRoute entry="/review" tabs>
      <JevBookingReview bookings={SAMPLE_JEV_BOOKINGS} queued={2} next={null} search="" api={SAMPLE_JEV_BOOKING_API} sample />
    </StoryRoute>
  ),
};

/** A mortgage payment, the last booking: the queue's next card is named under it. */
export const PaymentBooked: Story = {
  render: () => (
    <StoryRoute entry="/review" tabs>
      <JevBookingReview bookings={SAMPLE_JEV_BOOKINGS.slice(1)} queued={1} next={{ name: "Example Hardware", minor: -41_218n, currency: "USD" }} search="" api={SAMPLE_JEV_BOOKING_API} sample />
    </StoryRoute>
  ),
};

/** A line Jev made itself (book_line): ביטול deletes it, and the hint says so. */
export const LineMadeByJev: Story = {
  render: () => (
    <StoryRoute entry="/review" tabs>
      <JevBookingReview bookings={SAMPLE_JEV_BOOKINGS.map((booking) => ({ ...booking, kind: "book_line" as const, source: "manual" }))} queued={0} next={null} search="" api={SAMPLE_JEV_BOOKING_API} sample />
    </StoryRoute>
  ),
};

/** A viewer reads the card, without עריכה or the action bar. */
export const Viewer: Story = {
  render: () => (
    <StoryRoute entry="/review" tabs viewer>
      <JevBookingReview bookings={SAMPLE_JEV_BOOKINGS} queued={0} next={null} search="" api={SAMPLE_JEV_BOOKING_API} sample />
    </StoryRoute>
  ),
};
