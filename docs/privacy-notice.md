# On Record privacy notice

**Plain-language notice for people using the service.**

On Record collects only what is needed to create, protect, and follow up on a request:

- the request and the person’s own words;
- consent and the advocate/site that recorded it;
- a neighborhood-level service area, never a precise address;
- an optional recovery-card verifier so the person can return without an account; and
- provider responses, status changes, and security events.

The recovery card is designed to avoid collecting a full name. A deployment may use three-character
name tokens, date of birth, ZIP, and a PIN, but stores only a one-way verifier tag. Data is used to
return the record to its holder, route a response through an authorized provider, measure documented
non-response, prevent tampering, and investigate misuse.

Data is disclosed only to the person who holds the recovery credential, authorized providers and
advocates who need it for the stated service, auditors/security staff, or when legally required.
Public views must contain de-identified, consented, neighborhood-level records—not names, dates of
birth, ZIP codes, recovery material, or precise locations.

People must be told this notice before intake, in a language and format they can understand. They may
decline optional fields, ask what is held about their record, request correction, withdraw consent
where applicable, and ask an advocate about restore or deletion policy. A real deployment must add
its operator identity, retention schedule, complaint contact, legal authority, and jurisdiction-specific
rights before production use.

This repository’s static viewer is a demonstration. It is not an HMIS, does not connect to a live
provider system, and must not be used to route a person or store real protected information.
