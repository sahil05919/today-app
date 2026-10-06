import { AREA_ORDER } from "./defaults";

/**
 * The offline brain: keyword and phrase dictionaries for every category, in English, Roman Hinglish and
 * Devanagari. Used when Gemini isn't set up, is offline, or is unsure. Each category gets a score from the
 * words it matches (strong words count more); the best score wins, with ties going to your session areas.
 */
const L = String.raw`\p{L}\p{M}\p{N}_`;
/** A word-boundary that works for Devanagari too (plain \b doesn't). */
export const kw = (src: string, flags = "iu") => new RegExp(`(?<![${L}])(?:${src})(?![${L}])`, flags);

type Weighted = [RegExp, number];
const w = (src: string, weight: number): Weighted => [kw(src), weight];

export const CATEGORY_WORDS: Record<string, Weighted[]> = {
  // ---- your weekly-target areas -------------------------------------------------------------------
  powerbi: [
    w(String.raw`power\s?-?bi|powerbi|dax|power\s?query|pbix|slicers?`, 5),
    w(String.raw`dashboards?|data\s?model\w*|bi\s+reports?|report\s+visuals?`, 3),
  ],
  meditation: [
    w(String.raw`meditat\w*|mindful\w*|pranayam\w*|vipassana|zen|dhyan|ध्यान|मेडिटेशन`, 5),
    w(String.raw`breathing|breathwork|sit\s+quietly`, 3),
  ],
  job: [
    w(String.raw`jobs?|naukri|नौकरी|linkedin|recruiter|recruitment|leetcode|interview\w*|इंटरव्यू`, 5),
    w(String.raw`cv|resume|résumé|cover\s?letter|job\s+(?:prep|apply|search|hunt)|mock\s+interview|portfolio|hiring|offer\s+letter|referrals?`, 4),
    w(String.raw`appl(?:y|ied|ying|ication|ications)`, 2),
  ],
  english: [
    w(String.raw`english|अंग्रेज़ी|अंग्रेजी|vocab\w*|grammar`, 5),
    w(String.raw`reading|books?(?!\s+(?:the\s+|a\s+|my\s+|our\s+)?(?:flights?|trains?|tickets?|hotels?|tables?|appointments?|restaurants?|slots?|rooms?|cabs?|taxis?|dentist|doctor|gp|visa|trip|holiday|tour|seats?|venue|tests?))|novels?|kitab|kitaab|किताब|short\s+stor(?:y|ies)|newspaper|magazine|articles?`, 3),
    w(String.raw`read(?!\s+(?:the\s+)?(?:e-?mails?|mails?|messages?|inbox|invoice|contract|terms))`, 2),
  ],
  walking: [
    w(String.raw`walk\w*|stroll\w*|hike|hiking|trek\w*|tehal\w*|टहल\w*|ghumne\s+(?:jana|jaana|ja)|steps`, 5),
    w(String.raw`jog\w*`, 2),
  ],

  // ---- the rest -----------------------------------------------------------------------------------
  health: [
    w(String.raw`gym|जिम|योग|वर्कआउट|workout|work\s?out|exercise|yoga|physio\w*|doctor|डॉक्टर|dentist|dental|optician|eye\s?test|blood\s?(?:test|pressure|sugar)|check-?up|hospital|clinic|vitamins?|supplements?`, 4),
    w(String.raw`medic\w*|tablets?|pills?|dawai|dawa|davai|दवाई|दवा|weigh\w*|weight|diet|calories|sleep|stretch\w*|massage|haircut|vyayam|व्यायाम|kasrat|running|go\s+for\s+a\s+run|cardio|sit-?ups?|push-?ups?`, 3),
  ],
  learning: [
    w(String.raw`study\w*|course|courses|tutorial|lecture|exam|exams|revision|revise|homework|udemy|coursera|certification|padhai|पढ़ाई|पढाई|seekhna|sikhna|सीखना`, 4),
    w(String.raw`learn\w*|class|classes|syllabus|notes\s+for\s+exam`, 3),
  ],
  home: [
    w(String.raw`clean\w*|laundry|dishes|dishwasher|vacuum\w*|mop\w*|tidy\w*|declutter\w*|dust\w*|cook\w*|recipe|meal\s?prep|kitchen|fridge|bathroom|garbage|trash|bins?|ironing|bedsheets?|wardrobe|plumber|electrician|furniture|curtains?|water\s+the\s+plants?|plants?`, 4),
    w(String.raw`safai|सफाई|jhadu|jhaadu|झाड़ू|pocha|पोछा|kapde|कपड़े|dhona|धोना|bartan|बर्तन|khana\s+banana|खाना\s+बनाना|ghar|घर|repair|fix\s+(?:the\s+)?(?:tap|light|door|shelf|bulb)`, 3),
  ],
  shopping: [
    w(String.raw`shopping|amazon|flipkart|myntra|ebay|parcels?|courier|delivery|online\s+order|kharidna|खरीदना|shop`, 4),
    w(String.raw`order|shoes?|clothes|jacket|jeans|shirts?|dress|trousers|sneakers|bag|return\s+(?:the\s+)?(?:parcel|order|item|package)`, 3),
    w(String.raw`buy`, 1),
  ],
  finance: [
    w(String.raw`rent|kiraya|किराया|credit\s?card|debit\s?card|bank|banking|bills?|electricity|bijli|बिजली|broadband|internet\s+bill|phone\s+bill|mobile\s+bill|gas\s+bill|water\s+bill|loan|emi|insurance|invest\w*|mutual\s?funds?|sip|stocks?|budget|salary|payslip|savings?|upi|paytm|gpay|atm|withdraw\w*|expenses?|spending|finance|hmrc|tax\s+return|paisa|paise|पैसे|बिल`, 4),
    w(String.raw`cash|transfer|statement|payments?|tax|pay`, 2),
  ],
  family: [
    w(String.raw`mum|mom|mummy|mommy|mama|maa|मम्मी|माँ|मां|dad|daddy|papa|पापा|parents|family|sisters?|sis|didi|दीदी|behen|बहन|brothers?|bro|bhai|bhaiya|भाई|grand(?:ma|pa|mother|father|parents)|nani|nana|dadi|dada|नानी|दादी|uncle|aunt(?:y|ie)?|chacha|chachi|mausi|cousins?|dost|दोस्त|friends?`, 4),
    w(String.raw`birthday|bday|anniversary|wish|gift|surprise|catch\s?up|check\s+in\s+on|kaisa\s+hai`, 2),
  ],
  travel: [
    w(String.raw`flights?|airport|airline|itinerary|luggage|suitcase|packing|boarding\s+pass|irctc|railway|visa|vacation|holiday|hotels?|hostel|airbnb|tour|yatra|यात्रा|safar|सफर|travel\w*|trip`, 4),
    w(String.raw`trains?|tickets?`, 2),
    w(String.raw`pack|booking|passport`, 1),
  ],
  admin: [
    w(String.raw`council|gp|g\.p\.|nhs|dvla|appointments?|paperwork|letters?|post\s?office|licen[cs]e|passport|tenancy|landlord|complaint|registration|register|change\s+of\s+address|kagaz|कागज|certificate|documents?|parking\s+permit`, 4),
    w(String.raw`forms?|renew\w*|contract|address|post|id`, 2),
  ],
  fun: [
    w(String.raw`movies?|films?|cinema|concert|gig|festival|theatre|theater|museum|exhibition|pub|drinks|clubbing|karaoke|bowling|picnic`, 4),
    w(String.raw`party|parties|date\s+night|movie\s+night|game\s+night|hang\s?out|go\s+out|going\s+out|picture\s+dekh\w*|ghumne|घूमने`, 5),
    w(String.raw`dinner|lunch|brunch|match|show|outing|bar|club`, 2),
  ],
  notes: [w(String.raw`someday|maybe\s+later|brain\s?dump`, 5), w(String.raw`ideas?|thoughts?|jot\s+down|remember\s+that|to\s+research|look\s+into`, 3), w(String.raw`notes?|maybe`, 1)],
  work: [
    w(String.raw`starred\s+e-?mails?|inbox|stand-?up|invoice|timesheet|sprint|jira|slack|1:1|teams\s+call|client|clients|manager|boss|deadline|presentation|deck|slides|proposal|office|kaam|काम|work`, 4),
    w(String.raw`meetings?|e-?mails?|mails?|reply|respond|follow\s?up|zoom|team|report|project`, 2),
    w(String.raw`review`, 1),
  ],
  career: [w(String.raw`networking|personal\s+brand|side\s+project|promotion|appraisal|performance\s+review|mentor\w*|certification`, 3)],
};

