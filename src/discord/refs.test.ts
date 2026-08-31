import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { preferredRef, refDisplay, refTarget } from "./refs.ts";

describe("refTarget", () => {
  it("links a branch to its tree", () => {
    assert.deepEqual(refTarget("renovate/capacitor"), {
      label: "renovate/capacitor",
      path: "tree/renovate/capacitor",
      kind: "branch",
    });
  });

  it("strips a fully qualified branch or tag", () => {
    assert.equal(refTarget("refs/heads/main").label, "main");
    assert.equal(refTarget("refs/tags/v1.4.0").label, "v1.4.0");
  });

  it("names a pull request rather than a ref that has no tree", () => {
    assert.deepEqual(refTarget("refs/pull/277/merge"), {
      label: "277",
      path: "pull/277",
      kind: "pull",
    });
  });

  it("shortens a commit and points at the commit, not a branch", () => {
    const sha = "4f738bc9c5725928d79df27d2bcc872a889e75d3";

    assert.deepEqual(refTarget(sha), { label: "4f738bc", path: `commit/${sha}`, kind: "commit" });
  });
});

const flirtual = {
  html_url: "https://github.com/flirtual/flirtual",
  name: "flirtual",
  full_name: "flirtual/flirtual",
};

const fork = {
  html_url: "https://github.com/alice/flirtual",
  name: "flirtual",
  full_name: "alice/flirtual",
};

describe("refDisplay", () => {
  it("names the repository on an organization hook, where events arrive from many", () => {
    const { text } = refDisplay({ ref: "main", repository: flirtual, hook: "organization" });

    assert.equal(text, "flirtual:main");
  });

  it("leaves the repository out on a repository hook, where it never varies", () => {
    const { text } = refDisplay({ ref: "main", repository: flirtual, hook: "repository" });

    assert.equal(text, "main");
  });

  it("names the owner too when the ref lives somewhere else", () => {
    for (const hook of ["organization", "repository"] as const) {
      const { text, href } = refDisplay({
        ref: "patch-1",
        repository: fork,
        within: flirtual,
        hook,
      });

      assert.equal(text, "alice/flirtual:patch-1");
      assert.equal(href, "https://github.com/alice/flirtual/tree/patch-1");
    }
  });

  it("joins a pull request and a commit the way GitHub writes them", () => {
    assert.equal(
      refDisplay({ ref: "refs/pull/277/merge", repository: flirtual, hook: "organization" }).text,
      "flirtual#277",
    );

    assert.equal(
      refDisplay({
        ref: "4f738bc9c5725928d79df27d2bcc872a889e75d3",
        repository: flirtual,
        hook: "organization",
      }).text,
      "flirtual@4f738bc",
    );
  });

  it("still names a bare pull request when the repository is implied", () => {
    const { text } = refDisplay({
      ref: "refs/pull/277/merge",
      repository: flirtual,
      hook: "repository",
    });

    assert.equal(text, "#277");
  });

  it("drops a repository the message has already named", () => {
    const { text } = refDisplay({
      ref: "main",
      repository: flirtual,
      within: flirtual,
      hook: "organization",
      established: true,
    });

    assert.equal(text, "main");
  });

  it("still names another repository, which naming this one did not establish", () => {
    const { text } = refDisplay({
      ref: "patch-1",
      repository: fork,
      within: flirtual,
      hook: "organization",
      established: true,
    });

    assert.equal(text, "alice/flirtual:patch-1");
  });

  it("treats a repository that only matches by name as elsewhere", () => {
    const { text } = refDisplay({
      ref: "main",
      repository: fork,
      within: flirtual,
      hook: "repository",
    });

    assert.equal(text, "alice/flirtual:main");
  });
});

describe("preferredRef", () => {
  it("names the pull request when the run belongs to exactly one", () => {
    assert.equal(preferredRef("renovate/faker-0.x", [{ number: 279 }]), "refs/pull/279/head");
  });

  it("keeps the branch when no pull request is attached", () => {
    assert.equal(preferredRef("main", []), "main");
    assert.equal(preferredRef("main", undefined), "main");
  });

  it("keeps the branch when several pull requests share it", () => {
    assert.equal(preferredRef("shared", [{ number: 1 }, { number: 2 }]), "shared");
  });
});
