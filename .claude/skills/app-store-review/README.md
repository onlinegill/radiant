# app-store-review

A skill for AI coding agents (Claude Code, Codex, Cursor, or any harness that
reads a `SKILL.md`) that gets an iOS/iPadOS app through App Store review and
keeps it there. It covers the submission checklist, what each App Store
Connect status means and what to do, how to read a rejection and fix metadata
without a new build, TestFlight versus App Store, age rating and privacy for
apps that generate text or accept a user's own API key, and the App Store
Connect UI traps that each cost a review cycle.

Everything in it was learned shipping [Radiant](https://github.com/templetongroup/radiant)
for iPhone: three rejections, one lost day, a 30-character subtitle that was
both rejections at once, and a consent sheet that should have existed before
the first submission. The `reference/` folder has the real rejections and a
checklist.

## Install

Claude Code, for one project:

```bash
git clone https://github.com/templetongroup/app-store-review .claude/skills/app-store-review
```

Claude Code, for every project on this machine:

```bash
git clone https://github.com/templetongroup/app-store-review ~/.claude/skills/app-store-review
```

Then `/app-store-review`, or just ask about the submission — the description
in `SKILL.md` tells the agent when to reach for it.

Other harnesses: point the agent at `SKILL.md`; it is plain Markdown and
assumes nothing about tools. Where it says "open App Store Connect", an agent
without a browser writes the steps for you.

## What it will not do

Press Submit, reply to App Review, upload a build, or touch your credentials.
Those are the account holder's, and the skill says so.

## License

MIT — Templeton Technologies.
