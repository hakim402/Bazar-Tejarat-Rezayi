from django.db import migrations

FORWARD = r"""
CREATE FUNCTION messaging_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Communication history is immutable'; END; $$;
CREATE TRIGGER messaging_message_retained BEFORE UPDATE OR DELETE ON messaging_message FOR EACH ROW EXECUTE FUNCTION messaging_append_only();
CREATE TRIGGER messaging_command_retained BEFORE UPDATE OR DELETE ON messaging_command FOR EACH ROW EXECUTE FUNCTION messaging_append_only();
CREATE TRIGGER messaging_caseevent_retained BEFORE UPDATE OR DELETE ON messaging_caseevent FOR EACH ROW EXECUTE FUNCTION messaging_append_only();
CREATE TRIGGER messaging_caseaccess_retained BEFORE UPDATE OR DELETE ON messaging_caseaccess FOR EACH ROW EXECUTE FUNCTION messaging_append_only();
CREATE FUNCTION messaging_conversation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Conversation history is retained'; END IF;
 IF TG_OP='INSERT' THEN
  IF NOT EXISTS(SELECT 1 FROM accounts_account a WHERE a.id=NEW.buyer_id AND a.context='buyer') OR NOT EXISTS(SELECT 1 FROM catalogue_product p WHERE p.id=NEW.product_id AND p.seller_id=NEW.seller_id) THEN RAISE EXCEPTION 'Invalid conversation identity'; END IF;
 ELSE
  IF ROW(OLD.id,OLD.buyer_id,OLD.seller_id,OLD.product_id,OLD.snapshot,OLD.created_at) IS DISTINCT FROM ROW(NEW.id,NEW.buyer_id,NEW.seller_id,NEW.product_id,NEW.snapshot,NEW.created_at) OR NEW.sequence<>OLD.sequence+1 THEN RAISE EXCEPTION 'Invalid conversation history change'; END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER messaging_conversation_retained BEFORE INSERT OR UPDATE OR DELETE ON messaging_conversation FOR EACH ROW EXECUTE FUNCTION messaging_conversation_guard();
CREATE FUNCTION messaging_message_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF char_length(NEW.body)>6000 OR NOT EXISTS(SELECT 1 FROM accounts_account a WHERE a.id=NEW.author_id AND a.context=NEW.context) OR NOT EXISTS(SELECT 1 FROM messaging_conversation c WHERE c.id=NEW.conversation_id AND c.sequence=NEW.sequence AND (NEW.context='seller' OR c.buyer_id=NEW.author_id)) THEN RAISE EXCEPTION 'Invalid message scope'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER messaging_message_scope BEFORE INSERT ON messaging_message FOR EACH ROW EXECUTE FUNCTION messaging_message_scope();
CREATE FUNCTION messaging_attachment_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  IF OLD.message_id IS NOT NULL OR OLD.expires_at IS NULL OR OLD.expires_at>statement_timestamp() THEN RAISE EXCEPTION 'Referenced or unexpired images are retained'; END IF;
  RETURN OLD;
 END IF;
 IF TG_OP='UPDATE' AND (OLD.message_id IS NOT NULL OR ROW(OLD.id,OLD.product_id,OLD.creator_id,OLD.storage_alias,OLD.key,OLD.content_type,OLD.size,OLD.sha256,OLD.width,OLD.height,OLD.created_at) IS DISTINCT FROM ROW(NEW.id,NEW.product_id,NEW.creator_id,NEW.storage_alias,NEW.key,NEW.content_type,NEW.size,NEW.sha256,NEW.width,NEW.height,NEW.created_at) OR NEW.message_id IS NULL OR OLD.conversation_id IS NOT NULL AND OLD.conversation_id<>NEW.conversation_id OR NEW.expires_at IS NOT NULL) THEN RAISE EXCEPTION 'Image content and binding are immutable'; END IF;
 IF NEW.storage_alias<>'private_local' OR NEW.key NOT LIKE 'messages/%' OR NEW.key LIKE '%..%' THEN RAISE EXCEPTION 'Private generated image location required'; END IF;
 IF NEW.message_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM messaging_message m JOIN messaging_conversation c ON c.id=m.conversation_id WHERE m.id=NEW.message_id AND c.id=NEW.conversation_id AND c.product_id=NEW.product_id AND m.author_id=NEW.creator_id) THEN RAISE EXCEPTION 'Invalid image binding'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER messaging_attachment_retained BEFORE INSERT OR UPDATE OR DELETE ON messaging_attachment FOR EACH ROW EXECUTE FUNCTION messaging_attachment_guard();
CREATE FUNCTION messaging_report_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Participant reports are retained'; END IF;
 IF ROW(OLD.id,OLD.message_id,OLD.reporter_id,OLD.category,OLD.reason,OLD.created_at) IS DISTINCT FROM ROW(NEW.id,NEW.message_id,NEW.reporter_id,NEW.category,NEW.reason,NEW.created_at) OR NEW.version<>OLD.version+1 OR NEW.status NOT IN ('open','resolved') THEN RAISE EXCEPTION 'Invalid report history change'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER messaging_report_retained BEFORE UPDATE OR DELETE ON messaging_report FOR EACH ROW EXECUTE FUNCTION messaging_report_guard();

CREATE FUNCTION messaging_nonempty_message() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS (SELECT 1 FROM messaging_message m WHERE m.id=NEW.id AND btrim(m.body)='' AND NOT EXISTS (SELECT 1 FROM messaging_attachment a WHERE a.message_id=m.id)) THEN RAISE EXCEPTION 'A message requires text or a bound image'; END IF;
 RETURN NEW;
END; $$;
CREATE CONSTRAINT TRIGGER messaging_nonempty_message AFTER INSERT ON messaging_message DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION messaging_nonempty_message();
CREATE FUNCTION messaging_read_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(OLD.id,OLD.conversation_id,OLD.account_id) IS DISTINCT FROM ROW(NEW.id,NEW.conversation_id,NEW.account_id) OR NEW.last_read<OLD.last_read OR NEW.latest_incoming<OLD.latest_incoming OR NEW.episode<OLD.episode OR NEW.episode>OLD.episode+1 THEN RAISE EXCEPTION 'Invalid personal read state'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER messaging_read_monotonic BEFORE UPDATE ON messaging_readstate FOR EACH ROW EXECUTE FUNCTION messaging_read_guard();
"""
REVERSE = """
DROP TRIGGER messaging_nonempty_message ON messaging_message; DROP FUNCTION messaging_nonempty_message();
DROP TRIGGER messaging_read_monotonic ON messaging_readstate; DROP FUNCTION messaging_read_guard();
DROP TRIGGER messaging_report_retained ON messaging_report; DROP FUNCTION messaging_report_guard();
DROP TRIGGER messaging_attachment_retained ON messaging_attachment; DROP FUNCTION messaging_attachment_guard();
DROP TRIGGER messaging_message_scope ON messaging_message; DROP FUNCTION messaging_message_scope();
DROP TRIGGER messaging_conversation_retained ON messaging_conversation; DROP FUNCTION messaging_conversation_guard();
DROP TRIGGER messaging_caseaccess_retained ON messaging_caseaccess;
DROP TRIGGER messaging_caseevent_retained ON messaging_caseevent;
DROP TRIGGER messaging_command_retained ON messaging_command;
DROP TRIGGER messaging_message_retained ON messaging_message; DROP FUNCTION messaging_append_only();
"""


class Migration(migrations.Migration):
    dependencies = [("messaging", "0001_initial")]
    operations = [migrations.RunSQL(FORWARD, REVERSE)]
