-- Freeze product attribution at posting time; corrections reverse the original attribution.
ALTER TABLE inventory_transaction ADD COLUMN product_id TEXT REFERENCES filament_product(id);
UPDATE inventory_transaction SET product_id=(SELECT product_id FROM spool WHERE spool.id=spool_id);
CREATE TRIGGER ledger_requires_product BEFORE INSERT ON inventory_transaction
WHEN NEW.product_id IS NULL BEGIN SELECT RAISE(ABORT,'ledger product snapshot required'); END;
CREATE TRIGGER ledger_immutable_update BEFORE UPDATE ON inventory_transaction
BEGIN SELECT RAISE(ABORT,'inventory ledger is append-only'); END;
CREATE TRIGGER ledger_immutable_delete BEFORE DELETE ON inventory_transaction
BEGIN SELECT RAISE(ABORT,'inventory ledger is append-only'); END;
