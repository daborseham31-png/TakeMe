// ---------------------------------------------------------------------------
// Shared Israeli locality dataset — the ONE place every city/town/village
// name list in the app comes from. Do not create a second copy of this list
// anywhere else; import from here.
//
// This is a curated, bundled-with-the-app list (no API key, no network
// request, works fully offline) covering the country's major cities, Arab
// towns and villages, Druze and Bedouin localities, and well-known
// kibbutzim/moshavim/local councils across every district. It is large and
// broad, but it is NOT the full official ~1,300-entry CBS locality
// registry — if a very small village is missing, extend this file (same
// shape) rather than adding a one-off list somewhere else.
// ---------------------------------------------------------------------------

export type IsraelDistrict =
  | "North"
  | "Haifa"
  | "Center"
  | "Tel Aviv"
  | "Jerusalem"
  | "South"
  | "Judea and Samaria";

export type IsraelLocation = {
  id: string;
  english: string;
  arabic: string;
  hebrew: string;
  district?: IsraelDistrict;
  latitude?: number;
  longitude?: number;
};

export const ISRAEL_LOCATIONS: IsraelLocation[] = [
  // --- North district ------------------------------------------------------
  { id: "nazareth", english: "Nazareth", arabic: "الناصرة", hebrew: "נצרת", district: "North", latitude: 32.7021, longitude: 35.2978 },
  { id: "nazareth-illit", english: "Nazareth Illit / Nof HaGalil", arabic: "الناصرة العليا", hebrew: "נוף הגליל", district: "North", latitude: 32.7167, longitude: 35.32 },
  { id: "tiberias", english: "Tiberias", arabic: "طبريا", hebrew: "טבריה", district: "North", latitude: 32.7922, longitude: 35.5312 },
  { id: "safed", english: "Safed", arabic: "صفد", hebrew: "צפת", district: "North", latitude: 32.9646, longitude: 35.4951 },
  { id: "acre", english: "Acre", arabic: "عكا", hebrew: "עכו", district: "North", latitude: 32.9281, longitude: 35.0818 },
  { id: "karmiel", english: "Karmiel", arabic: "كرمئيل", hebrew: "כרמיאל", district: "North", latitude: 32.9171, longitude: 35.2957 },
  { id: "kiryat-shmona", english: "Kiryat Shmona", arabic: "كريات شمونة", hebrew: "קריית שמונה", district: "North", latitude: 33.2075, longitude: 35.5697 },
  { id: "afula", english: "Afula", arabic: "العفولة", hebrew: "עפולה", district: "North", latitude: 32.6076, longitude: 35.2897 },
  { id: "beit-shean", english: "Beit She'an", arabic: "بيسان", hebrew: "בית שאן", district: "North", latitude: 32.4969, longitude: 35.4989 },
  { id: "maalot-tarshiha", english: "Ma'alot-Tarshiha", arabic: "معالوت ترشيحا", hebrew: "מעלות-תרשיחא", district: "North" },
  { id: "shaghur", english: "Shaghur", arabic: "شغور", hebrew: "שעב", district: "North" },
  { id: "shefaram", english: "Shefa-'Amr", arabic: "شفاعمرو", hebrew: "שפרעם", district: "North", latitude: 32.8058, longitude: 35.1697 },
  { id: "sakhnin", english: "Sakhnin", arabic: "سخنين", hebrew: "סח'נין", district: "North", latitude: 32.8656, longitude: 35.3011 },
  { id: "arraba", english: "Arraba", arabic: "عرابة", hebrew: "עראבה", district: "North" },
  { id: "deir-hanna", english: "Deir Hanna", arabic: "دير حنا", hebrew: "דייר חנא", district: "North" },
  { id: "kabul", english: "Kabul", arabic: "كابول", hebrew: "כאבול", district: "North" },
  { id: "tamra", english: "Tamra", arabic: "طمرة", hebrew: "טמרה", district: "North" },
  { id: "kafr-manda", english: "Kafr Manda", arabic: "كفر مندا", hebrew: "כפר מנדא", district: "North" },
  { id: "reineh", english: "Reineh", arabic: "الرينة", hebrew: "ריינה", district: "North" },
  { id: "iksal", english: "Iksal", arabic: "إكسال", hebrew: "איכסאל", district: "North" },
  { id: "kafr-kanna", english: "Kafr Kanna", arabic: "كفر كنا", hebrew: "כפר כנא", district: "North" },
  { id: "mashhad", english: "Mashhad", arabic: "المشهد", hebrew: "משהד", district: "North" },
  { id: "ilut", english: "Ilut", arabic: "علوط", hebrew: "עילוט", district: "North" },
  { id: "yafa-an-naseriyye", english: "Yafa an-Naseriyye", arabic: "يافة الناصرة", hebrew: "יפיע", district: "North" },
  { id: "maghar", english: "Maghar", arabic: "المغار", hebrew: "מע'אר", district: "North" },
  { id: "bueine-nujeidat", english: "Bu'eine-Nujeidat", arabic: "البعنة نجيدات", hebrew: "בועיינה-נוג'ידאת", district: "North" },
  { id: "eilabun", english: "Eilabun", arabic: "عيلبون", hebrew: "אילבון", district: "North" },
  { id: "rameh", english: "Rameh", arabic: "الرامة", hebrew: "ראמה", district: "North" },
  { id: "julis", english: "Julis", arabic: "جولس", hebrew: "ג'וליס", district: "North" },
  { id: "yarka", english: "Yarka", arabic: "يركا", hebrew: "ירכא", district: "North" },
  { id: "abu-snan", english: "Abu Snan", arabic: "أبو سنان", hebrew: "אבו סנאן", district: "North" },
  { id: "kisra-sumei", english: "Kisra-Sumei", arabic: "كسرى سميع", hebrew: "כסרא-סמיע", district: "North" },
  { id: "peki'in", english: "Peki'in", arabic: "البقيعة", hebrew: "פקיעין", district: "North" },
  { id: "hurfeish", english: "Hurfeish", arabic: "حرفيش", hebrew: "חורפיש", district: "North" },
  { id: "fassuta", english: "Fassuta", arabic: "فسوطة", hebrew: "פסוטה", district: "North" },
  { id: "jish", english: "Jish", arabic: "الجش", hebrew: "ג'יש", district: "North" },
  { id: "majd-al-krum", english: "Majd al-Krum", arabic: "مجد الكروم", hebrew: "מג'ד אל-כרום", district: "North" },
  { id: "bi'ina", english: "Bi'ina", arabic: "البعنة", hebrew: "בענה", district: "North" },
  { id: "nahef", english: "Nahef", arabic: "النحف", hebrew: "נחף", district: "North" },
  { id: "deir-al-asad", english: "Deir al-Asad", arabic: "دير الأسد", hebrew: "דייר אל-אסד", district: "North" },
  { id: "kaukab-abu-al-hija", english: "Kaukab Abu al-Hija", arabic: "كوكب أبو الهيجاء", hebrew: "כאוכב אבו אל-היג'א", district: "North" },
  { id: "rosh-pina", english: "Rosh Pinna", arabic: "روش بينا", hebrew: "ראש פינה", district: "North" },
  { id: "hatzor-haglilit", english: "Hatzor HaGlilit", arabic: "حاصور هجليلية", hebrew: "חצור הגלילית", district: "North" },
  { id: "migdal-haemek", english: "Migdal HaEmek", arabic: "مجدال هعيمق", hebrew: "מגדל העמק", district: "North" },
  { id: "yokneam", english: "Yokneam Illit", arabic: "يوكنعام عيليت", hebrew: "יקנעם עילית", district: "North" },
  { id: "kiryat-tivon", english: "Kiryat Tivon", arabic: "كريات طبعون", hebrew: "קריית טבעון", district: "North" },
  { id: "kfar-tavor", english: "Kfar Tavor", arabic: "كفار تבور", hebrew: "כפר תבור", district: "North" },
  { id: "kfar-vradim", english: "Kfar Vradim", arabic: "كفار وردים", hebrew: "כפר ורדים", district: "North" },
  { id: "nahariya", english: "Nahariya", arabic: "نهاريا", hebrew: "נהריה", district: "North", latitude: 33.0079, longitude: 35.0951 },
  { id: "harish", english: "Harish", arabic: "حريش", hebrew: "חריש", district: "North" },
  { id: "mateh-asher", english: "Mateh Asher", arabic: "مطيه أشير", hebrew: "מטה אשר", district: "North" },
  { id: "beit-jann", english: "Beit Jann", arabic: "بيت جن", hebrew: "בית ג'ן", district: "North" },
  { id: "daliyat-al-karmel", english: "Daliyat al-Karmel", arabic: "دالية الكرمل", hebrew: "דלית אל-כרמל", district: "Haifa" },
  { id: "isfiya", english: "Isfiya", arabic: "عسفيا", hebrew: "עספיא", district: "Haifa" },
  { id: "sha'ab", english: "Sha'ab", arabic: "شعب", hebrew: "שעב", district: "North" },
  { id: "basmat-tab'un", english: "Basmat Tab'un", arabic: "بسمة طبعون", hebrew: "בסמת טבעון", district: "North" },
  { id: "zarzir", english: "Zarzir", arabic: "الزرازير", hebrew: "זרזיר", district: "North" },

  // --- Haifa district --------------------------------------------------------
  { id: "haifa", english: "Haifa", arabic: "حيفا", hebrew: "חיפה", district: "Haifa", latitude: 32.794, longitude: 34.9896 },
  { id: "hadera", english: "Hadera", arabic: "الخضيرة", hebrew: "חדרה", district: "Haifa", latitude: 32.4340, longitude: 34.9196 },
  { id: "kiryat-ata", english: "Kiryat Ata", arabic: "كريات آتا", hebrew: "קריית אתא", district: "Haifa" },
  { id: "kiryat-bialik", english: "Kiryat Bialik", arabic: "كريات بياليك", hebrew: "קריית ביאליק", district: "Haifa" },
  { id: "kiryat-motzkin", english: "Kiryat Motzkin", arabic: "كريات موتسكين", hebrew: "קריית מוצקין", district: "Haifa" },
  { id: "kiryat-yam", english: "Kiryat Yam", arabic: "كريات يام", hebrew: "קריית ים", district: "Haifa" },
  { id: "nesher", english: "Nesher", arabic: "نيشر", hebrew: "נשר", district: "Haifa" },
  { id: "tirat-carmel", english: "Tirat Carmel", arabic: "طيرة الكرمل", hebrew: "טירת כרמל", district: "Haifa" },
  { id: "umm-al-fahm", english: "Umm al-Fahm", arabic: "أم الفحم", hebrew: "אום אל-פחם", district: "Haifa", latitude: 32.5164, longitude: 35.1526 },
  { id: "baqa-al-gharbiyye", english: "Baqa al-Gharbiyye", arabic: "باقة الغربية", hebrew: "באקה אל-גרביה", district: "Haifa" },
  { id: "jatt", english: "Jatt", arabic: "جت", hebrew: "ג'ת", district: "Haifa" },
  { id: "ara", english: "Ar'ara", arabic: "عارة", hebrew: "ערערה", district: "Haifa" },
  { id: "kafr-qara", english: "Kafr Qara", arabic: "كفر قرع", hebrew: "כפר קרע", district: "Haifa" },
  { id: "furadis", english: "Furadis", arabic: "الفريديس", hebrew: "פוריידיס", district: "Haifa" },
  { id: "zichron-yaakov", english: "Zichron Ya'akov", arabic: "زخرون يعقوب", hebrew: "זכרון יעקב", district: "Haifa" },
  { id: "or-akiva", english: "Or Akiva", arabic: "أور عكيفا", hebrew: "אור עקיבא", district: "Haifa" },
  { id: "binyamina", english: "Binyamina", arabic: "بنيامينا", hebrew: "בנימינה", district: "Haifa" },

  // --- Center district ---------------------------------------------------------
  { id: "netanya", english: "Netanya", arabic: "نتانيا", hebrew: "נתניה", district: "Center", latitude: 32.3215, longitude: 34.8532 },
  { id: "kfar-saba", english: "Kfar Saba", arabic: "كفار سابا", hebrew: "כפר סבא", district: "Center" },
  { id: "raanana", english: "Ra'anana", arabic: "رعنانا", hebrew: "רעננה", district: "Center" },
  { id: "hod-hasharon", english: "Hod HaSharon", arabic: "هود هشارون", hebrew: "הוד השרון", district: "Center" },
  { id: "herzliya", english: "Herzliya", arabic: "هرتسليا", hebrew: "הרצליה", district: "Center", latitude: 32.1663, longitude: 34.8436 },
  { id: "petah-tikva", english: "Petah Tikva", arabic: "بيتح تكفا", hebrew: "פתח תקווה", district: "Center", latitude: 32.0917, longitude: 34.8850 },
  { id: "rosh-haayin", english: "Rosh HaAyin", arabic: "روش هعاين", hebrew: "ראש העין", district: "Center" },
  { id: "ramat-hasharon", english: "Ramat HaSharon", arabic: "رمات هشارون", hebrew: "רמת השרון", district: "Center" },
  { id: "lod", english: "Lod", arabic: "اللد", hebrew: "לוד", district: "Center", latitude: 31.9516, longitude: 34.8931 },
  { id: "ramla", english: "Ramla", arabic: "الرملة", hebrew: "רמלה", district: "Center", latitude: 31.9277, longitude: 34.8625 },
  { id: "rehovot", english: "Rehovot", arabic: "رحوفوت", hebrew: "רחובות", district: "Center", latitude: 31.8969, longitude: 34.8186 },
  { id: "rishon-lezion", english: "Rishon LeZion", arabic: "ريشون لتسيون", hebrew: "ראשון לציון", district: "Center", latitude: 31.9642, longitude: 34.8047 },
  { id: "modiin", english: "Modi'in-Maccabim-Re'ut", arabic: "موديعين", hebrew: "מודיעין-מכבים-רעות", district: "Center" },
  { id: "yavne", english: "Yavne", arabic: "يبنة", hebrew: "יבנה", district: "Center" },
  { id: "kfar-yona", english: "Kfar Yona", arabic: "كفار يونا", hebrew: "כפר יונה", district: "Center" },
  { id: "tira", english: "Tira", arabic: "الطيرة", hebrew: "טירה", district: "Center" },
  { id: "taibe", english: "Tayibe", arabic: "الطيبة", hebrew: "טייבה", district: "Center" },
  { id: "qalansawe", english: "Qalansawe", arabic: "قلنسوة", hebrew: "קלנסווה", district: "Center" },
  { id: "jaljulia", english: "Jaljulia", arabic: "جلجولية", hebrew: "ג'לג'וליה", district: "Center" },
  { id: "kafr-qasim", english: "Kafr Qasim", arabic: "كفر قاسم", hebrew: "כפר קאסם", district: "Center" },
  { id: "elad", english: "Elad", arabic: "إلعاد", hebrew: "אלעד", district: "Center" },
  { id: "shoham", english: "Shoham", arabic: "شوهام", hebrew: "שוהם", district: "Center" },

  // --- Tel Aviv district ----------------------------------------------------
  { id: "tel-aviv", english: "Tel Aviv-Yafo", arabic: "تل أبيب يافا", hebrew: "תל אביב-יפו", district: "Tel Aviv", latitude: 32.0853, longitude: 34.7818 },
  { id: "bat-yam", english: "Bat Yam", arabic: "بات يام", hebrew: "בת ים", district: "Tel Aviv" },
  { id: "holon", english: "Holon", arabic: "حولون", hebrew: "חולון", district: "Tel Aviv" },
  { id: "givatayim", english: "Givatayim", arabic: "جفعاتايم", hebrew: "גבעתיים", district: "Tel Aviv" },
  { id: "ramat-gan", english: "Ramat Gan", arabic: "رمات جان", hebrew: "רמת גן", district: "Tel Aviv" },
  { id: "bnei-brak", english: "Bnei Brak", arabic: "بني براك", hebrew: "בני ברק", district: "Tel Aviv" },
  { id: "herzliya-pituach", english: "Herzliya Pituach", arabic: "هرتسليا الساحلية", hebrew: "הרצליה פיתוח", district: "Tel Aviv" },

  // --- Jerusalem district ----------------------------------------------------
  { id: "jerusalem", english: "Jerusalem", arabic: "القدس", hebrew: "ירושלים", district: "Jerusalem", latitude: 31.7683, longitude: 35.2137 },
  { id: "beit-shemesh", english: "Beit Shemesh", arabic: "بيت شيمش", hebrew: "בית שמש", district: "Jerusalem" },
  { id: "mevaseret-zion", english: "Mevaseret Zion", arabic: "مفسيرت تسيون", hebrew: "מבשרת ציון", district: "Jerusalem" },
  { id: "abu-ghosh", english: "Abu Ghosh", arabic: "أبو غوش", hebrew: "אבו גוש", district: "Jerusalem" },
  { id: "maale-adumim", english: "Ma'ale Adumim", arabic: "معاليه أدوميم", hebrew: "מעלה אדומים", district: "Judea and Samaria" },
  { id: "ariel", english: "Ariel", arabic: "أريئيل", hebrew: "אריאל", district: "Judea and Samaria" },
  { id: "beitar-illit", english: "Beitar Illit", arabic: "بيتار عيليت", hebrew: "ביתר עילית", district: "Judea and Samaria" },
  { id: "modiin-illit", english: "Modi'in Illit", arabic: "موديعين عيليت", hebrew: "מודיעין עילית", district: "Judea and Samaria" },

  // --- South district --------------------------------------------------------
  { id: "beer-sheva", english: "Be'er Sheva", arabic: "بئر السبع", hebrew: "באר שבע", district: "South", latitude: 31.2518, longitude: 34.7913 },
  { id: "ashdod", english: "Ashdod", arabic: "أسدود", hebrew: "אשדוד", district: "South", latitude: 31.8014, longitude: 34.6435 },
  { id: "ashkelon", english: "Ashkelon", arabic: "عسقلان", hebrew: "אשקלון", district: "South", latitude: 31.6688, longitude: 34.5742 },
  { id: "eilat", english: "Eilat", arabic: "إيلات", hebrew: "אילת", district: "South", latitude: 29.5581, longitude: 34.9482 },
  { id: "dimona", english: "Dimona", arabic: "ديمونة", hebrew: "דימונה", district: "South" },
  { id: "arad", english: "Arad", arabic: "عراد", hebrew: "ערד", district: "South" },
  { id: "sderot", english: "Sderot", arabic: "سديروت", hebrew: "שדרות", district: "South" },
  { id: "netivot", english: "Netivot", arabic: "نتيفوت", hebrew: "נתיבות", district: "South" },
  { id: "ofakim", english: "Ofakim", arabic: "أوفكيم", hebrew: "אופקים", district: "South" },
  { id: "kiryat-gat", english: "Kiryat Gat", arabic: "كريات جات", hebrew: "קריית גת", district: "South" },
  { id: "kiryat-malachi", english: "Kiryat Malakhi", arabic: "كريات مالاخي", hebrew: "קריית מלאכי", district: "South" },
  { id: "rahat", english: "Rahat", arabic: "رهط", hebrew: "רהט", district: "South" },
  { id: "hura", english: "Hura", arabic: "حورة", hebrew: "חורה", district: "South" },
  { id: "lakiya", english: "Lakiya", arabic: "اللقية", hebrew: "לקיה", district: "South" },
  { id: "kuseife", english: "Kuseife", arabic: "كسيفة", hebrew: "כסיפה", district: "South" },
  { id: "segev-shalom", english: "Segev Shalom", arabic: "شقيب السلام", hebrew: "שגב שלום", district: "South" },
  { id: "tel-sheva", english: "Tel Sheva", arabic: "تل السبع", hebrew: "תל שבע", district: "South" },
  { id: "mitzpe-ramon", english: "Mitzpe Ramon", arabic: "متسبيه رامون", hebrew: "מצפה רמון", district: "South" },
];

export const ISRAEL_LOCATION_BY_ID: Record<string, IsraelLocation> =
  ISRAEL_LOCATIONS.reduce(
    (acc, loc) => {
      acc[loc.id] = loc;
      return acc;
    },
    {} as Record<string, IsraelLocation>,
  );

export const getIsraelLocationById = (
  id?: string | null,
): IsraelLocation | null => (id ? ISRAEL_LOCATION_BY_ID[id] || null : null);
