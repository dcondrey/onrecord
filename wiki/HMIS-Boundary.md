# HMIS and interoperability boundary

On Record can eventually complement a Continuum of Care, HMIS, coordinated entry, or Shelter Ready
workflow. It is not an HMIS because it has signed records or a map.

## Keep separate

Public: consented, de-identified asks, exchanges, service-directory facts, and neighborhood aggregates.
Private: identity, enrollment, coordinated-entry assessments, case management, disability/health details,
victim-service records, recovery material, and provider audit logs.

Do not add HUD data elements to the public schema for convenience. A protected integration must map the
minimum fields to the current HUD HMIS Data Standards release and local CoC dictionary, with versioned
tests. Victim-service providers may require a separate workflow under VAWA, FVPSA, and related rules.

## Integration review packet

Before enabling a connector, document fields and direction of flow, a data-sharing agreement and
permitted-use matrix, legal basis and notice, roles, retention/deletion, correction/withdrawal/grievance,
an access-controlled API, threat model, synthetic fixtures, incident plan, freshness/provenance, and
rollback. A connector that cannot answer these questions stays disabled.
