# GitHub Discussions category plan

GitHub Discussion categories are repository settings, not files. This document defines the intended
categories so maintainers can configure them consistently once an authenticated administrator applies
the changes.

## Recommended sections and categories

GitHub provides discussion categories and formats, but it does not currently provide a nested
“section → category” hierarchy in the same way a forum does. We should still use three conceptual
sections in the welcome text, sidebar, and moderation workflow. The **Section** column below is the
grouping maintainers use when explaining where a conversation belongs.

| Section | Category | Format | Brief description | Examples | Moderation note |
|---|---|---|---|---|
| Welcome & orientation | **Announcements** | Announcement | Official project updates, decisions, releases, policy changes, and review dates | Pilot gate; privacy revision | Maintainers only for new topics |
| Welcome & orientation | **Q&A** | Question/Answer | Maintainer answers about the prototype, handbook, limits, and how to participate | “What does a green seal prove?” | Pin corrections and link the handbook |
| Design & governance | **Pilot Design** | Open-ended discussion | Design the smallest safe governed pilot and define success and stop conditions | First use case; staffing | Invite lived-experience reviewers first |
| Design & governance | **Safety & Privacy** | Open-ended discussion | Public/private boundaries, moderation, recovery, threat modeling, and harm prevention | Data minimization; abuse response | Never disclose secrets or protected records |
| Design & governance | **Provider & Government Practice** | Open-ended discussion | Provider workflows, accountability, HMIS boundaries, and public-sector coordination | Neutral events; interoperability | No confidential agency/client information |
| Community experience | **Community Experience** | Open-ended discussion | Accessibility, dignity, field use, paper workflows, and lived-experience feedback | Recovery card; borrowed phone | No real stories or identifiers |
| Community experience | **Ideas & Improvements** | Open-ended discussion | Feature proposals that name benefits, harms, data, owner, and stop rule | Offline mode; translations | Reject surveillance without need |
| Community experience | **Community Polls** | Poll | Small, non-sensitive preference checks after context is provided | Wording; print layout; meeting time | Never poll about identity, trauma, service eligibility, or a person’s case |

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

The seven prepared seeds intentionally use open-ended discussion categories. Polls should be used only
after a discussion has explained the tradeoffs; a poll must not replace consent, accessibility testing,
lived-experience review, or a safety decision.

## Should we use sections?

Yes—but as a clear information architecture rather than pretending GitHub has nested categories. Use the
three sections above in the repository welcome post, wiki sidebar, pinned category descriptions, and
moderator triage. Do not create a separate category for every audience; that would fragment conversations
and make safety review harder. The “For the general public,” “For people living outdoors,” and “For
providers and government” pages remain documentation and commitments, while Discussions remain questions
about improving the project.

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
