# Privacy and consent

**Plain-language rule:** a person should understand what is collected, what becomes public, who can see
it, how long it is kept, and how to correct or withdraw it before agreeing.

## Public versus private

Public material may contain only a consented request, broad service area, minimal category, and a
de-identified status. It must not contain names, DOBs, ZIP codes, health or victim-service information,
immigration details, recovery material, precise sleeping locations, or identifying combinations.

Private systems may hold identity, recovery verifiers, intake/case details, provider routing, and audit
events only when an approved operator has the security controls and a legitimate need.

## What the intake worker must do

1. Explain the purpose in the person’s language and preferred format.
2. Read back the request and show the proposed public version.
3. Mark optional fields clearly; never make unrelated help conditional on them.
4. Record the consent method, time, advocate, scope, and any expiration.
5. Explain correction, withdrawal, deletion, restore, complaint, and appeal routes.
6. Provide a paper copy or safe way to return without a personal device.

## Recovery credentials

The first-three-letters/date/ZIP pattern can be memorable but is guessable. It is a locator, not strong
authentication. Pair it with a separate PIN — but that PIN is offline-verifiable by design (published
in every signed entry so no server needs to be consulted to check it), so rate-limiting attempts and
using non-revealing errors are not real mitigations for it: there is no request path to limit or to
keep silent on, and all 10,000 PINs can be brute-forced offline in well under a minute given only the
public identity fields. Advocate-led restore remains available regardless. Never write the PIN, DOB,
ZIP, or phrase in logs, screenshots, public posts, or analytics. Where disclosure could create danger or
coercion, use the phrase-based recovery scheme instead of the identity-based one — see
[Limitations](./Limitations) for the full explanation.

## Operator notice fields

Every deployment must publish its legal/operator name, privacy contact, permitted uses, recipients,
retention/deletion schedule, breach contact, accessibility/translation options, and complaint process.
This repository’s template is not a finished legal notice.
