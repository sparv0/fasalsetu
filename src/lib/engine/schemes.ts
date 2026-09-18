import { commodityName, makeT, type T, type UiLang } from "../i18n";

// Rule-based scheme suggestions. These rules are a DEMO catalogue: they have NOT been
// verified against official notifications, so the UI never claims eligibility — it only
// points the farmer to the official source to check.
export const SCHEME_RULES_VERSION = "demo-2026-09 (unverified)";

export type SchemeProfile = {
  role: "FARMER" | "FPO";
  state: string;
  landAcres: number | null;
  socialCategory: string | null;
  commodities: string[];
  inFpo: boolean;
  largestLotQt: number;
};

export type SchemeSuggestion = {
  id: string;
  name: string;
  summary: string;
  why: string[];
  howToCheck: string;
  link?: string;
};

type Rule = {
  id: string;
  link?: string;
  name: (t: T) => string;
  summary: (t: T) => string;
  howToCheck: (t: T) => string;
  why: (p: SchemeProfile, t: T, lang: UiLang) => string[] | null;
};

const RULES: Rule[] = [
  {
    id: "pm-kisan",
    link: "https://pmkisan.gov.in",
    name: () => "PM-KISAN",
    summary: (t) =>
      t(
        "Central income-support scheme for landholding farmer families, paid in instalments.",
        "ज़मीन वाले किसान परिवारों के लिए केंद्र की आय सहायता योजना, किस्तों में भुगतान।"
      ),
    why: (p, t) =>
      p.role === "FARMER" && (p.landAcres ?? 0) > 0 ? [t(`You reported ${p.landAcres} acres of land.`, `आपने ${p.landAcres} एकड़ ज़मीन बताई है।`)] : null,
    howToCheck: (t) =>
      t(
        "Check your status or register on the official PM-KISAN portal or at a Common Service Centre.",
        "आधिकारिक PM-KISAN पोर्टल या कॉमन सर्विस सेंटर (CSC) पर अपनी स्थिति देखें या पंजीकरण करें।"
      ),
  },
  {
    id: "pmfby",
    link: "https://pmfby.gov.in",
    name: (t) => t("Pradhan Mantri Fasal Bima Yojana (crop insurance)", "प्रधानमंत्री फ़सल बीमा योजना"),
    summary: (t) =>
      t(
        "Crop insurance against yield loss from natural risks for notified crops and areas.",
        "अधिसूचित फ़सलों और क्षेत्रों में प्राकृतिक आपदा से उपज के नुकसान का बीमा।"
      ),
    why: (p, t, lang) =>
      p.role === "FARMER" && p.commodities.length > 0
        ? [
            t(
              `You grow ${p.commodities.join(", ")}. Coverage depends on whether the crop is notified in your district for the season.`,
              `आप ${p.commodities.map((c) => commodityName(c, lang)).join(", ")} उगाते हैं। बीमा इस पर निर्भर है कि आपके ज़िले में इस मौसम के लिए फ़सल अधिसूचित है या नहीं।`
            ),
          ]
        : null,
    howToCheck: (t) =>
      t(
        "Confirm your crop is notified for your district and season, then enrol via your bank, CSC or the portal before the cut-off date.",
        "पुष्टि करें कि आपकी फ़सल आपके ज़िले और मौसम के लिए अधिसूचित है, फिर अंतिम तिथि से पहले बैंक, CSC या पोर्टल से नामांकन करें।"
      ),
  },
  {
    id: "kcc",
    name: (t) => t("Kisan Credit Card", "किसान क्रेडिट कार्ड"),
    summary: (t) => t("Short-term bank credit for cultivation and post-harvest needs.", "खेती और कटाई के बाद की ज़रूरतों के लिए बैंक से अल्पकालिक कर्ज़।"),
    why: (p, t) =>
      p.role === "FARMER" && (p.landAcres ?? 0) > 0
        ? [t("You cultivate land and may need seasonal working capital.", "आप खेती करते हैं और मौसमी पूंजी की ज़रूरत पड़ सकती है।")]
        : null,
    howToCheck: (t) =>
      t("Ask your bank branch about a Kisan Credit Card; carry land records and ID.", "अपनी बैंक शाखा में किसान क्रेडिट कार्ड के बारे में पूछें; ज़मीन के कागज़ और पहचान पत्र साथ ले जाएँ।"),
  },
  {
    id: "enam",
    link: "https://enam.gov.in",
    name: (t) => t("e-NAM registration", "e-NAM पंजीकरण"),
    summary: (t) => t("National online trading platform linking APMC markets.", "APMC मंडियों को जोड़ने वाला राष्ट्रीय ऑनलाइन व्यापार मंच।"),
    why: (p, t) =>
      p.commodities.length > 0
        ? [
            t(
              "You sell produce through mandis; e-NAM widens the set of buyers at integrated APMCs.",
              "आप मंडी में माल बेचते हैं; e-NAM से जुड़ी मंडियों में ज़्यादा खरीदार मिलते हैं।"
            ),
          ]
        : null,
    howToCheck: (t) => t("Register through your local e-NAM-integrated APMC.", "अपनी नज़दीकी e-NAM से जुड़ी APMC मंडी में पंजीकरण करें।"),
  },
  {
    id: "mahadbt",
    link: "https://mahadbt.maharashtra.gov.in",
    name: (t) => t("MahaDBT agriculture schemes (Maharashtra)", "महाडीबीटी कृषि योजनाएँ (महाराष्ट्र)"),
    summary: (t) =>
      t(
        "Maharashtra's single portal for state agriculture schemes such as mechanisation, irrigation and horticulture support.",
        "महाराष्ट्र की कृषि योजनाओं (मशीनीकरण, सिंचाई, बागवानी सहायता आदि) का एक ही पोर्टल।"
      ),
    why: (p, t) => {
      if (p.state !== "Maharashtra") return null;
      const reasons = [t("You farm in Maharashtra.", "आप महाराष्ट्र में खेती करते हैं।")];
      if (p.socialCategory === "SC" || p.socialCategory === "ST") {
        reasons.push(
          t(
            `Some state schemes have components for ${p.socialCategory} farmers — check the category filters on the portal.`,
            `कुछ राज्य योजनाओं में ${p.socialCategory} किसानों के लिए अलग प्रावधान हैं — पोर्टल पर श्रेणी फ़िल्टर देखें।`
          )
        );
      }
      return reasons;
    },
    howToCheck: (t) =>
      t(
        "Log in to MahaDBT with your farmer ID and review the schemes listed for your profile.",
        "अपने किसान आईडी से महाडीबीटी पर लॉग इन करें और अपनी प्रोफ़ाइल के लिए दिखाई गई योजनाएँ देखें।"
      ),
  },
  {
    id: "fpo",
    link: "https://www.sfacindia.com/FPOS.aspx",
    name: (t) => t("Join or form a Farmer Producer Organisation", "किसान उत्पादक संगठन (FPO) से जुड़ें या बनाएँ"),
    summary: (t) =>
      t(
        "FPOs let small farmers pool produce, bargain together and access support programmes.",
        "FPO से छोटे किसान माल इकट्ठा कर सकते हैं, मिलकर मोलभाव कर सकते हैं और सहायता योजनाओं का लाभ ले सकते हैं।"
      ),
    why: (p, t) =>
      p.role === "FARMER" && !p.inFpo
        ? [
            t(
              "You are not a member of an FPO on this platform. Pooling can help you reach bulk buyers.",
              "आप इस प्लेटफ़ॉर्म पर किसी FPO के सदस्य नहीं हैं। माल मिलाकर बेचने से बड़े खरीदार मिल सकते हैं।"
            ),
          ]
        : null,
    howToCheck: (t) =>
      t("See SFAC's FPO resources, or ask your local agriculture office about FPOs near you.", "SFAC की FPO जानकारी देखें, या नज़दीकी कृषि कार्यालय से अपने पास के FPO के बारे में पूछें।"),
  },
  {
    id: "aif",
    name: (t) => t("Agriculture Infrastructure Fund", "कृषि अवसंरचना कोष"),
    summary: (t) =>
      t("Financing support for post-harvest infrastructure such as storage and warehouses.", "भंडारण और गोदाम जैसी कटाई-बाद की सुविधाओं के लिए वित्तीय सहायता।"),
    why: (p, t) =>
      p.role === "FPO" || p.largestLotQt >= 150
        ? [
            p.role === "FPO"
              ? t("FPOs building shared storage are a core target group.", "साझा भंडारण बनाने वाले FPO इसके मुख्य लाभार्थी हैं।")
              : t(`You handle lots of ${p.largestLotQt} qt, where own storage may pay off.`, `आपके लॉट ${p.largestLotQt} क्विंटल तक के हैं, ऐसे में अपना भंडारण फ़ायदेमंद हो सकता है।`),
          ]
        : null,
    howToCheck: (t) => t("Ask a participating bank or your district agriculture office.", "किसी भागीदार बैंक या ज़िला कृषि कार्यालय से पूछें।"),
  },
  {
    id: "soil-health",
    name: (t) => t("Soil Health Card", "मृदा स्वास्थ्य कार्ड"),
    summary: (t) => t("Soil testing with crop-wise nutrient recommendations.", "मिट्टी की जाँच और फ़सल के अनुसार खाद की सलाह।"),
    why: (p, t) =>
      p.role === "FARMER" && (p.landAcres ?? 0) > 0
        ? [t("Soil test results help plan fertiliser use for your next crop.", "मिट्टी जाँच से अगली फ़सल में खाद की सही योजना बनती है।")]
        : null,
    howToCheck: (t) =>
      t("Ask your local agriculture office or Krishi Vigyan Kendra about soil sampling.", "मिट्टी के नमूने के लिए नज़दीकी कृषि कार्यालय या कृषि विज्ञान केंद्र से संपर्क करें।"),
  },
];

export function suggestSchemes(profile: SchemeProfile, lang: UiLang = "en"): SchemeSuggestion[] {
  const t = makeT(lang);
  return RULES.flatMap((rule) => {
    const why = rule.why(profile, t, lang);
    return why
      ? [{ id: rule.id, name: rule.name(t), summary: rule.summary(t), why, howToCheck: rule.howToCheck(t), link: rule.link }]
      : [];
  });
}
