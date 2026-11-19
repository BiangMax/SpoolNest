CREATE TABLE restock_rule (
  material TEXT NOT NULL,
  color_hex TEXT NOT NULL,
  minimum_mg INTEGER CHECK(minimum_mg >= 0),
  ordered INTEGER NOT NULL DEFAULT 0 CHECK(ordered IN (0, 1)),
  version INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY(material, color_hex)
);
