-- New shared-project deployments put live objects in private, separate buckets.
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES ('inkshot-live-brand-uploads','inkshot-live-brand-uploads',false,10485760,ARRAY['image/jpeg','image/png','image/webp']),
       ('inkshot-live-generated-media','inkshot-live-generated-media',false,104857600,ARRAY['image/jpeg','image/png','video/mp4'])
ON CONFLICT(id) DO NOTHING;

DO $$
BEGIN
  IF EXISTS (SELECT FROM storage.buckets WHERE id IN ('inkshot-live-brand-uploads','inkshot-live-generated-media') AND public)
  THEN RAISE EXCEPTION 'Live media buckets must be private'; END IF;
END $$;
