from django.db import migrations

TEXT = {'fa-AF': ('برای خرید و فروش، آگاهانه آغاز کنید', 'با بازار و نقش\u200cهای خرید و فروش آشنا شوید.', 'روش کار بازار', 'تصویر معرفی بازار با قالین، ظروف و لوازم خانه؛ نمایانگر موجودی کالا نیست.', 'بازار موقتاً در دسترس نیست', 'در حال نگهداری سایت هستیم. لطفاً کمی بعد دوباره مراجعه کنید.'), 'en': ('A clearer start to buying and selling', 'Understand the marketplace and choose your role.', 'How it works', 'Editorial marketplace image with a rug, pottery and home goods; not a stock listing.', 'Temporarily unavailable', 'We are maintaining the site. Please try again shortly.'), 'ps': ('پېر او پلور په پوهه پیل کړئ', 'بازار وپېژنئ او خپل رول وټاکئ.', 'بازار څنګه کار کوي', 'د غالۍ، لوښو او کورنیو توکو انځور؛ د شته توکو لېست نه دی.', 'سایټ لنډمهاله نه دی چمتو', 'د سایټ ساتنه روانه ده. مهرباني وکړئ لږ وروسته بیا هڅه وکړئ.'), 'ar': ('ابدأ الشراء والبيع على بيّنة', 'تعرّف إلى السوق واختر دورك.', 'كيف يعمل السوق', 'صورة تعريفية بالسوق تضم سجادة وفخاراً وأدوات منزلية؛ ليست قائمة مخزون.', 'الموقع غير متاح مؤقتاً', 'نجري صيانة للموقع. يرجى المحاولة مجدداً بعد قليل.')}
BRANDS = {'fa-AF': 'بازار رضایی', 'en': 'Bazar Rezayi', 'ps': 'رضايي بازار', 'ar': 'سوق رضائي'}


def initialize(apps, schema_editor):
    Settings = apps.get_model("site", "SiteSettings")
    site, created = Settings.objects.using(schema_editor.connection.alias).get_or_create(pk=1)
    if not created:
        return
    Slide = apps.get_model("site", "HeroSlide")
    slide = Slide.objects.using(schema_editor.connection.alias).create(settings=site, label="Approved marketplace introduction", enabled=True, bundled_image=True)
    for locale, values in TEXT.items():
        title, description, label, alt, maintenance_title, maintenance_message = values
        apps.get_model("site", "SiteLocale").objects.using(schema_editor.connection.alias).create(settings=site, locale=locale, name=BRANDS[locale], description=description, maintenance_title=maintenance_title, maintenance_message=maintenance_message)
        apps.get_model("site", "HeroLocale").objects.using(schema_editor.connection.alias).create(slide=slide, locale=locale, title=title, description=description, alt=alt, cta_label=label, cta_url="/how-it-works")


class Migration(migrations.Migration):
    dependencies = [("site", "0001_initial")]
    operations = [migrations.RunPython(initialize, migrations.RunPython.noop)]