/** Ties go to the earlier area in this list, so your session areas win. */
const PRIORITY = AREA_ORDER;

export interface AreaGuess {
  id: string;
  score: number;
}

export function scoreAreas(text: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, list] of Object.entries(CATEGORY_WORDS)) {
    let s = 0;
    for (const [re, weight] of list) if (re.test(text)) s += weight;
    if (s) out[id] = s;
  }
  return out;
}

/** Best category for a piece of text among the areas you have. null when nothing scores at least 2. */
export function bestArea(text: string, available: Set<string>): AreaGuess | null {
  const scores = scoreAreas(text);
  let best: AreaGuess | null = null;
  for (const [id, score] of Object.entries(scores)) {
    if (!available.has(id) || score < 2) continue;
    const rank = (x: string) => (PRIORITY.includes(x) ? PRIORITY.indexOf(x) : 99);
    if (!best || score > best.score || (score === best.score && rank(id) < rank(best.id))) best = { id, score };
  }
  return best;
}

// ---- Groceries -------------------------------------------------------------------------------------

const ITEMS = [
  // dairy & eggs
  String.raw`milk|doodh|दूध|bread|pav|bun|buns|eggs?|anda|ande|अंडे|अंडा|butter|makhan|मक्खन|cheese|paneer|पनीर|curd|dahi|दही|yogh?urt|ghee|घी|cream|lassi|chaas`,
  // staples
  String.raw`sugar|chini|cheeni|चीनी|शक्कर|salt|namak|नमक|rice|chawal|चावल|atta|आटा|flour|maida|dal|daal|दाल|lentils?|chana|rajma|besan|suji|poha|oats|cereal|cornflakes|noodles|pasta|spaghetti|muesli|quinoa`,
  // oils, spices, sauces
  String.raw`oil|tel|तेल|masala|मसाला|spices?|haldi|हल्दी|jeera|zeera|जीरा|mirch|मिर्च|pepper|honey|shahad|jam|sauce|ketchup|mayo|mayonnaise|vinegar|pickle|achar|अचार`,
  // drinks & snacks
  String.raw`tea|chai(?:\s+patti)?|चाय|coffee|कॉफी|biscuits?|cookies|snacks?|namkeen|chips|chocolates?|juice|soda|cola|water\s+bottles?|mineral\s+water|squash`,
  // fresh
  String.raw`vegetables?|veggies?|sabzi|sabji|subzi|सब्ज़ी|सब्जी|onions?|pyaaz|pyaz|प्याज|potato(?:es)?|aloo|आलू|tomato(?:es)?|tamatar|टमाटर|garlic|lahsun|लहसुन|ginger|adrak|अदरक|chill(?:i|ies)|lemons?|nimbu|नींबू|coriander|dhaniya|धनिया|spinach|palak|पालक|carrots?|gajar|गाजर|cucumber|kheera|peas|matar|mushrooms?|capsicum|cabbage|cauliflower|gobi|brinjal|baingan|okra|bhindi|भिंडी|salad|lettuce|curry\s+leaves|mint|pudina`,
  String.raw`fruits?|phal|फल|bananas?|kela|केला|apples?|seb|सेब|oranges?|santra|mangoe?s?|aam|आम|grapes|angoor|papaya|pomegranate|anar|watermelon|berries|strawberr(?:y|ies)|avocados?|coconut|nariyal`,
  // household
  String.raw`soap|sabun|साबुन|shampoo|conditioner|toothpaste|toothbrush|detergent|surf|dishwash\w*|dish\s+soap|tissues?|toilet\s?(?:paper|roll)s?|handwash|hand\s+wash|sanitizer|bin\s+bags?|garbage\s+bags?|foil|cling\s?film|batteries|bulbs?|sponge|scrub|phenyl|floor\s+cleaner|deodorant|razor|sanitary\s+(?:pads|napkins)|diapers?|baby\s+food|pet\s+food|dog\s+food|cat\s+food|groceries|ration`,
].join("|");

