import type { Locale } from "../../lib/i18n/locales";
import type { CategoryId, DemoProduct } from "./data";

type StorefrontCopy = {
	categories: string;
	search: string;
	placeholder: string;
	allCategories: string;
	popular: string;
	viewAll: string;
	preview: string;
	demo: string;
	sample: string;
	demoNotice: string;
	noResults: string;
	close: string;
	recommended: string;
	notifications: string;
	wishlist: string;
	cart: string;
	preferences: string;
	soon: string;
	collections: string;
	newsletter: string;
	newsletterBody: string;
	email: string;
	subscribe: string;
	newsletterNote: string;
	company: string;
	support: string;
	account: string;
	contact: string;
	rights: string;
	legal: string;
	footerBody: string;
	benefits: readonly [string, string][];
	categoryNames: Record<CategoryId, string>;
	products: Record<
		DemoProduct,
		{ title: string; description: string; alt: string }
	>;
};
export const storefrontCopy: Record<Locale, StorefrontCopy> = {
	en: {
		categories: "Categories",
		search: "Search demo products and categories",
		placeholder: "Search for products, categories…",
		allCategories: "All categories",
		popular: "Explore popular categories",
		viewAll: "See all categories",
		preview: "Take a closer look",
		demo: "Design preview",
		sample: "Sample product",
		demoNotice:
			"Demo categories and products. Public shopping is not available yet.",
		noResults: "No demo categories match your search.",
		close: "Close preview",
		recommended: "Featured inspiration",
		notifications: "Notifications",
		wishlist: "Wishlist",
		cart: "Shopping cart",
		preferences: "Language and appearance",
		soon: "Coming soon",
		collections: "The Rezayi collection",
		newsletter: "A little inspiration. A world of possibilities.",
		newsletterBody:
			"Fresh ideas, everyday essentials and a closer look at what’s next from Rezayi.",
		email: "Your email address",
		subscribe: "Subscribe",
		newsletterNote:
			"Newsletter updates are coming soon. No email addresses are collected here.",
		company: "Discover Rezayi",
		support: "Help & support",
		account: "Your account",
		contact: "Contact us",
		rights: "All rights reserved.",
		legal: "Legal information",
		footerBody:
			"Products, people and everyday inspiration. A marketplace connecting buyers and sellers.",
		benefits: [
			["Explore your way", "Discover our sample collections"],
			["Clear buying steps", "Understand how the marketplace works"],
			["Here to guide you", "Visit our help centre"],
			["For every business", "Learn about retail and wholesale"],
		],
		categoryNames: {
			"dried-fruit": "Dried Fruit & Nuts",
			clothing: "Clothing & Dresses",
			beauty: "Beauty & Cosmetics",
			furniture: "Furniture",
			home: "Home & Living",
			electronics: "Electronics",
			crafts: "Arts & Crafts",
			accessories: "Accessories",
			sports: "Sports & Outdoors",
			children: "Mother & Kids",
			stationery: "Books & Stationery",
		},
		products: {
			"dried-fruit": {
				title: "Dried fruit, full of inspiration",
				description:
					"A sample arrangement of pistachios, golden raisins, almonds and dried apricots. Illustrative design content; not an available offer.",
				alt: "Illustrative bowls of pistachios and golden raisins with almonds and dried apricots",
			},
			clothing: {
				title: "A dress with a story",
				description:
					"A cobalt-blue embroidered dress, presented as a sample of our clothing category. No price, stock or purchase is offered in this preview.",
				alt: "Illustrative cobalt-blue long dress with fine ivory embroidery",
			},
			beauty: {
				title: "Everyday beauty, thoughtfully styled",
				description:
					"A sample collection of unbranded cosmetic packaging. Images are illustrative and do not establish ingredients, benefits or product availability.",
				alt: "Illustrative ivory cosmetic bottles and a cream jar with blue lids",
			},
			furniture: {
				title: "Make room for something beautiful",
				description:
					"A sculptural ivory armchair with a blue cushion, shown as furniture design inspiration. This is a demo, not a live product listing.",
				alt: "Illustrative ivory lounge chair with walnut legs and a blue cushion",
			},
		},
	},
	"fa-AF": {
		categories: "دسته‌بندی‌ها",
		search: "جستجوی محصولات و دسته‌بندی‌های نمونه",
		placeholder: "جستجوی محصول، دسته‌بندی…",
		allCategories: "همهٔ دسته‌بندی‌ها",
		popular: "دسته‌بندی‌های محبوب را ببینید",
		viewAll: "دیدن همهٔ دسته‌ها",
		preview: "بیشتر ببینید",
		demo: "پیش‌نمایش طرح",
		sample: "محصول نمونه",
		demoNotice: "دسته‌بندی‌ها و محصولات نمونه‌اند. خرید عمومی هنوز فعال نیست.",
		noResults: "دسته‌بندی نمونه‌ای مطابق جستجوی شما پیدا نشد.",
		close: "بستن پیش‌نمایش",
		recommended: "پیشنهادهای ویژه",
		notifications: "اعلان‌ها",
		wishlist: "پسندیده‌ها",
		cart: "سبد خرید",
		preferences: "زبان و ظاهر",
		soon: "به‌زودی",
		collections: "مجموعهٔ رضایی",
		newsletter: "اندکی الهام، دنیایی از انتخاب‌ها",
		newsletterBody:
			"ایده‌های تازه، نیازهای روزمره و نگاهی نزدیک‌تر به مجموعه‌های آیندهٔ رضایی.",
		email: "آدرس ایمیل شما",
		subscribe: "عضویت",
		newsletterNote:
			"خبرنامه به‌زودی فعال می‌شود. در این بخش هیچ ایمیلی جمع‌آوری نمی‌شود.",
		company: "آشنایی با رضایی",
		support: "رهنما و پشتیبانی",
		account: "حساب شما",
		contact: "تماس با ما",
		rights: "تمام حقوق محفوظ است.",
		legal: "اطلاعات حقوقی",
		footerBody:
			"محصولات، مردم و الهام برای زندگی روزمره؛ بازاری برای پیوند خریداران و فروشندگان.",
		benefits: [
			["به شیوهٔ خود کشف کنید", "مجموعه‌های نمونه را ببینید"],
			["مراحل روشن خرید", "با شیوهٔ کار بازار آشنا شوید"],
			["رهنمایی در کنار شما", "از مرکز رهنما دیدن کنید"],
			["برای هر کسب‌وکار", "با خرید پرچون و عمده آشنا شوید"],
		],
		categoryNames: {
			"dried-fruit": "میوهٔ خشک و مغزیات",
			clothing: "پوشاک و لباس",
			beauty: "زیبایی و لوازم آرایش",
			furniture: "مبلمان",
			home: "خانه و زندگی",
			electronics: "لوازم برقی",
			crafts: "هنر و صنایع دستی",
			accessories: "لوازم جانبی",
			sports: "ورزش و تفریح",
			children: "مادر و کودک",
			stationery: "کتاب و قرطاسیه",
		},
		products: {
			"dried-fruit": {
				title: "میوهٔ خشک، طعم الهام‌بخش",
				description:
					"چیدمان نمونهٔ پسته، کشمش طلایی، بادام و زردآلوی خشک؛ محتوای تصویری طرح است و پیشنهاد فروش واقعی نیست.",
				alt: "تصویر نمونهٔ کاسه‌های پسته و کشمش طلایی همراه با بادام و زردآلوی خشک",
			},
			clothing: {
				title: "لباسی با نقش و داستان",
				description:
					"لباس آبی گلدوزی‌شده به‌عنوان نمونهٔ دسته‌بندی پوشاک نمایش داده شده است. در این پیش‌نمایش قیمت، موجودی یا خرید عرضه نمی‌شود.",
				alt: "تصویر نمونهٔ لباس بلند آبی با گلدوزی ظریف کرم",
			},
			beauty: {
				title: "زیبایی روزمره، با نگاهی تازه",
				description:
					"نمونه‌ای از بسته‌بندی لوازم آرایش بدون نشان تجاری؛ تصویر، ترکیبات، خواص یا موجودی واقعی محصول را تأیید نمی‌کند.",
				alt: "تصویر نمونهٔ بوتل‌ها و ظرف کرم به رنگ سفید با درپوش‌های آبی",
			},
			furniture: {
				title: "جایی برای زیبایی در خانه",
				description:
					"چوکی راحتی کرم با بالشت آبی، برای الهام در طراحی مبلمان. این نمونه است و فهرست فروش واقعی نیست.",
				alt: "تصویر نمونهٔ چوکی راحتی کرم با پایه‌های چوبی و بالشت آبی",
			},
		},
	},
	ps: {
		categories: "کټګورۍ",
		search: "د بېلګه‌ییزو توکو او کټګوریو لټون",
		placeholder: "توکي او کټګورۍ ولټوئ…",
		allCategories: "ټولې کټګورۍ",
		popular: "مشهورې کټګورۍ وپلټئ",
		viewAll: "ټولې کټګورۍ وګورئ",
		preview: "نور یې وګورئ",
		demo: "د ډیزاین مخکتنه",
		sample: "بېلګه‌ییز توکی",
		demoNotice: "کټګورۍ او توکي بېلګه‌ییز دي. عامه پېرودنه لا فعاله نه ده.",
		noResults: "ستاسو له لټون سره برابره بېلګه‌ییزه کټګوري ونه موندل شوه.",
		close: "مخکتنه بنده کړئ",
		recommended: "ځانګړي وړاندیزونه",
		notifications: "خبرتیاوې",
		wishlist: "خوښ شوي توکي",
		cart: "د پېرلو ټوکرۍ",
		preferences: "ژبه او بڼه",
		soon: "ډېر ژر",
		collections: "د رضايي ټولګه",
		newsletter: "لږ الهام، د انتخابونو یوه نړۍ",
		newsletterBody:
			"تازه نظرونه، ورځنۍ اړتیاوې او د رضايي راتلونکو ټولګو ته نږدې کتنه.",
		email: "ستاسو برېښنالیک",
		subscribe: "ګډون",
		newsletterNote:
			"خبرپاڼه به ډېر ژر فعاله شي. دلته برېښنالیکونه نه راټولېږي.",
		company: "رضايي وپېژنئ",
		support: "لارښود او ملاتړ",
		account: "ستاسو حساب",
		contact: "له موږ سره اړیکه",
		rights: "ټول حقونه خوندي دي.",
		legal: "حقوقي معلومات",
		footerBody:
			"توکي، خلک او د ورځني ژوند الهام؛ د پېرودونکو او پلورونکو د نښلولو بازار.",
		benefits: [
			["په خپله خوښه وپلټئ", "زموږ بېلګه‌ییزې ټولګې وګورئ"],
			["د پېرلو روښانه ګامونه", "د بازار د کار له بهیر سره اشنا شئ"],
			["ستاسو تر څنګ لارښود", "زموږ د مرستې مرکز ته ورشئ"],
			["د هرې سوداګرۍ لپاره", "د پرچون او عمده پېرلو په اړه پوه شئ"],
		],
		categoryNames: {
			"dried-fruit": "وچه مېوه او مغز لرونکي توکي",
			clothing: "جامې او کالي",
			beauty: "ښکلا او سینګار",
			furniture: "فرنیچر",
			home: "کور او ژوند",
			electronics: "برېښنايي توکي",
			crafts: "هنر او لاسي صنایع",
			accessories: "مل توکي",
			sports: "سپورت او تفریح",
			children: "مور او ماشوم",
			stationery: "کتابونه او قرطاسیه",
		},
		products: {
			"dried-fruit": {
				title: "وچه مېوه، د الهام خوند",
				description:
					"د پستې، زېړو ممیزو، بادامو او وچو زردالو بېلګه‌ییز انځور. دا یوازې د ډیزاین لپاره دی، د پلور حقیقي وړاندیز نه دی.",
				alt: "د پستې او زېړو ممیزو کاسې له بادامو او وچو زردالو سره؛ بېلګه‌ییز انځور",
			},
			clothing: {
				title: "د کیسې او نقشونو جامې",
				description:
					"آبي ګنډل شوې جامې د کالیو د کټګورۍ د بېلګې په توګه ښودل کېږي. دلته بیه، موجودي یا پېرودنه نه وړاندې کېږي.",
				alt: "د کریمي ګلدوزۍ لرونکو اوږدو آبي جامو بېلګه‌ییز انځور",
			},
			beauty: {
				title: "ورځنۍ ښکلا، تازه لید",
				description:
					"د بې‌نښانه سینګار توکو د بسته‌بندۍ بېلګه. انځور د توکو ترکیب، ګټې یا حقیقي موجودي نه تاییدوي.",
				alt: "د آبي سرپوښونو لرونکو سپینو بوتلونو او د کریم د لوښي بېلګه‌ییز انځور",
			},
			furniture: {
				title: "په کور کې ښکلا ته ځای ورکړئ",
				description:
					"کریمي آرامه څوکۍ له آبي بالښت سره، د فرنیچر د ډیزاین د الهام لپاره. دا بېلګه ده، د پلور حقیقي پاڼه نه ده.",
				alt: "د لرګینو پښو او آبي بالښت لرونکې کریمي څوکۍ؛ بېلګه‌ییز انځور",
			},
		},
	},
	ar: {
		categories: "الفئات",
		search: "البحث في المنتجات والفئات التجريبية",
		placeholder: "ابحث عن المنتجات والفئات…",
		allCategories: "جميع الفئات",
		popular: "استكشف الفئات الشائعة",
		viewAll: "عرض جميع الفئات",
		preview: "ألقِ نظرة أقرب",
		demo: "معاينة التصميم",
		sample: "منتج تجريبي",
		demoNotice: "الفئات والمنتجات تجريبية. التسوق العام غير متاح بعد.",
		noResults: "لا توجد فئات تجريبية تطابق بحثك.",
		close: "إغلاق المعاينة",
		recommended: "اختيارات ملهمة",
		notifications: "الإشعارات",
		wishlist: "المفضلة",
		cart: "سلة التسوق",
		preferences: "اللغة والمظهر",
		soon: "قريباً",
		collections: "تشكيلة رضائي",
		newsletter: "قليل من الإلهام، وعالم من الخيارات",
		newsletterBody:
			"أفكار جديدة واحتياجات يومية ونظرة أقرب إلى تشكيلات رضائي القادمة.",
		email: "عنوان بريدك الإلكتروني",
		subscribe: "اشتراك",
		newsletterNote:
			"النشرة البريدية متاحة قريباً. لا تُجمع عناوين البريد الإلكتروني هنا.",
		company: "اكتشف رضائي",
		support: "المساعدة والدعم",
		account: "حسابك",
		contact: "اتصل بنا",
		rights: "جميع الحقوق محفوظة.",
		legal: "المعلومات القانونية",
		footerBody:
			"منتجات وأشخاص وإلهام للحياة اليومية؛ سوق يجمع المشترين والبائعين.",
		benefits: [
			["اكتشف بطريقتك", "تعرّف على تشكيلاتنا التجريبية"],
			["خطوات شراء واضحة", "تعرّف على آلية عمل السوق"],
			["نرشدك في كل خطوة", "زر مركز المساعدة"],
			["لكل نشاط تجاري", "تعرّف على التجزئة والجملة"],
		],
		categoryNames: {
			"dried-fruit": "الفواكه المجففة والمكسرات",
			clothing: "الملابس والفساتين",
			beauty: "التجميل ومستحضراته",
			furniture: "الأثاث",
			home: "المنزل والمعيشة",
			electronics: "الإلكترونيات",
			crafts: "الفنون والحرف",
			accessories: "الإكسسوارات",
			sports: "الرياضة والترفيه",
			children: "الأم والطفل",
			stationery: "الكتب والقرطاسية",
		},
		products: {
			"dried-fruit": {
				title: "فواكه مجففة، مذاق يلهمك",
				description:
					"تنسيق تجريبي للفستق والزبيب الذهبي واللوز والمشمش المجفف. صورة توضيحية للتصميم، وليست عرضاً فعلياً للبيع.",
				alt: "صورة توضيحية لأوعية الفستق والزبيب الذهبي مع اللوز والمشمش المجفف",
			},
			clothing: {
				title: "فستان بنقوش تحكي قصة",
				description:
					"فستان أزرق مطرّز، معروض كنموذج لفئة الملابس. لا تُعرض أسعار أو كميات أو إمكانية شراء في هذه المعاينة.",
				alt: "صورة توضيحية لفستان أزرق طويل بتطريز عاجي دقيق",
			},
			beauty: {
				title: "جمال يومي بمنظور جديد",
				description:
					"نموذج لعبوات مستحضرات تجميل بلا علامة تجارية. الصور لا تثبت المكونات أو الفوائد أو توافر المنتج.",
				alt: "صورة توضيحية لعبوات تجميل عاجية ومرطبان كريم بأغطية زرقاء",
			},
			furniture: {
				title: "أفسح مجالاً للجمال في منزلك",
				description:
					"كرسي استرخاء عاجي مع وسادة زرقاء، للإلهام في تصميم الأثاث. هذا نموذج تجريبي وليس إعلان منتج فعلياً.",
				alt: "صورة توضيحية لكرسي عاجي بأرجل خشبية ووسادة زرقاء",
			},
		},
	},
};
