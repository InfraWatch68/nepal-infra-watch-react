CREATE OR REPLACE FUNCTION nepal_fy_from_date(d date) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN d IS NULL THEN NULL
    WHEN EXTRACT(month FROM d)::int > 7
      OR (EXTRACT(month FROM d)::int = 7 AND EXTRACT(day FROM d)::int >= 16)
    THEN
      /* on/after Shrawan 1: BS year = AD year + 57 */
      (EXTRACT(year FROM d)::int + 57)::text
      || '/'
      || lpad(((EXTRACT(year FROM d)::int + 58) % 100)::text, 2, '0')
    ELSE
      /* before Shrawan 1: BS year = AD year + 56 */
      (EXTRACT(year FROM d)::int + 56)::text
      || '/'
      || lpad(((EXTRACT(year FROM d)::int + 57) % 100)::text, 2, '0')
  END
$$;

UPDATE projects
SET fiscal_year = nepal_fy_from_date(start_date)
WHERE fiscal_year IS NULL
  AND start_date IS NOT NULL;

CREATE OR REPLACE FUNCTION set_fiscal_year_from_start_date() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.fiscal_year IS NULL THEN
    NEW.fiscal_year := nepal_fy_from_date(NEW.start_date);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_fiscal_year ON projects;

CREATE TRIGGER trg_set_fiscal_year
BEFORE INSERT OR UPDATE OF start_date ON projects
FOR EACH ROW
EXECUTE FUNCTION set_fiscal_year_from_start_date();
