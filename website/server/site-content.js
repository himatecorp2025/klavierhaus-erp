"use strict";

const content = Object.freeze({
  en: Object.freeze({
    language: "en-US",
    htmlLang: "en-US",
    route: "/",
    alternateRoute: "/hu/",
    alternateLabel: "Magyar",
    brandAriaLabel: "Klavierhaus home",
    title: "Klavierhaus | New York Piano Craft & Culture",
    description: "A new public Klavierhaus experience for piano craft, artists, and intimate cultural events in New York.",
    eyebrow: "New York · Piano Craft · Culture",
    heading: "Where piano craft meets the art of listening.",
    introduction: "The new Klavierhaus public experience is being prepared. Services, instruments, artists, and intimate cultural events will be presented here.",
    foundationLabel: "Public website foundation",
    statusTitle: "A distinct public experience is taking shape.",
    statusBody: "This service is technically independent from the internal Klavierhaus ERP and is ready for the next design and content phase.",
    footer: "Klavierhaus · New York",
    notFoundTitle: "Page not found",
    notFoundBody: "The requested page is not available in the public Klavierhaus experience.",
    homeLabel: "Return home"
  }),
  hu: Object.freeze({
    language: "hu-HU",
    htmlLang: "hu-HU",
    route: "/hu/",
    alternateRoute: "/",
    alternateLabel: "English",
    brandAriaLabel: "Klavierhaus főoldal",
    title: "Klavierhaus | New York-i zongoraművészet és kultúra",
    description: "A Klavierhaus új nyilvános felülete a zongoratechnika, a művészek és a bensőséges New York-i kulturális események számára.",
    eyebrow: "New York · Zongoraművészet · Kultúra",
    heading: "Ahol a zongora\u00adművészet találkozik a hallgatás művészetével.",
    introduction: "A Klavierhaus új nyilvános felülete előkészítés alatt áll. Itt mutatjuk majd be szolgáltatásainkat, hangszereinket, művészeinket és bensőséges kulturális eseményeinket.",
    foundationLabel: "Nyilvános weboldal-alaprendszer",
    statusTitle: "Egy önálló nyilvános élmény formálódik.",
    statusBody: "Ez a szolgáltatás technikailag elkülönül a belső Klavierhaus ERP-rendszertől, és készen áll a következő dizájn- és tartalmi szakaszra.",
    footer: "Klavierhaus · New York",
    notFoundTitle: "Az oldal nem található",
    notFoundBody: "A kért oldal nem érhető el a Klavierhaus nyilvános felületén.",
    homeLabel: "Vissza a főoldalra"
  })
});

function getContent(language) {
  return language === "hu" ? content.hu : content.en;
}

module.exports = { getContent };
