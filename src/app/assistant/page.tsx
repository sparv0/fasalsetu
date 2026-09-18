import { requirePageUser } from "@/lib/session";
import { aiEnabled } from "@/lib/ai/gemini";
import { getT } from "@/lib/lang";
import AssistantChat from "@/components/ai/AssistantChat";
import { AiOff } from "@/components/ai/AiPanels";

const SUGGESTIONS: Record<string, Record<string, string[]>> = {
  FARMER: {
    en: ["Where should I sell my onion this week?", "Should I store my lot or sell now?", "Is the FarmDirect offer good?", "How do I get a better grade?"],
    hi: ["इस हफ्ते प्याज कहाँ बेचूँ?", "अभी बेचूँ या स्टोर करूँ?", "मुझे सबसे ज़्यादा पैसा कहाँ मिलेगा?", "अच्छा ग्रेड कैसे पाऊँ?"],
    mr: ["या आठवड्यात कांदा कुठे विकू?", "आत्ता विकू की साठवू?", "मला सर्वात जास्त पैसे कुठे मिळतील?", "चांगला ग्रेड कसा मिळवू?"],
  },
  FPO: {
    en: ["Which member lots should we pool?", "Where should our pooled onion go?", "How are pool payouts split?"],
    hi: ["किन सदस्यों के लॉट मिलाएँ?", "हमारा पूल्ड प्याज कहाँ बेचें?"],
    mr: ["कोणत्या सदस्यांचे लॉट एकत्र करू?", "आमचा एकत्रित कांदा कुठे विकू?"],
  },
  BUYER: {
    en: ["Which onion lot fits my demand best?", "What is a fair price to offer this week?", "Which sellers are verified?"],
    hi: ["मेरी मांग के लिए सबसे अच्छा लॉट कौन सा है?", "इस हफ्ते सही दाम क्या होगा?"],
    mr: ["माझ्या मागणीसाठी सर्वात योग्य लॉट कोणता?", "या आठवड्यात योग्य भाव काय?"],
  },
  ADMIN: {
    en: ["Summarise open grievances", "Which markets look unusual this week?", "How is trading activity on the platform?"],
    hi: ["खुली शिकायतों का सार बताओ"],
    mr: ["उघड्या तक्रारींचा सारांश द्या"],
  },
};

const GREETING = {
  en: "Namaste! I'm Kisan Sahayak. I can see your lots, offers and today's mandi prices. Ask me where to sell, what an offer is worth, or anything about using FASALSETU. You can type or tap 🎤 to speak.",
  hi: "नमस्ते! मैं किसान सहायक हूँ। मैं आपके लॉट, ऑफ़र और आज के मंडी भाव देख सकता हूँ। पूछिए कहाँ बेचना है, ऑफ़र कितना सही है — लिखकर या 🎤 दबाकर बोलकर।",
  mr: "नमस्कार! मी किसान सहायक. मला तुमचे लॉट, ऑफर आणि आजचे बाजारभाव दिसतात. कुठे विकायचे, ऑफर योग्य आहे का — लिहून किंवा 🎤 दाबून बोलून विचारा.",
};

export default async function AssistantPage() {
  const user = await requirePageUser();
  const { t, lang } = await getT();
  const enabled = aiEnabled();
  const s = SUGGESTIONS[user.role];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-emerald-900">{t("✨ Kisan Sahayak", "✨ किसान सहायक")}</h1>
        <p className="text-stone-600 text-sm">
          {t(
            "AI assistant grounded in your own lots, offers and FASALSETU market data. Switch the answer language (EN / हिं / मरा) in the top bar.",
            "आपके लॉट, ऑफ़र और FASALSETU मंडी डेटा पर आधारित एआई सहायक। जवाब की भाषा ऊपर (EN / हिं / मरा) से बदलें।"
          )}
        </p>
      </div>
      {!enabled && <AiOff />}
      <AssistantChat enabled={enabled} suggestions={s[lang] ?? s.en} greeting={GREETING[lang]} />
      <p className="text-xs text-stone-400">
        {t(
          "Answers are AI-generated (Google Gemini) from DEMO/SAMPLE market data and your account. Double-check numbers on the lot page before acting.",
          "जवाब एआई (Google Gemini) द्वारा नमूना मंडी डेटा और आपके खाते से बनाए गए हैं। कदम उठाने से पहले लॉट पेज पर आँकड़े जाँच लें।"
        )}
      </p>
    </div>
  );
}
