import unicodedata
from apps.foundation import money as exact
from rest_framework.exceptions import ValidationError
from apps.messaging.contracts import safe_text

COUNTRIES = set(
    "AF AL DZ AS AD AO AI AQ AG AR AM AW AU AT AZ BS BH BD BB BY BE BZ BJ BM BT BO BQ BA BW BV BR IO BN BG BF BI CV KH CM CA KY CF TD CL CN CX CC CO KM CG CD CK CR CI HR CU CW CY CZ DK DJ DM DO EC EG SV GQ ER EE SZ ET FK FO FJ FI FR GF PF TF GA GM GE DE GH GI GR GL GD GP GU GT GG GN GW GY HT HM VA HN HK HU IS IN ID IR IQ IE IM IL IT JM JP JE JO KZ KE KI KP KR KW KG LA LV LB LS LR LY LI LT LU MO MG MW MY MV ML MT MH MQ MR MU YT MX FM MD MC MN ME MS MA MZ MM NA NR NP NL NC NZ NI NE NG NU NF MK MP NO OM PK PW PS PA PG PY PE PH PN PL PT PR QA RE RO RU RW BL SH KN LC MF PM VC WS SM ST SA SN RS SC SL SG SX SK SI SB SO ZA GS SS ES LK SD SR SJ SE CH SY TW TJ TZ TH TL TG TK TO TT TN TR TM TC TV UG UA AE GB US UM UY UZ VU VE VN VG VI WF EH YE ZM ZW AX".split()
)


def city(value):
    if not isinstance(value, str):
        raise ValidationError({"city": ["invalid"]})
    safe_text(value)
    value = " ".join(unicodedata.normalize("NFKC", value).split()).casefold()
    if not 1 <= len(value) <= 100 or any(c in value for c in "*<>\\/"):
        raise ValidationError({"city": ["invalid"]})
    return value


def destinations(rows):
    if not isinstance(rows, list) or not 1 <= len(rows) <= 20:
        raise ValidationError({"destinations": ["bounds"]})
    seen = set()
    out = []
    for row in rows:
        if (
            not isinstance(row, dict)
            or set(row) != {"country", "all_cities", "cities"}
            or row["country"] not in COUNTRIES
            or type(row["all_cities"]) is not bool
            or not isinstance(row["cities"], list)
        ):
            raise ValidationError({"destinations": ["invalid"]})
        if row["country"] in seen:
            raise ValidationError({"destinations": ["duplicate"]})
        seen.add(row["country"])
        cities = [city(x) for x in row["cities"]]
        if (
            len(set(cities)) != len(cities)
            or len(cities) > 20
            or row["all_cities"]
            and cities
            or not row["all_cities"]
            and not cities
        ):
            raise ValidationError({"cities": ["bounds"]})
        out.append({"country": row["country"], "all_cities": row["all_cities"], "cities": cities})
    return out


def money(price, quantity):
    try:
        return exact.line_amount(price, quantity)
    except exact.MoneyError as error:
        if error.kind == "tier":
            raise ValidationError({"price": ["tier_unavailable"]}) from None
        raise ValidationError({"amount": ["bounds"]}) from None
