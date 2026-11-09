-- Explicit classification; missing DNI alone never implies nationality.
ALTER TABLE school_drafts ADD COLUMN "isForeign" BOOLEAN NOT NULL DEFAULT false;
