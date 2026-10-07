---
name: release
description: Cut a release of this repo with `pnpm release`. Use when the user asks to release, tag or bump a version, or publish a new docker image.
---

# Release

`pnpm release` is the one path to a release. It moves **Unreleased** in
`CHANGELOG.md` under the version, bumps `package.json`, commits
`Release X.Y.Z`, tags `vX.Y.Z` and, when it pushes, waits until `docker pull`
gets the new image. Its checks are what keep the version, the changelog and the
image tags in step, so every bump, tag and push of a release goes through it.

## Steps

1. **Cover Unreleased.** Every commit since the last tag has its line under
   **Unreleased** in `CHANGELOG.md`:

   ```bash
   git log --oneline "$(git describe --tags --abbrev=0)"..HEAD
   ```

   Commit missing lines on their own first. Done when the tree is clean and each
   listed commit that changes behavior, UI or docs is covered.

2. **Pick the version.** A version the user names wins. Otherwise only
   **Fixed** entries make the next patch, anything else the next minor, and a
   major waits for the user to ask.

3. **Cut it.**
   - In this sandbox: `pnpm release X.Y.Z --no-push`. Done when it prints
     `Committed and tagged vX.Y.Z.` Then tell the user to run `pnpm release`
     outside the sandbox, which pushes and waits for the image.
   - Only when the user says to push from here: `pnpm release X.Y.Z`. It waits
     for the build, a few minutes, so give it a long timeout. Done when it
     prints `Done: docker pull ... gets X.Y.Z.`

## When it stops

The script's errors name their cause. Two need judgement:

- **The build ended in failure.** The tag is already public, so it stays where
  it is. Fix forward and cut the next patch.
- **The build passed but `:latest` or `:1` point elsewhere.** Re-run the
  workflow run the message links (GitHub Actions, "Re-run all jobs"). If a newer
  release owns those tags, that is correct and nothing needs doing.
