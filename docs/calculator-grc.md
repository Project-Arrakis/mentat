# Crafting Calculator — GRC Review

## Status

This is a pre-implementation compliance review for `/dune data calculator`.
It classifies the feature's data-handling posture, records third-party data
attribution, and defines the audit-trail requirement for recipe-data drift.
It does not assert any new certification claim — see
[SOC 2 Alignment Notes](soc2-alignment.md) for the repository's overall
compliance posture, which this feature does not change.

## Data Classification

| Category | Present? | Notes |
|---|---|---|
| Personally identifiable information (PII) | No | No Discord user data, Steam ID, Funcom ID, or character data is read, stored, or transmitted. |
| Game-account or player data | No | No adapter call, no database query. |
| Secrets / credentials | No | No token, bearer credential, or config value is required for this code path. |
| Third-party copyrighted reference data | Yes | Recipe ratios, item names, station tiers — see Attribution below. |

This is the lowest data-classification category the bot has shipped —
below even `core:about`, which at least reflects live adapter configuration.
No new privacy-policy update is required; [Privacy Policy](privacy-policy.md)
already correctly states the bot collects no message content and persists no
user data, and this feature does not change that.

## Third-Party Data Attribution

Recipe data is sourced from
[dune.gaming.tools/crafting-calculator](https://dune.gaming.tools/crafting-calculator),
a fan-made reference site whose own footer states it is *"not affiliated with
Dune Awakening game, Funcom or Legendary"* and is itself derived from
Funcom/Legendary's published game mechanics (item names, recipe ratios).

This bot already displays other Funcom/Legendary-copyrighted game content
throughout `embedFormat.js` (item names, faction lore text) without a
licensing review blocking it. The calculator's recipe data is the same
category of fan-derived reference data already accepted by precedent — no
new legal-review category is introduced.

**Required disclosure (documentation completeness item, not a blocker):**
a one-line attribution comment at the top of `craftingData.js`:

```js
// Recipe data derived from published Dune Awakening game mechanics;
// verified against https://dune.gaming.tools/crafting-calculator
// (fan reference site, not affiliated with Funcom/Legendary).
```

## Data-Drift Risk — The Primary Ongoing Compliance Concern

Recipe ratios are transcribed from a live-service game that receives regular
balance patches. This is **not a one-time launch concern** — the data will go
stale after future patches, and pretending otherwise is the single largest
ongoing risk in this feature (see also
[Security Review §FINDING-CALC-3](calculator-security-review.md)).

**Audit-trail requirements:**

1. Every recipe entry in `craftingData.js` must carry a structural
   `source: { url, verifiedAt }` field, not a comment — so a future "the
   calculator gave me the wrong numbers" report has a clear paper trail back
   to *when* the data was last confirmed correct, without needing git
   archaeology.
2. A `docs/changes/PR-####-crafting-calculator.md` change note (per this
   repo's [change-note convention](changes/README.md)) must record the
   verification date and source at ship time.
3. Any future PR that updates recipe values (in response to a game balance
   patch) must update the corresponding `verifiedAt` date and add a new
   change note — recipe-data PRs are not exempt from the same documentation
   discipline as code PRs.

## Dependency and Supply-Chain Review

No new npm package is required. The feature is expressible entirely with the
existing `discord.js` + plain JS toolchain already in `package.json`. This
adds **zero net new supply-chain surface** — no new SBOM entries, no new
Dependabot tracking target, no new `npm audit` surface.

## Required Evidence for the Implementation PR

Per [SOC 2 Alignment Notes — Required Evidence Discipline](soc2-alignment.md#required-evidence-discipline)
and [Security Gates](security-gates.md), the implementation PR must include:

- PR body using `.github/PULL_REQUEST_TEMPLATE.md`
- a durable change note under `docs/changes/` (per the audit-trail
  requirement above)
- passing unit/integration tests (see
  [Architecture §Testing](calculator-architecture.md) and the
  implementation prompt's test-plan section)
- passing security gates: `npm run check`, Semgrep, Gitleaks, Trivy,
  `npm audit` — no new findings expected given the zero-dependency,
  zero-adapter-call design
- no dependency review evidence needed (no dependency changes)
- no SBOM changes expected (no new package)

## Non-Goals / Explicit Scope Boundary

- Not a claim of data accuracy guarantee to end users — the response embed
  should itself carry an implicit "reference data, verify in-game for
  critical crafting decisions" posture consistent with how the reference
  site itself is presented, though this is a documentation nicety, not a
  legal requirement given the low stakes of the data (crafting ratios, not
  financial or safety-critical information).
- Not an extension of the bot's data-retention or privacy scope — this
  feature is stateless and does not change any answer in
  [Privacy Policy](privacy-policy.md).

## Sources

- [Design](calculator-design.md)
- [Architecture](calculator-architecture.md)
- [Security Review](calculator-security-review.md)
- [SOC 2 Alignment Notes](soc2-alignment.md)
- [Privacy Policy](privacy-policy.md)
- [Change Notes Index](changes/README.md)
</content>
