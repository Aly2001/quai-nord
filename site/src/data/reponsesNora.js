import { normaliser } from "./horaires";

// Les réponses que le site donne LUI-MÊME, sans Gemini : la présentation, le bonjour, le merci.
// Elles sont identiques à chaque fois, instantanées, et ne coûtent aucune question.
export const PRESENTATION = `Bonjour ! 👋 Je suis Nora, votre assistante de voyage sur Quai Nord.
🚆 Je trouve votre train entre deux gares et je vous dis s'il risque d'être en retard, puis je vous indique quel bus prendre à la sortie de la gare pour rejoindre votre destination, dans plusieurs villes de la région (et aussi le métro et le tram à Lille).
💬 Posez-moi simplement votre question, comme si vous parliez à quelqu'un, par exemple : « Je vais à Arras depuis Amiens demain matin » ou « Je suis à la gare de Lille Flandres et je veux aller à l'université ».
Alors, où souhaitez-vous aller ? 😊`;

const BONJOUR = "Bonjour ! 👋 Je suis Nora. Je vous aide pour votre TER et pour le bus après le train. Où souhaitez-vous aller ?";
const MERCI = "Avec plaisir, bon voyage ! 🚆";

// « à quoi tu sers », « qui es-tu », « tu fais quoi », « présente-toi »… (comparés sans accents ni majuscules)
const QUESTIONS_PRESENTATION = [
  /a quoi (tu )?sers?( tu)?/, /qui es tu/, /qui est tu/, /t es qui/, /tu es qui/, /(tu fais|tu sais faire|tu peux faire) quoi/,
  /que (sais|peux) tu faire/, /qu est ce que tu (fais|sais faire|peux faire)/, /presente toi/, /c est quoi nora/, /tu sers a quoi/,
];
const SALUTS = /^(bonjour|bonsoir|salut|coucou|hello|bjr|slt|hey)( nora)?$/;
const REMERCIEMENTS = /^(merci( beaucoup| bien)?|au revoir|bonne journee|bonne soiree|a bientot)( nora)?$/;

export function reponseLocale(question) {
  const texte = normaliser(question).replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  if (!texte) return null;
  if (QUESTIONS_PRESENTATION.some((motif) => motif.test(texte))) return PRESENTATION;
  if (SALUTS.test(texte)) return BONJOUR;
  if (REMERCIEMENTS.test(texte)) return MERCI;
  return null;
}
