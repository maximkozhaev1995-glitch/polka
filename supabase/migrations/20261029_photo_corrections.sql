-- Mixora: human-approved photo OCR corrections (no stock or orders touched).
CREATE TABLE IF NOT EXISTS public.photo_corrections (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  venue_id uuid NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  raw_label text NOT NULL CHECK (char_length(raw_label) BETWEEN 3 AND 180),
  flavor_id text NOT NULL REFERENCES public.flavors(id) ON DELETE RESTRICT,
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT photo_corrections_venue_label_unique UNIQUE (venue_id, raw_label)
);
CREATE INDEX IF NOT EXISTS photo_corrections_venue_idx ON public.photo_corrections(venue_id);
ALTER TABLE public.photo_corrections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.photo_corrections FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON public.photo_corrections TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.photo_corrections_id_seq TO authenticated;
CREATE POLICY photo_corrections_staff_read ON public.photo_corrections
  FOR SELECT TO authenticated
  USING (public.is_staff() AND venue_id = (SELECT public.me_venue()));
CREATE POLICY photo_corrections_staff_insert ON public.photo_corrections
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_staff() AND venue_id = (SELECT public.me_venue())
    AND EXISTS(SELECT 1 FROM public.flavors f WHERE f.id = flavor_id
      AND (f.venue_id IS NULL OR f.venue_id = (SELECT public.me_venue())))
  );
CREATE POLICY photo_corrections_staff_update ON public.photo_corrections
  FOR UPDATE TO authenticated
  USING (public.is_staff() AND venue_id = (SELECT public.me_venue()))
  WITH CHECK (
    public.is_staff() AND venue_id = (SELECT public.me_venue())
    AND EXISTS(SELECT 1 FROM public.flavors f WHERE f.id = flavor_id
      AND (f.venue_id IS NULL OR f.venue_id = (SELECT public.me_venue())))
  );
