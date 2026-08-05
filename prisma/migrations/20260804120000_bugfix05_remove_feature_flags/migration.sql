-- BugFix-05: Dead feature-flag tables removed (feature flags were superseded
-- by the versioned settings catalog + CapabilityFlagsService). Tables are
-- dropped unconditionally; the schema has no residual references.
DROP TABLE IF EXISTS "household_feature_flags";
DROP TABLE IF EXISTS "global_feature_flags";
