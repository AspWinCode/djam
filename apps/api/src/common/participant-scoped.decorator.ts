import { SetMetadata } from "@nestjs/common";

/**
 * Marks a route handler as safe to rate-limit by the caller's own
 * `x-participant-id` identity instead of IP. Opt-in only: without this
 * marker AppThrottlerGuard never looks at the header, so pre-auth routes
 * (login, join) and anything else added later default to IP tracking and
 * cannot be bypassed by attaching someone's real-but-unrelated participant id.
 */
export const PARTICIPANT_SCOPED_KEY = "participantScoped";
export const ParticipantScoped = () => SetMetadata(PARTICIPANT_SCOPED_KEY, true);
