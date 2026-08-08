# GitHub Discussions category plan

GitHub Discussion categories are repository settings, not files. This document defines the intended
categories so maintainers can configure them consistently once an authenticated administrator applies
the changes.

## Recommended categories

| Category | Format | Purpose | Examples | Moderation note |
|---|---|---|---|---|
| **Announcements** | Announcement | Maintainer decisions, releases, policy changes, and review dates | Pilot gate; privacy revision | Maintainers only for new topics |
| **Pilot Design** | Discussion | The smallest safe governed pilot | First use case; stop conditions | Invite lived-experience reviewers first |
| **Community Experience** | Discussion | Accessibility, dignity, field use, and practical feedback | Recovery card; paper workflow | No real stories or identifiers |
| **Safety & Privacy** | Discussion | Public/private boundaries, moderation, recovery, and threat modeling | Data minimization; abuse response | Never disclose secrets or protected records |
| **Provider & Government Practice** | Discussion | Provider workflows, accountability, HMIS, and coordination | Neutral events; interoperability | No confidential agency/client information |
| **Ideas & Improvements** | Idea | Feature proposals with benefit, harm, data, owner, and stop rule | Offline mode; translations | Reject surveillance without need |
| **Q&A** | Q&A | Maintainer answers about the prototype and handbook | “What does a green seal prove?” | Pin corrections and link the handbook |

## Category rules

- Keep announcements and decisions separate from brainstorming.
- Use Community Experience for lived-experience feedback without asking anyone to identify themselves.
- Use Safety & Privacy for risks; do not troubleshoot an active incident in public.
- Require an owner and review date for changes to data collection or public visibility.
- Close threads with the decision, unresolved risks, and links to resulting code or documentation.

## Prepared topic mapping

| Seed | Category |
|---|---|
| First governed pilot | Pilot Design |
| Recovery card usability | Community Experience |
| Public/private boundary | Safety & Privacy |
| Mutual aid moderation | Safety & Privacy |
| Provider participation | Provider & Government Practice |
| Field accessibility | Community Experience |
| HMIS boundary | Provider & Government Practice |

## Administrator publication steps

After authenticating with a token that can administer Discussions:

1. Create or rename the categories above in repository settings.
2. Confirm category IDs through GitHub’s GraphQL API.
3. Publish each seed once, preserving its title and body.
4. Pin the category guidance and add the safety reminder to the repository welcome text.
5. Record resulting URLs in a maintainer changelog; never put private participant information there.

The repository includes `scripts/publish-discussions.sh`. It uses the authenticated local `gh`
credential, verifies category names, skips duplicate titles, and publishes the seven prepared seeds. It
never prints or stores the token. Run it from the repository root:

```sh
gh auth status
bash scripts/publish-discussions.sh
```
