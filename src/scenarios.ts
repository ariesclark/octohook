import { GithubEvent } from "./github";

type Author = { name: string; email: string | null; username?: string };

const authors = {
  aries: { name: "Aries Clark", email: "aries@example.com", username: "ariesclark" },
  flitty: { name: "Flitty Bot", email: null, username: "flitty-bot[bot]" },
  renovate: { name: "Renovate Bot", email: null, username: "renovate[bot]" },
  torvalds: { name: "Linus Torvalds", email: "linus@example.com", username: "torvalds" },
  sindre: { name: "Sindre Sorhus", email: "sindre@example.com", username: "sindresorhus" },
  gaearon: { name: "Dan Abramov", email: "dan@example.com", username: "gaearon" },
  unmatched: { name: "Someone Offline", email: "nobody@example.com" },
} satisfies Record<string, Author>;

const repository = {
  name: "flirtual",
  full_name: "flirtual/flirtual",
  html_url: "https://github.com/flirtual/flirtual",
};

const senders = {
  flitty: {
    login: "flitty-bot[bot]",
    html_url: "https://github.com/apps/flitty-bot",
    avatar_url: "https://avatars.githubusercontent.com/in/4598857?v=4",
  },
  aries: {
    login: "ariesclark",
    html_url: "https://github.com/ariesclark",
    avatar_url: "https://avatars.githubusercontent.com/u/10256477?v=4",
  },
  kfarwell: {
    login: "kfarwell",
    html_url: "https://github.com/kfarwell",
    avatar_url: "https://avatars.githubusercontent.com/kfarwell",
  },
  torvalds: {
    login: "torvalds",
    html_url: "https://github.com/torvalds",
    avatar_url: "https://avatars.githubusercontent.com/torvalds",
  },
  renovate: {
    login: "renovate[bot]",
    html_url: "https://github.com/apps/renovate",
    avatar_url: "https://avatars.githubusercontent.com/renovate%5Bbot%5D",
  },
};

type Sender = (typeof senders)[keyof typeof senders];

function commit(index: number, message: string, author: Author) {
  const id = `${index}`.repeat(2) + "c8e1f4a7b3c6d5e8f9a0b1c2d3e4f5a6b7c8d".slice(2);

  return {
    id,
    tree_id: id,
    distinct: true,
    message,
    timestamp: "2026-08-17T12:00:00-07:00",
    url: `https://github.com/flirtual/flirtual/commit/${id}`,
    author,
    committer: { name: "GitHub", email: "noreply@github.com", username: "web-flow" },
    added: [],
    removed: [],
    modified: ["src/app.ts"],
  };
}

type PushOverrides = {
  branch: string;
  commits?: ReturnType<typeof commit>[];
  forced?: boolean;
  created?: boolean;
  deleted?: boolean;
  ref?: string;
  sender?: Sender;
};

function push({
  branch,
  commits = [],
  forced = false,
  created = false,
  deleted = false,
  ref = `refs/heads/${branch}`,
  sender = senders.aries,
}: PushOverrides): GithubEvent {
  return {
    type: "push",
    ref,
    before: "6c7286bd6d3c62ed00622991183073a7cf44384f",
    after: commits.at(-1)?.id ?? "0".repeat(40),
    created,
    deleted,
    forced,
    base_ref: null,
    compare: "https://github.com/flirtual/flirtual/compare/6c7286bd6d3c...f0e1d2c3b4a5",
    repository,
    pusher: { name: sender.login },
    sender,
    commits,
    head_commit: commits.at(-1) ?? null,
  } as unknown as GithubEvent;
}

