export const primaryLanguages = ['en-IN', 'ta-IN'] as const;
export const pilotLanguages = ['kn-IN', 'ml-IN', 'te-IN'] as const;
export type FarmLocale = typeof primaryLanguages[number] | typeof pilotLanguages[number];
export const DEFAULT_LOCALE: FarmLocale = 'ta-IN';

export function enabledLanguages(): FarmLocale[] {
 const enabled = new Set(process.env.KALANI_PILOT_LANGUAGES?.split(',').map(code => code.trim()));
 return [...primaryLanguages, ...pilotLanguages.filter(code => enabled.has(code))];
}

export function activeLanguage(locale: FarmLocale): FarmLocale {
 return enabledLanguages().includes(locale) ? locale : DEFAULT_LOCALE;
}

const scripts: Record<FarmLocale, RegExp> = {
 'en-IN': /[A-Za-z]{2,}/,
 'ta-IN': /\p{Script=Tamil}/u,
 'kn-IN': /\p{Script=Kannada}/u,
 'ml-IN': /\p{Script=Malayalam}/u,
 'te-IN': /\p{Script=Telugu}/u,
};
export const hasLocaleScript = (text: string, locale: FarmLocale) => scripts[locale].test(text);

const commands: Record<FarmLocale, RegExp> = {
 'en-IN': /^(?:english|ஆங்கில(?:த்தில்|த்துல)|இங்கிலீ(?:ஷ்|ஷ்ல|ஷில்)|ಇಂಗ್ಲಿಷ್(?:ನಲ್ಲಿ)?|ഇംഗ്ലീഷിൽ|ഇംഗ്ലീഷ്|ఇంగ్లీషు(?:లో)?|ఆంగ్లంలో)$/iu,
 'ta-IN': /^(?:tamil|தமிழ்|தமிழில்|தமிழ்ல|ತಮಿಳು(?:ನಲ್ಲಿ)?|തമിഴിൽ|തമിഴ്|తమిళం(?:లో)?|తమిళంలో)$/iu,
 'kn-IN': /^(?:kannada|கன்னடம்|கன்னடத்தில்|ಕನ್ನಡ(?:ದಲ್ಲಿ)?|കന്നഡ(?:യിൽ)?|కన్నడ(?:లో)?)$/iu,
 'ml-IN': /^(?:malayalam|மலையாளம்|மலையாளத்தில்|ಮಲಯಾಳಂ(?:ನಲ್ಲಿ)?|മലയാളം|മലയാളത്തിൽ|మలయాళం(?:లో)?)$/iu,
 'te-IN': /^(?:telugu|தெலுங்கு|தெலுங்கில்|ತೆಲುಗು(?:ನಲ್ಲಿ)?|തെലുങ്ക്|തെലുങ്കിൽ|తెలుగు(?:లో)?)$/iu,
};

export function spokenLanguageCommand(text: string): FarmLocale | undefined {
 const clean = text.normalize('NFKC').toLowerCase().replace(/[\u200c\u200d]/gu, '').trim().replace(/[.!?？।]+$/u, '').trim().replace(/\s+/gu, ' ');
 const requested = clean.match(/^(?:(?:please,?|can you|could you) )?(?:(?:reply|answer|speak|talk) (?:to me )?in|(?:switch|change)(?: the language)? to) (.+?)(?: from now on)?(?:,? please)?$/u)?.[1]
  ?? clean.match(/^(?:தயவு ?செய்து )?(.+?) (?:பேசுங்க|பேசுங்கள்|பேசு|பதில் சொல்லுங்க|பதில் சொல்லுங்கள்|பதில் சொல்லு|பதில் அளியுங்கள்|மாற்றுங்கள்|ಮಾತಾಡಿ|ಮಾತನಾಡಿ|ಉತ್ತರಿಸಿ|സംസാരിക്കൂ|സംസാരിക്കുക|മറുപടി പറയൂ|మాట్లాడండి|జవాబు ఇవ్వండి)$/u)?.[1];
 return requested === undefined ? undefined : [...primaryLanguages, ...pilotLanguages].find(locale => commands[locale].test(requested));
}

export const languageReply = {
 'en-IN': { switched: 'I’ll reply in English.', unavailable: 'That language is not available yet. I’ll keep using English.', unchanged: 'I’ll keep the language you chose most recently.' },
 'ta-IN': { switched: 'இனி தமிழில் பதில் சொல்கிறேன்.', unavailable: 'அந்த மொழி இன்னும் கிடைக்கவில்லை. தொடர்ந்து தமிழில் பேசுகிறேன்.', unchanged: 'நீங்கள் கடைசியாகத் தேர்வு செய்த மொழியிலேயே தொடர்கிறேன்.' },
 'kn-IN': { switched: 'ಇನ್ನು ಕನ್ನಡದಲ್ಲಿ ಉತ್ತರಿಸುತ್ತೇನೆ.', unavailable: 'ಆ ಭಾಷೆ ಇನ್ನೂ ಲಭ್ಯವಿಲ್ಲ. ಕನ್ನಡದಲ್ಲೇ ಮುಂದುವರಿಯುತ್ತೇನೆ.', unchanged: 'ನೀವು ಕೊನೆಯದಾಗಿ ಆರಿಸಿದ ಭಾಷೆಯಲ್ಲೇ ಮುಂದುವರಿಯುತ್ತೇನೆ.' },
 'ml-IN': { switched: 'ഇനി മലയാളത്തിൽ മറുപടി പറയാം.', unavailable: 'ആ ഭാഷ ഇപ്പോൾ ലഭ്യമല്ല. മലയാളത്തിൽ തുടരാം.', unchanged: 'നിങ്ങൾ അവസാനം തിരഞ്ഞെടുത്ത ഭാഷയിൽ തുടരാം.' },
 'te-IN': { switched: 'ఇక తెలుగులో జవాబు ఇస్తాను.', unavailable: 'ఆ భాష ఇంకా అందుబాటులో లేదు. తెలుగులోనే కొనసాగుతాను.', unchanged: 'మీరు చివరిగా ఎంచుకున్న భాషలోనే కొనసాగుతాను.' },
} satisfies Record<FarmLocale, Record<string, string>>;
