-- Preserve existing approved 15-second jobs. New jobs set their approved duration explicitly.
ALTER TABLE public.versions ADD COLUMN IF NOT EXISTS video_duration_seconds integer NOT NULL DEFAULT 15 CHECK(video_duration_seconds BETWEEN 3 AND 15);
ALTER TABLE public.versions ADD COLUMN IF NOT EXISTS first_frame_source text CHECK(first_frame_source IN ('merchant_photo','generated','sample'));
DO $$ BEGIN
  IF to_regclass('inkshot_live.versions') IS NOT NULL THEN
    ALTER TABLE inkshot_live.versions ADD COLUMN IF NOT EXISTS video_duration_seconds integer NOT NULL DEFAULT 15 CHECK(video_duration_seconds BETWEEN 3 AND 15);
    ALTER TABLE inkshot_live.versions ADD COLUMN IF NOT EXISTS first_frame_source text CHECK(first_frame_source IN ('merchant_photo','generated','sample'));
  END IF;
END $$;
