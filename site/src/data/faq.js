// Questions fréquentes de Quai Nord.
// Le contenu est dans faq.json : c'est la SOURCE UNIQUE, lue à la fois
//  - par le site (page /faq) ;
//  - par le serveur de Nora (sa base de connaissances).
// Pour modifier une réponse, modifiez faq.json : la page ET Nora seront à jour.
// Règle : des réponses courtes, exactes, qui décrivent le fonctionnement RÉEL du site.
import donnees from "./faq.json";
import donneesEn from "./faq.en.json";            // la version anglaise (même structure, mêmes identifiants)

export const SNCF_CONNECT = donnees.sncf_connect;
export const faq = donnees.faq;
export const faqDe = (langue) => (langue === "en" ? donneesEn.faq : donnees.faq);
