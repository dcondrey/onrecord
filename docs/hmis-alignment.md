# HMIS and HUD alignment boundary

On Record can be a public, de-identified communication layer around an HMIS, but it should not
pretend to be an HMIS merely because it has records, maps, or signatures.

## Keep the layers separate

The public artifact may contain only consented, de-identified asks, exchanges, service-directory
facts, and neighborhood-level metrics. A private service layer must hold client identity, coordinated
entry, enrollment, case management, disability/health details, domestic-violence or victim-service
records, and other protected data. Recovery material and provider audit logs are private security data.

Do not add HUD data elements to the public schema as a convenience. If a real deployment needs current
HUD/HMIS elements—such as housing status, household composition, or the current sex/gender-related
elements—implement them in a protected, versioned intake schema mapped to the applicable HUD HMIS
Data Standards release and CoC data dictionary. Review every release; standards change.

Victim service providers may be subject to VAWA, FVPSA, and related confidentiality rules that require
different collection, disclosure, consent, and database practices. They must not be forced into the
same data path as general providers. Use a separate protected workflow and consult the CoC privacy
officer and counsel before integration.

Before interoperability, establish a data-sharing agreement, permitted-use matrix, role mapping,
retention/deletion schedule, client notice/consent process, correction and grievance process, breach
response, and an access-controlled API. Treat HUD/HMIS mapping as an integration project—not as a
reason to publish more personal data on this map.
