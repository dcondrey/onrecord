# Discussion moderation automation

On Record uses automation to help humans notice risk; it does not delegate judgment about people to a
classifier. GitHub supports workflow triggers for discussions and discussion comments when they are
created or edited. The repository workflow listens to those events and adds review labels when simple,
reviewable signals appear.

## What the workflow detects

- High link volume or repeated filler that may be spam.
- Common payment/prize language that may indicate a scam.
- Direct threat language.
- Requests or disclosures involving addresses, SSNs, DOBs, recovery codes, or exact sleeping locations.
- A small set of dehumanizing or targeted-harassment patterns.
- Empty or obvious character-flood content.

These are signals, not findings. A person may quote harmful language while reporting it; a multilingual
post may be misunderstood; and a lived-experience contribution may be emotionally intense. Every label
requires a human review.

## What it deliberately does not do

- It does not delete, hide, lock, or edit content automatically.
- It does not ban or suspend an account automatically.
- It does not send discussion text to a third-party AI moderation service.
- It does not treat disagreement, anger, poverty, disability, or criticism of the project as abuse.
- It does not expose the suspected content in a public bot reply.

## Human response

Reviewers should read the full context, preserve evidence privately, correct or remove only what is
necessary, and invite an edit when safety permits. Threats, doxxing, scams, and privacy exposure may need
urgent action; contact the project conduct address and use emergency services for immediate danger. Appeals
must be private and must not repeat the harmful material.

## Maintenance

Review the signal list quarterly with lived-experience and accessibility advisors. Add a signal only with
an example of the harm, a false-positive test, an owner, and a rollback plan. Never turn the workflow into
a hidden ranking of users or a substitute for a trained moderator.
