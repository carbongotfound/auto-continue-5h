# auto-continue-5h

A Claude Code mod. When a session hits the 5-hour usage limit, it waits until the limit resets (plus one minute) and then types "continue" for you, so the work picks up where it stopped.

- Only the 5-hour limit. Weekly and other limits are left alone.
- If Claude Code's own auto-continue already handles the limit, the mod stays quiet.
- The status line shows when it will continue. `/continue-cancel` cancels it, and typing anything yourself cancels it too.

## Install

At the prompt of a terminal session:

```
/plugin install auto-continue-5h --marketplace carbongotfound/auto-continue-5h
```

Answer `y` to add the marketplace, then pick the user scope so it runs in every session.

From a shell:

```
claude plugin install auto-continue-5h --marketplace carbongotfound/auto-continue-5h
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `carbongotfound/auto-continue-5h`, then Add plugin.

This repository is private: it installs only for people who can read it on GitHub and whose machine already holds a git credential for github.com (an SSH key, or `gh auth login` then `gh auth setup-git`).
