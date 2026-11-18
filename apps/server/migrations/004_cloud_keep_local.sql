-- Remember the user's choice to retain a local-only spool across cloud comparisons.
ALTER TABLE spool ADD COLUMN cloud_keep_local INTEGER NOT NULL DEFAULT 0 CHECK(cloud_keep_local IN (0,1));
