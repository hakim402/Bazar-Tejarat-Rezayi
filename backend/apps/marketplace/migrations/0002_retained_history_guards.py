from django.db import migrations


FORWARD = """
CREATE FUNCTION marketplace_immutable_record() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Store media and audit history are immutable'; END;
$$;
CREATE TRIGGER marketplace_media_immutable BEFORE UPDATE OR DELETE ON marketplace_storemedia
FOR EACH ROW EXECUTE FUNCTION marketplace_immutable_record();
CREATE TRIGGER marketplace_event_immutable BEFORE UPDATE OR DELETE ON marketplace_storeevent
FOR EACH ROW EXECUTE FUNCTION marketplace_immutable_record();
CREATE FUNCTION marketplace_revision_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Store revisions are retained'; END IF;
 IF ROW(OLD.id,OLD.store_id,OLD.number,OLD.business_case_id,OLD.body,OLD.author_id,OLD.created_at)
    IS DISTINCT FROM ROW(NEW.id,NEW.store_id,NEW.number,NEW.business_case_id,NEW.body,NEW.author_id,NEW.created_at)
 THEN RAISE EXCEPTION 'Store revision content is immutable'; END IF;
 IF OLD.state IS DISTINCT FROM NEW.state AND NOT
    (OLD.state = 'draft' AND NEW.state = 'submitted' OR OLD.state = 'submitted' AND NEW.state IN ('approved','rejected','withdrawn') OR OLD.state = 'approved' AND NEW.state = 'withdrawn')
 THEN RAISE EXCEPTION 'Invalid store revision transition'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER marketplace_revision_immutable BEFORE UPDATE OR DELETE ON marketplace_storerevision
FOR EACH ROW EXECUTE FUNCTION marketplace_revision_guard();
CREATE FUNCTION marketplace_publication_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.published_id IS NOT NULL AND NOT EXISTS
 (SELECT 1 FROM marketplace_storerevision r WHERE r.id=NEW.published_id AND r.store_id=NEW.profile_id AND r.state='approved')
 THEN RAISE EXCEPTION 'Publication requires this store approved revision'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER marketplace_publication_scope BEFORE INSERT OR UPDATE ON marketplace_store
FOR EACH ROW EXECUTE FUNCTION marketplace_publication_guard();
"""
REVERSE = """
DROP TRIGGER marketplace_publication_scope ON marketplace_store;
DROP FUNCTION marketplace_publication_guard();
DROP TRIGGER marketplace_revision_immutable ON marketplace_storerevision;
DROP FUNCTION marketplace_revision_guard();
DROP TRIGGER marketplace_event_immutable ON marketplace_storeevent;
DROP TRIGGER marketplace_media_immutable ON marketplace_storemedia;
DROP FUNCTION marketplace_immutable_record();
"""


class Migration(migrations.Migration):
    dependencies = [("marketplace", "0001_initial")]
    operations = [migrations.RunSQL(FORWARD, REVERSE)]
