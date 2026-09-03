import { GithubEvent } from "../../../github";

export type PullRequestReviewEvent = Extract<
  GithubEvent,
  { type: `pull_request_review.${string}` }
>;

/** GitHub gives a review one of three verdicts; anything else is a state we have no name for. */
export function reviewVerdict(event: PullRequestReviewEvent): string {
  return event.review.state?.toLowerCase() ?? "commented";
}
