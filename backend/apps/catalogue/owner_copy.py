"""Owner workflow labels; product descriptions remain database content."""

from django import forms
from unfold.widgets import (
    UnfoldAdminSelectWidget,
    UnfoldAdminTextareaWidget,
    UnfoldAdminIntegerFieldWidget,
    UnfoldAdminTextInputWidget,
)

FIELDS = {
    "en": dict(
        title="Catalogue review",
        target="Target language",
        load="Load selected translation",
        load_help="Loading replaces unsaved inputs. Save your draft first, or deliberately load another source/target.",
        version="Version",
        revision="Exact source revision",
        action="Action",
        reason="Decision reason",
        locale="Target language",
        description="Translated description",
        image_alts="Translated image descriptions",
        payload="Validated taxonomy fields",
        save="Save draft",
        publish="Approve and publish",
        reject="Reject",
        unpublish="Unpublish",
        approve="Approve translation",
        generate="Request automatic draft",
        retry="Retry job",
        conflict="This record changed or differs from the saved draft. Your input is retained. Load the selected translation again and review it before resubmitting.",
        error="Review required fields, current version and permissions.",
        unit="Sale unit",
        translation="Translation",
        source="Source review",
    ),
    "fa-AF": dict(
        title="بررسی محصول",
        target="زبان ترجمه",
        load="بارگذاری ترجمهٔ انتخاب‌شده",
        load_help="بارگذاری، تغییرات ذخیره‌نشده را جایگزین می‌کند. نخست پیش‌نویس را ذخیره کنید یا آگاهانه نسخه و زبان دیگری را بارگذاری کنید.",
        version="نسخه",
        revision="نسخهٔ دقیق متن اصلی",
        action="اقدام",
        reason="دلیل تصمیم",
        locale="زبان ترجمه",
        description="توضیحات ترجمه‌شده",
        image_alts="توضیحات تصاویر",
        payload="خانه‌های معتبر دسته‌بندی",
        save="ذخیرهٔ پیش‌نویس",
        publish="تأیید و نشر",
        reject="رد",
        unpublish="توقف نشر",
        approve="تأیید ترجمه",
        generate="درخواست پیش‌نویس خودکار",
        retry="تلاش دوباره",
        conflict="این نسخه تغییر کرده یا با پیش‌نویس ذخیره‌شده فرق دارد. نوشته‌های شما حفظ شده است. ترجمهٔ انتخاب‌شده را دوباره بارگذاری و پیش از فرستادن بررسی کنید.",
        error="خانه‌های ضروری، نسخهٔ فعلی و صلاحیت را بررسی کنید.",
        unit="واحد فروش",
        translation="ترجمه",
        source="بررسی متن اصلی",
    ),
    "ps": dict(
        title="د محصول بیاکتنه",
        target="د ژباړې ژبه",
        load="ټاکل شوې ژباړه راواخلئ",
        load_help="رااخیستل ناخوندي بدلونونه بدلوي. لومړی مسوده خوندي کړئ یا په خپله بل اصلي متن او ژبه راواخلئ.",
        version="نسخه",
        revision="د اصلي متن دقیقه نسخه",
        action="اقدام",
        reason="د پرېکړې دلیل",
        locale="د ژباړې ژبه",
        description="ژباړل شوې تشریح",
        image_alts="د انځورونو تشریح",
        payload="د کټګورۍ معتبرې خانې",
        save="مسوده خوندي کول",
        publish="تایید او خپرول",
        reject="ردول",
        unpublish="خپرول بندول",
        approve="ژباړه تاییدول",
        generate="د اتومات مسودې غوښتنه",
        retry="بیا هڅه",
        conflict="دا نسخه بدله شوې یا له خوندي شوې مسودې سره توپیر لري. ستاسو لیکنې ساتل شوې دي. ټاکل شوې ژباړه بیا راواخلئ او تر لېږلو مخکې یې وګورئ.",
        error="اړینې خانې، اوسنۍ نسخه او صلاحیت وګورئ.",
        unit="د پلور واحد",
        translation="ژباړه",
        source="د اصلي متن بیاکتنه",
    ),
    "ar": dict(
        title="مراجعة المنتج",
        target="لغة الترجمة",
        load="تحميل الترجمة المحددة",
        load_help="التحميل يستبدل التعديلات غير المحفوظة. احفظ المسودة أولاً أو حمّل مصدراً ولغة أخرى عمداً.",
        version="النسخة",
        revision="نسخة المصدر المحددة",
        action="الإجراء",
        reason="سبب القرار",
        locale="لغة الترجمة",
        description="الوصف المترجم",
        image_alts="أوصاف الصور المترجمة",
        payload="حقول الفئة المعتمدة",
        save="حفظ المسودة",
        publish="اعتماد ونشر",
        reject="رفض",
        unpublish="إيقاف النشر",
        approve="اعتماد الترجمة",
        generate="طلب مسودة آلية",
        retry="إعادة المحاولة",
        conflict="تغيّر هذا السجل أو يختلف عن المسودة المحفوظة. تم الاحتفاظ بإدخالك. حمّل الترجمة المحددة مجدداً وراجعها قبل إعادة الإرسال.",
        error="راجع الحقول المطلوبة والنسخة الحالية والصلاحيات.",
        unit="وحدة البيع",
        translation="الترجمة",
        source="مراجعة المصدر",
    ),
}


def localize(form, locale):
    copy = FIELDS[locale]
    for name, field in form.fields.items():
        if not field.widget.is_hidden:
            attrs = {**field.widget.attrs}
            if isinstance(field, (forms.ModelChoiceField, forms.ChoiceField)):
                field.widget = UnfoldAdminSelectWidget(attrs=attrs, choices=field.choices)
            elif isinstance(field.widget, forms.Textarea):
                field.widget = UnfoldAdminTextareaWidget(attrs={**attrs, "rows": 5})
            elif isinstance(field, forms.IntegerField):
                field.widget = UnfoldAdminIntegerFieldWidget(attrs=attrs)
            else:
                field.widget = UnfoldAdminTextInputWidget(attrs=attrs)
        field.label = (
            {"en": "Translated title", "fa-AF": "نام ترجمه‌شده", "ps": "ژباړل شوی نوم", "ar": "الاسم المترجم"}[locale]
            if name == "title"
            else copy.get(name, name)
        )
    if "action" in form.fields:
        form.fields["action"].choices = [(value, copy.get(value, value)) for value, _ in form.fields["action"].choices]
    return copy