export const GROCERY_ITEM = kw(ITEMS);

/** Words that sit in front of an item without being part of it: "some milk", "2 litres of milk". */
const FILLER = kw(String.raw`some|more|extra|fresh|little|bit\s+of|the|a|an|my|our|thoda|thodi|aur|ya|or|and|bhi|the\s+rest\s+of|more\s+of|lots\s+of`);
const QTY = /^\s*\d+(?:[.,]\d+)?\s*(?:litres?|liters?|ltr|ml|kgs|kg|gms|gm|packs?|packets?|dozen|bottles?|loaves|loaf|tins?|cans?|boxes?|bags?|l|g|x)?(?![a-z])\s*(?:of\s+)?/i;

/** Cleans one list chunk: "2 litres of milk" → "2 litres milk" stays readable; returns null if it isn't a grocery item. */
export function groceryChunk(chunk: string): string | null {
  const t = chunk.trim().replace(/^[\s,;:.-]+|[\s,;:.!?-]+$/g, "");
  if (!t || t.split(/\s+/).length > 5) return null;
  if (!GROCERY_ITEM.test(t)) return null;
  const qty = QTY.exec(t);
  const rest = t.slice(qty ? qty[0].length : 0).replace(FILLER, " ").replace(/\s+/g, " ").trim();
  const name = `${qty && qty[0].trim() ? qty[0].replace(/\s*of\s*$/i, "").trim() + " " : ""}${rest}`.trim();
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : null;
}

/** Splits "milk, bread and eggs" into items. null unless EVERY chunk is a grocery item. */
export function groceryList(text: string): string[] | null {
  const chunks = text.split(/[,;\n]|\s+(?:and|aur|और|&|plus)\s+/i).map((c) => c.trim()).filter(Boolean);
  if (!chunks.length) return null;
  const items: string[] = [];
  for (const c of chunks) {
    const g = groceryChunk(c);
    if (!g) return null;
    items.push(g);
  }
  return [...new Set(items)];
}
