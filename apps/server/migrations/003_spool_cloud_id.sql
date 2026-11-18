-- Experimental Bambu cloud filament sync: stable cloud spool identity for
-- dedupe and linking. Additive column only; reverting the feature leaves the
-- nullable column unused and harmless.
ALTER TABLE spool ADD COLUMN cloud_spool_id INTEGER;
CREATE UNIQUE INDEX idx_spool_cloud_spool_id ON spool(cloud_spool_id) WHERE cloud_spool_id IS NOT NULL;
