# PR Change Summary — Calculator Minor Review Findings (#421)

## Addressed Items

### 1. Fully-covered plan built from an explicit field list ✅ (#421 finding 1)
**Problem:** `resolveEffectiveOnHandCredit` built the "target already fully on hand" plan by spreading a throwaway 1-unit probe plan and zeroing a hand-kept list of fields, so a field added to `walkRecipeTree`'s return later would silently leak a stale 1-unit value.
**Solution:** Only the variant-describing fields (item, tier, contract, station, craft time) are carried over from the probe, by name. A new field is now absent from the empty plan rather than stale. A test pins the exact field set.

### 2. Tripwire for the credit model's untested recipe shape ✅ (#421 finding 2)
**Solution:** A dataset test fails if any recipe has two sibling nested craftables consuming the same leaf, the one shape the on-hand credit model has no demonstrated-correct handling for. No such recipe exists today.

### 3. Info line does not name the short ingredients — declined (#421 finding 3)
Naming them repeats what the Shortfall table directly above lists, and an existing test forbids repeating pooled resources. Cosmetic only.

## Compatibility
No behaviour change, no schema, command-definition or Discord character-budget changes.