export const pushScenarios: GithubEvent[] = [
  push({
    branch: "one-commit",
    commits: [commit(1, "fix: handle empty commit lists in the webhook renderer", authors.aries)],
  }),

  push({
    branch: "two-authors",
    sender: senders.kfarwell,
    commits: [
      commit(2, "feat: add retry with backoff to webhook delivery", authors.aries),
      commit(3, "chore: bump dependencies", authors.renovate),
    ],
  }),

  push({
    branch: "five-authors",
    sender: senders.torvalds,
    commits: [
      commit(4, "feat(parser): fold token lookahead into the scanner loop", authors.aries),
      commit(5, "perf: avoid re-encoding avatars on every render", authors.torvalds),
      commit(6, "docs: document the components v2 payload shape", authors.sindre),
      commit(7, "test: cover the merge chunking boundaries", authors.gaearon),
      commit(8, "chore: bump dependencies", authors.renovate),
    ],
  }),

  push({
    branch: "many-commits",
    sender: senders.kfarwell,
    commits: [
      commit(1, "refactor: extract the variant catalog into its own module", authors.aries),
      commit(2, "fix: escape brackets in bot usernames", authors.aries),
      commit(3, "feat: derive intrinsics from discord-api-types", authors.gaearon),
      commit(4, "test: snapshot every variant payload", authors.aries),
      commit(5, "chore: bump dependencies", authors.renovate),
      commit(6, "docs: add a readme for the jsx packages", authors.sindre),
      commit(7, "perf: reuse the photon canvas between composites", authors.torvalds),
      commit(8, "fix: prefer sender avatars for app authors", authors.flitty),
    ],
  }),

  push({
    branch: "long-subjects",
    commits: [
      commit(
        9,
        "fix(parser): handle `escaped` backticks in commit messages with an intentionally very long subject line that must be truncated",
        authors.aries,
      ),
      commit(
        1,
        "feat: this one has a body too\n\nthe body should never appear in the rendered commit line",
        authors.unmatched,
      ),
    ],
  }),

  push({
    branch: "force-push",
    forced: true,
    commits: [commit(2, "fix: rewrite history after a bad rebase", authors.aries)],
  }),

  push({
    branch: "feature/new-branch",
    created: true,
    commits: [commit(3, "feat: start the new deployment pipeline", authors.aries)],
  }),

  push({
    branch: "renovate/tidewave-0.x",
    sender: senders.renovate,
    commits: [commit(4, "chore(deps): update dependency tidewave to v0.4.2", authors.renovate)],
  }),

  push({
    branch: "ten-authors",
    sender: senders.torvalds,
    commits: [
      commit(1, "feat: add the thing", {
        name: "Aries Clark",
        email: null,
        username: "ariesclark",
      }),
      commit(2, "fix: correct the other thing", { name: "L T", email: null, username: "torvalds" }),
      commit(3, "docs: write it down", { name: "S S", email: null, username: "sindresorhus" }),
      commit(4, "test: prove it", { name: "D A", email: null, username: "gaearon" }),
      commit(5, "chore: tidy up", { name: "R B", email: null, username: "renovate[bot]" }),
      commit(6, "perf: make it fast", { name: "E W", email: null, username: "evanw" }),
      commit(7, "refactor: simplify", { name: "R F", email: null, username: "rich-harris" }),
      commit(8, "style: format", { name: "K F", email: null, username: "kfarwell" }),
      commit(9, "build: bump toolchain", { name: "F B", email: null, username: "flitty-bot[bot]" }),
      commit(1, "ci: cache deps", { name: "T O", email: null, username: "tj" }),
    ],
  }),

  push({ branch: "stale-branch", deleted: true, sender: senders.flitty }),

  push({ branch: "v1.4.0", ref: "refs/tags/v1.4.0", sender: senders.kfarwell }),
];

const apps = {
  actions: { id: 15368, name: "GitHub Actions", slug: "github-actions" },
  renovate: { id: 2740, name: "Renovate", slug: "renovate" },
  codeql: { id: 57789, name: "CodeQL", slug: "github-code-scanning" },
};

type CheckRunOverrides = {
  name: string;
  conclusion: string | null;
  seconds?: number;
  branch?: string;
  app?: (typeof apps)[keyof typeof apps];
  sender?: Sender;
};

function checkRun({
  name,
  conclusion,
  seconds = 45,
  branch = "main",
  app = apps.actions,
  sender = senders.aries,
}: CheckRunOverrides): GithubEvent {
  const started = new Date("2026-08-17T12:00:00-07:00");
  const completed = new Date(started.getTime() + seconds * 1000);
  const head_sha = "c4bef7bffe39cd4f08dab6566f0099555dbe7019";

  return {
    type: "check_run.completed",
    action: "completed",
    check_run: {
      id: 95263908430,
      name,
      head_sha,
      status: "completed",
      conclusion,
      started_at: started.toISOString(),
      completed_at: completed.toISOString(),
      html_url: "https://github.com/flirtual/flirtual/actions/runs/31987109115/job/95263908430",
      details_url: "https://github.com/flirtual/flirtual/actions/runs/31987109115",
      app,
      check_suite: { id: 1, head_branch: branch },
      output: { title: null, summary: null },
    },
    repository,
    sender,
  } as unknown as GithubEvent;
}

export const checkRunScenarios: GithubEvent[] = [
  checkRun({ name: "eslint", conclusion: "success", seconds: 44 }),
  checkRun({ name: "typescript (canary)", conclusion: "failure", seconds: 50 }),
  checkRun({ name: "release (canary)", conclusion: "success", seconds: 107 }),
  checkRun({ name: "audit", conclusion: "cancelled", seconds: 12 }),
  checkRun({ name: "e2e (chromium)", conclusion: "timed_out", seconds: 3600 }),
  checkRun({ name: "deploy-production", conclusion: "skipped", seconds: 0 }),
  checkRun({ name: "license/cla", conclusion: "action_required", seconds: 3 }),
  checkRun({
    name: "Analyze (javascript-typescript)",
    conclusion: "success",
    seconds: 115,
    app: apps.codeql,
  }),
  checkRun({
    name: "Renovate",
    conclusion: "neutral",
    seconds: 104,
    app: apps.renovate,
    sender: senders.renovate,
  }),
  checkRun({
    name: "build and publish the container image for the production environment",
    conclusion: "success",
    seconds: 275,
    branch: "feature/new-branch",
  }),
];
