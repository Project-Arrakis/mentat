// ACP Issue Bridge — label taxonomy definitions (spec sections 12/13).
// Presentation metadata (color/description) only — policy (which labels are
// allowlisted to cross repositories, which must never be public, etc.) lives
// in acp-issue-bridge.yml, not here (section 75: "do not scatter policy
// constants through source code").

const TYPE_COLOR = "1d76db";
const STATUS_COLOR = "0e8a16";
const AREA_COLOR = "5319e7";

export const PUBLIC_LABELS = [
  { name: "type:bug", color: TYPE_COLOR, description: "A defect in existing behavior" },
  { name: "type:feature", color: TYPE_COLOR, description: "A request for new capability" },
  { name: "type:documentation", color: TYPE_COLOR, description: "Documentation is missing, unclear, or wrong" },
  { name: "type:support", color: TYPE_COLOR, description: "A usage/support question" },
  { name: "type:compatibility", color: TYPE_COLOR, description: "A compatibility issue with an environment or dependency" },
  { name: "type:performance", color: TYPE_COLOR, description: "A performance problem" },

  { name: "status:needs-triage", color: STATUS_COLOR, description: "Not yet reviewed by the ACP team" },
  { name: "status:confirmed", color: STATUS_COLOR, description: "Reproduced or otherwise confirmed" },
  { name: "status:planned", color: STATUS_COLOR, description: "Accepted and planned for engineering work" },
  { name: "status:in-progress", color: STATUS_COLOR, description: "Engineering work is in progress" },
  { name: "status:blocked", color: STATUS_COLOR, description: "Blocked on a dependency or prerequisite" },
  { name: "status:testing", color: STATUS_COLOR, description: "A remediation is undergoing validation" },
  { name: "status:ready-for-release", color: STATUS_COLOR, description: "Validated and awaiting release" },
  { name: "status:released", color: STATUS_COLOR, description: "The remediation has been released" },

  { name: "priority:p0", color: "b60205", description: "Critical priority" },
  { name: "priority:p1", color: "d93f0b", description: "High priority" },
  { name: "priority:p2", color: "fbca04", description: "Medium priority" },
  { name: "priority:p3", color: "c5def5", description: "Low priority" },

  { name: "area:discord", color: AREA_COLOR, description: "The Discord bot surface" },
  { name: "area:commands", color: AREA_COLOR, description: "Slash commands" },
  { name: "area:readiness", color: AREA_COLOR, description: "Server readiness checks" },
  { name: "area:metrics", color: AREA_COLOR, description: "Metrics and statistics" },
  { name: "area:notifications", color: AREA_COLOR, description: "Scheduled posts and alerts" },
  { name: "area:deployment", color: AREA_COLOR, description: "Installation and deployment" },
  { name: "area:documentation", color: AREA_COLOR, description: "Docs site or in-repo docs" },
  { name: "area:authentication", color: AREA_COLOR, description: "Login, OAuth, linking" },
  { name: "area:permissions", color: AREA_COLOR, description: "Roles and access control" },
  { name: "area:observability", color: AREA_COLOR, description: "Logging, dashboards, health" },
  { name: "area:webui", color: AREA_COLOR, description: "The Dune Docker Console WebUI" },
  { name: "area:api", color: AREA_COLOR, description: "The WebUI adapter API" }
];

export const PRIVATE_LABELS = [
  { name: "source:public", color: "cfd3d7", description: "ACP Issue Bridge: mirrored from the public repository" },
  { name: "source:internal", color: "cfd3d7", description: "ACP Issue Bridge: created directly in engineering" },

  // type:* is not enumerated in spec section 13's private taxonomy list,
  // but section 14/15's label_mapping applies these classification labels
  // to private mirrors, so they must exist here too (GitHub's "add labels"
  // API does not auto-create missing labels — omitting these would make
  // every public-issue-opened label translation fail with a 422).
  { name: "type:bug", color: TYPE_COLOR, description: "A defect in existing behavior" },
  { name: "type:feature", color: TYPE_COLOR, description: "A request for new capability" },
  { name: "type:documentation", color: TYPE_COLOR, description: "Documentation is missing, unclear, or wrong" },
  { name: "type:support", color: TYPE_COLOR, description: "A usage/support question" },
  { name: "type:compatibility", color: TYPE_COLOR, description: "A compatibility issue with an environment or dependency" },
  { name: "type:performance", color: TYPE_COLOR, description: "A performance problem" },

  { name: "visibility:internal", color: "bfd4f2", description: "ACP Issue Bridge: internal by default, never expose publicly" },
  { name: "visibility:security-sensitive", color: "b60205", description: "ACP Issue Bridge: outbound sync is fail-closed while set" },

  { name: "sync:enabled", color: "0e8a16", description: "ACP Issue Bridge: outbound synchronization is active" },
  { name: "sync:paused", color: "fbca04", description: "ACP Issue Bridge: outbound synchronization is paused" },
  { name: "sync:error", color: "b60205", description: "ACP Issue Bridge: synchronization needs operator attention" },

  { name: "status:triaged", color: STATUS_COLOR, description: "Reviewed by the engineering team" },
  { name: "status:confirmed", color: STATUS_COLOR, description: "Reproduced or otherwise confirmed" },
  { name: "status:planned", color: STATUS_COLOR, description: "Accepted and planned for engineering work" },
  { name: "status:in-progress", color: STATUS_COLOR, description: "Engineering work is in progress" },
  { name: "status:blocked", color: STATUS_COLOR, description: "Blocked on a dependency or prerequisite" },
  { name: "status:testing", color: STATUS_COLOR, description: "A remediation is undergoing validation" },
  { name: "status:ready-for-release", color: STATUS_COLOR, description: "Validated and awaiting release" },
  { name: "status:released", color: STATUS_COLOR, description: "The remediation has been released" },
  { name: "status:public-closed", color: "5319e7", description: "The public issue was closed; engineering work is independent" },

  { name: "priority:p0", color: "b60205", description: "Critical priority" },
  { name: "priority:p1", color: "d93f0b", description: "High priority" },
  { name: "priority:p2", color: "fbca04", description: "Medium priority" },
  { name: "priority:p3", color: "c5def5", description: "Low priority" },

  { name: "area:discord", color: AREA_COLOR, description: "The Discord bot surface" },
  { name: "area:commands", color: AREA_COLOR, description: "Slash commands" },
  { name: "area:readiness", color: AREA_COLOR, description: "Server readiness checks" },
  { name: "area:metrics", color: AREA_COLOR, description: "Metrics and statistics" },
  { name: "area:notifications", color: AREA_COLOR, description: "Scheduled posts and alerts" },
  { name: "area:deployment", color: AREA_COLOR, description: "Installation and deployment" },
  { name: "area:documentation", color: AREA_COLOR, description: "Docs site or in-repo docs" },
  { name: "area:authentication", color: AREA_COLOR, description: "Login, OAuth, linking" },
  { name: "area:permissions", color: AREA_COLOR, description: "Roles and access control" },
  { name: "area:observability", color: AREA_COLOR, description: "Logging, dashboards, health" },
  { name: "area:webui", color: AREA_COLOR, description: "The Dune Docker Console WebUI" },
  { name: "area:api", color: AREA_COLOR, description: "The WebUI adapter API" }
];
