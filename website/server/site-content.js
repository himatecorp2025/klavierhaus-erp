"use strict";

/*
 * Public content contract
 * -----------------------
 * Every visible string, navigation item, image slot and SEO field lives here
 * instead of being embedded in the HTML renderer. The future ERP publishing
 * module can persist this same shape and replace this bundled fallback without
 * redesigning the public website.
 */

const VERSION = "1.2.4";

const routeDefinitions = Object.freeze({
  home: { en: "/", hu: "/hu/" },
  our: { en: "/our", hu: "/hu/rolunk" },
  pianos: { en: "/pianos", hu: "/hu/zongorak" },
  steinway: { en: "/pianos/steinway", hu: "/hu/zongorak/steinway" },
  services: { en: "/services", hu: "/hu/szolgaltatasok" },
  restoration: { en: "/services/restoration", hu: "/hu/szolgaltatasok/zongorafelujitas" },
  tuning: { en: "/services/tuning", hu: "/hu/szolgaltatasok/zongorahangolas" },
  concert: { en: "/services/concert-piano", hu: "/hu/szolgaltatasok/koncertzongora" },
  artists: { en: "/artists", hu: "/hu/muveszek" },
  events: { en: "/events", hu: "/hu/esemenyek" },
  salon: { en: "/events/klavierhaus-salon", hu: "/hu/esemenyek/klavierhaus-szalon" },
  mission: { en: "/cultural-mission", hu: "/hu/kulturalis-kuldetes" },
  contact: { en: "/contact", hu: "/hu/kapcsolat" },
  privacy: { en: "/privacy", hu: "/hu/adatkezeles" }
});

const shared = Object.freeze({
  addressLines: ["790 11th Avenue", "New York, NY 10019"],
  phoneDisplay: "+1 212 245 4535",
  phoneHref: "tel:+12122454535",
  emailDisplay: "info@klavierhaus.com",
  emailHref: "mailto:info@klavierhaus.com",
  logo: "/assets/brand/klavierhaus-round-white.png",
  heroImage: "/assets/media/klavierhaus-hero.jpg",
  salonImage: "/assets/media/klavierhaus-salon.jpg",
  craftImage: "/assets/media/klavierhaus-craft.jpg",
  artistSalonImage: "/assets/media/klavierhaus-artist-salon.png"
});

const globalCopy = Object.freeze({
  en: Object.freeze({
    locale: "en-US",
    languageCode: "en",
    languageName: "English",
    alternateLabel: "HU",
    brand: {
      name: "Klavierhaus",
      wordmark: "KLAVIERHAUS",
      logoImage: shared.logo,
      addressLine1: shared.addressLines[0],
      addressLine2: shared.addressLines[1],
      phoneDisplay: shared.phoneDisplay,
      phoneHref: shared.phoneHref,
      emailDisplay: shared.emailDisplay,
      emailHref: shared.emailHref,
      footerLocations: "New York · France",
      schemaStreetAddress: "790 11th Avenue",
      schemaLocality: "New York",
      schemaRegion: "NY",
      schemaPostalCode: "10019",
      schemaCountry: "US"
    },
    brandAriaLabel: "Klavierhaus home",
    logoAlt: "Klavierhaus — New York and France",
    skipLabel: "Skip to content",
    menuOpenLabel: "Open menu",
    menuCloseLabel: "Close menu",
    scrollLabel: "Scroll",
    navigationLabel: "Primary navigation",
    nav: [
      { key: "artists", label: "Artist" },
      { key: "mission", label: "Culture" },
      { key: "pianos", label: "Piano" },
      { key: "services", label: "Service" },
      { key: "our", label: "Our" }
    ],
    consultationLabel: "Private consultation",
    footerStatement: "A private world of music, artistry, and uncompromising piano craft in New York.",
    footerExplore: "Explore",
    footerVisit: "Visit",
    footerLegal: "Legal",
    footerOur: "Our",
    footerContact: "Contact",
    footerPrivacy: "Privacy",
    rights: "All rights reserved.",
    imageCredit: "Editorial imagery is maintained by authorized Klavierhaus administrators.",
    backHome: "Return home",
    notFoundEyebrow: "404",
    notFoundTitle: "This room is not part of the house.",
    notFoundBody: "The requested page could not be found. Return to the Klavierhaus experience or choose a destination from the menu.",
    soonLabel: "Current programme",
    collectionLabels: {
      reviewsEyebrow: "Reflections",
      reviewsTitle: "The memory of music remains.",
      artistsEyebrow: "Our artists",
      artistsTitle: "The people who give the instrument breath.",
      artistFallbackRole: "Artist",
      artistProfile: "Artist profile",
      showroomEyebrow: "The showroom",
      showroomTitle: "Exceptional instruments, encountered in person.",
      showroomLead: "A piano's true character is known only through tone, touch, and time in the room.",
      showroomCardEyebrow: "Klavierhaus showroom",
      showroomInstrumentSingular: "individually selected instrument in the showroom.",
      showroomInstrumentPlural: "individually selected instruments in the showroom.",
      showroomDiscover: "Discover the instruments",
      servicesEyebrow: "Bespoke care",
      servicesTitle: "Every instrument deserves individual attention.",
      servicesLead: "A private initial assessment, considered consultation, and a proposal shaped around the individual instrument.",
      serviceCardEyebrow: "Klavierhaus atelier",
      serviceAssessment: "Arrange a private assessment",
      brandLead: "Selection begins with listening. Every instrument offers an individual character, touch, and musical encounter.",
      brandPrivateSelection: "Private selection",
      brandCtaTitle: "Meet the instrument before making a decision.",
      brandCta: "Arrange a private appointment",
      brandInstrumentDetails: "Explore the instrument",
      brandInstrumentViewing: "Arrange a private viewing"
    },
    eventLabels: {
      listEyebrow: "Klavierhaus programme",
      listTitle: "Intimate encounters in music.",
      listLead: "A considered programme of concerts, salons, masterclasses, and cultural gatherings in New York.",
      upcoming: "Upcoming programme",
      homeEyebrow: "The next encounters",
      homeTitle: "Enter the room where music becomes personal.",
      homeLead: "A curated sequence of intimate performances and cultural gatherings at Klavierhaus.",
      noEvents: "No upcoming event is currently published.",
      details: "View details",
      viewAll: "View all events",
      buyTickets: "Buy tickets",
      reservePlace: "Reserve a place",
      ticketsSoon: "Ticketing is currently unavailable",
      testMode: "TEST MODE",
      testModeNote: "Choose from the seven supported payment methods. Credit Card uses Stripe Sandbox in this development environment; other methods create a pending reservation until settlement is confirmed.",
      quantity: "Number of tickets",
      attendeeName: "Full name",
      attendeeNames: "Guest names",
      guestNumber: "Guest",
      attendeeEmail: "Email address",
      continueToCheckout: "Continue to secure test checkout",
      reservationSubmit: "Confirm complimentary reservation",
      checkoutSuccess: "Your test payment was received. The ticket is issued after Stripe confirms the payment by webhook.",
      checkoutCancelled: "Checkout was cancelled. The temporary place will be released automatically.",
      checkoutError: "Checkout could not be started. Please try again.",
      reservationSuccess: "Your complimentary reservation has been recorded.",
      cancellationReason: "Organizer's notice",
      date: "Date",
      venue: "Venue",
      artist: "Artist",
      capacity: "Availability",
      available: "places available",
      soldOut: "Sold out",
      price: "Admission",
      complimentary: "Complimentary",
      ticketingSoon: "Ticketing is currently unavailable for this event. No reservation has been created.",
      cancelled: "This event has been canceled by the organizer. Please contact our customer service team regarding your refund.",
      rescheduled: "This event has been rescheduled.",
      invitationEyebrow: "Private invitation",
      invitationTitle: "You are invited.",
      invitationLead: "Please confirm whether you will attend. A place is reserved only after acceptance and while capacity remains.",
      guest: "Guest",
      accept: "Accept invitation",
      decline: "Decline invitation",
      accepted: "Your invitation has been accepted. Your personal ticket has been created.",
      declined: "Your invitation has been declined and no place has been reserved.",
      answered: "This invitation has already been answered.",
      unavailable: "This invitation is no longer available.",
      privacy: "This private page is excluded from search engines. The invitation link is personal.",
      back: "View public events"
    }
  }),
  hu: Object.freeze({
    locale: "hu-HU",
    languageCode: "hu",
    languageName: "Magyar",
    alternateLabel: "EN",
    brand: {
      name: "Klavierhaus",
      wordmark: "KLAVIERHAUS",
      logoImage: shared.logo,
      addressLine1: shared.addressLines[0],
      addressLine2: shared.addressLines[1],
      phoneDisplay: shared.phoneDisplay,
      phoneHref: shared.phoneHref,
      emailDisplay: shared.emailDisplay,
      emailHref: shared.emailHref,
      footerLocations: "New York · Franciaország",
      schemaStreetAddress: "790 11th Avenue",
      schemaLocality: "New York",
      schemaRegion: "NY",
      schemaPostalCode: "10019",
      schemaCountry: "US"
    },
    brandAriaLabel: "Klavierhaus főoldal",
    logoAlt: "Klavierhaus — New York és Franciaország",
    skipLabel: "Ugrás a tartalomhoz",
    menuOpenLabel: "Menü megnyitása",
    menuCloseLabel: "Menü bezárása",
    scrollLabel: "Görgetés",
    navigationLabel: "Fő navigáció",
    nav: [
      { key: "artists", label: "Artist" },
      { key: "mission", label: "Culture" },
      { key: "pianos", label: "Piano" },
      { key: "services", label: "Service" },
      { key: "our", label: "Our" }
    ],
    consultationLabel: "Privát konzultáció",
    footerStatement: "A zene, a művészet és a kompromisszumok nélküli zongoraépítés különleges New York-i világa.",
    footerExplore: "Felfedezés",
    footerVisit: "Látogatás",
    footerLegal: "Jogi információk",
    footerOur: "Rólunk",
    footerContact: "Kapcsolat",
    footerPrivacy: "Adatkezelés",
    rights: "Minden jog fenntartva.",
    imageCredit: "A szerkesztőségi képeket a Klavierhaus jogosult adminisztrátorai kezelik.",
    backHome: "Vissza a főoldalra",
    notFoundEyebrow: "404",
    notFoundTitle: "Ez a terem nem része a háznak.",
    notFoundBody: "A kért oldal nem található. Térjen vissza a Klavierhaus világába, vagy válasszon a menüből.",
    soonLabel: "Aktuális program",
    collectionLabels: {
      reviewsEyebrow: "Vélemények",
      reviewsTitle: "A zene emléke tovább él.",
      artistsEyebrow: "Művészeink",
      artistsTitle: "Akik lélegzetet adnak a hangszernek.",
      artistFallbackRole: "Művész",
      artistProfile: "Művészprofil",
      showroomEyebrow: "Bemutatótermi zongorák",
      showroomTitle: "Kivételes hangszerek, személyes találkozásra.",
      showroomLead: "Egy zongora valódi karaktere csak a hangján és az érintésén keresztül ismerhető meg.",
      showroomCardEyebrow: "Klavierhaus bemutatóterem",
      showroomInstrumentSingular: "egyedileg válogatott hangszer a bemutatóteremben.",
      showroomInstrumentPlural: "egyedileg válogatott hangszer a bemutatóteremben.",
      showroomDiscover: "A hangszerek felfedezése",
      servicesEyebrow: "Személyre szabott gondoskodás",
      servicesTitle: "Minden hangszerhez külön figyelem tartozik.",
      servicesLead: "Díjmentes első felmérés, személyes konzultáció és a hangszerhez igazított egyedi ajánlat.",
      serviceCardEyebrow: "Klavierhaus műhely",
      serviceAssessment: "Személyes felmérés egyeztetése",
      brandLead: "A kiválasztás hallgatással kezdődik. Minden hangszer külön karakter, külön érintés és külön zenei találkozás.",
      brandPrivateSelection: "Személyes kiválasztás",
      brandCtaTitle: "Találkozzon a hangszerrel, mielőtt döntést hoz.",
      brandCta: "Privát időpont egyeztetése",
      brandInstrumentDetails: "A hangszer részletei",
      brandInstrumentViewing: "Privát megtekintés egyeztetése"
    },
    eventLabels: {
      listEyebrow: "Klavierhaus program",
      listTitle: "Meghitt találkozások a zenében.",
      listLead: "Koncertek, szalonestek, mesterkurzusok és kulturális találkozások gondosan összeállított New York-i programja.",
      upcoming: "Közelgő programok",
      homeEyebrow: "A következő találkozások",
      homeTitle: "Lépjen be a térbe, ahol a zene személyessé válik.",
      homeLead: "Meghitt előadások és kulturális találkozások gondosan válogatott sora a Klavierhausban.",
      noEvents: "Jelenleg nincs közzétett közelgő esemény.",
      details: "Részletek",
      viewAll: "Összes esemény",
      buyTickets: "Jegyvásárlás",
      reservePlace: "Helyfoglalás",
      ticketsSoon: "A jegyvásárlás jelenleg nem érhető el",
      testMode: "TESZTÜZEM",
      testModeNote: "A hét támogatott fizetési mód közül választhat. Bankkártyánál ebben a fejlesztési környezetben Stripe Sandbox indul; a többi mód a rendezés visszaigazolásáig függőben lévő foglalást hoz létre.",
      quantity: "Jegyek száma",
      attendeeName: "Teljes név",
      attendeeNames: "Vendégek neve",
      guestNumber: "Vendég",
      attendeeEmail: "E-mail-cím",
      continueToCheckout: "Tovább a biztonságos tesztfizetéshez",
      reservationSubmit: "Díjmentes helyfoglalás megerősítése",
      checkoutSuccess: "A tesztfizetés beérkezett. A jegy a Stripe webhook-visszaigazolása után készül el.",
      checkoutCancelled: "A fizetés megszakadt. Az ideiglenes helyfoglalás automatikusan felszabadul.",
      checkoutError: "A fizetés nem indítható el. Kérjük, próbálja újra.",
      reservationSuccess: "A díjmentes helyfoglalást rögzítettük.",
      cancellationReason: "A szervező tájékoztatása",
      date: "Időpont",
      venue: "Helyszín",
      artist: "Művész",
      capacity: "Elérhetőség",
      available: "szabad hely",
      soldOut: "Megtelt",
      price: "Belépőjegy",
      complimentary: "Díjmentes",
      ticketingSoon: "Ehhez az eseményhez jelenleg nem érhető el jegyvásárlás. Helyfoglalás nem történt.",
      cancelled: "Az eseményt a szervező törölte. A visszatérítéssel kapcsolatban kérjük, forduljon ügyfélszolgálatunkhoz.",
      rescheduled: "Az esemény új időpontra került.",
      invitationEyebrow: "Személyes meghívó",
      invitationTitle: "Szeretettel meghívjuk.",
      invitationLead: "Kérjük, jelezze részvételi szándékát. A hely csak elfogadás után és a szabad kapacitás erejéig kerül lefoglalásra.",
      guest: "Meghívott",
      accept: "Meghívás elfogadása",
      decline: "Meghívás visszautasítása",
      accepted: "A meghívást elfogadta. Személyes belépőjegye elkészült.",
      declined: "A meghívást visszautasította, ezért hely nem került lefoglalásra.",
      answered: "Erre a meghívásra már érkezett válasz.",
      unavailable: "Ez a meghívás már nem érhető el.",
      privacy: "Ez a személyes oldal nincs jelen a keresőkben. A meghívó hivatkozása személyre szól.",
      back: "Nyilvános események"
    }
  })
});

const pages = Object.freeze({
  en: Object.freeze({
    home: {
      template: "home",
      seo: {
        title: "Klavierhaus | A Private World of Music in New York",
        description: "Discover Klavierhaus: intimate cultural encounters, exceptional artists, remarkable pianos, restoration, and concert piano services in New York."
      },
      hero: {
        eyebrow: "New York · Music · Artistry",
        title: "Where music becomes a private world.",
        lead: "Exceptional pianos, artists, and intimate cultural encounters—shaped for those who still believe listening can change a room.",
        image: shared.heroImage,
        imageAlt: "A concert grand piano in an intimate, dark New York salon",
        primary: { label: "Enter the world of Klavierhaus", key: "events" },
        secondary: { label: "Arrange a private visit", key: "services" }
      },
      sections: [
        {
          id: "manifesto",
          type: "statement",
          eyebrow: "The house",
          title: "Not simply a place for pianos. A place for what music makes possible.",
          body: [
            "Klavierhaus brings together the expressive soul of the piano, the people who reveal it, and audiences who value closeness over spectacle.",
            "Here, craft supports culture. Every instrument, performance, and private encounter begins with attention—to tone, to touch, and to the human experience of sound."
          ],
          image: shared.salonImage,
          imageAlt: "A pianist sharing music with an intimate audience at Klavierhaus",
          link: { label: "Discover our story", key: "our" }
        },
        {
          id: "testimonial",
          type: "quote",
          quote: "For me, Klavierhaus is a musical treasure.",
          attribution: "Richard Goode"
        },
        {
          id: "culture",
          type: "visual",
          reverse: true,
          eyebrow: "Cultural mission",
          title: "Preserving the emotional language of music.",
          body: ["In a hurried world, Klavierhaus protects the rare conditions in which beauty can be heard fully: an exceptional instrument, a sensitive artist, and an audience close enough to feel every change of color."],
          image: shared.heroImage,
          imageAlt: "A grand piano illuminated in a refined private interior",
          link: { label: "Our cultural mission", key: "mission" }
        },
        {
          id: "artists",
          type: "editorial",
          eyebrow: "Artists",
          title: "The instrument is complete only when an artist gives it breath.",
          body: ["Our artist pages introduce the musicians, collaborators, and voices connected to the Klavierhaus cultural programme."],
          image: shared.artistSalonImage,
          imageAlt: "A pianist performing for an intimate audience in an elegant Klavierhaus salon",
          link: { label: "Meet the artists", key: "artists" }
        },
        {
          id: "pianos",
          type: "cards",
          eyebrow: "Exceptional instruments",
          title: "Pianos with a voice of their own.",
          intro: "Discover instruments selected, rebuilt, and prepared for their expressive character—not merely their name.",
          items: [
            { title: "The piano collection", body: "A considered selection for artists, collectors, homes, studios, and performance spaces.", link: { label: "Discover pianos", key: "pianos" } },
            { title: "Steinway pianos", body: "New York and Hamburg Steinways approached through tone, individuality, and uncompromising craft.", link: { label: "Explore Steinway", key: "steinway" } }
          ]
        },
        {
          id: "craft",
          type: "visual",
          eyebrow: "The atelier",
          title: "Craft practiced without compromise.",
          body: ["Restoration, voicing, regulation, and technical preparation exist for one purpose: to release the full emotional range of the instrument."],
          image: shared.craftImage,
          imageAlt: "Expert hands restoring the action of a grand piano",
          link: { label: "Explore our services", key: "services" }
        },
        {
          id: "consultation",
          type: "cta",
          eyebrow: "A private invitation",
          title: "Some instruments should be encountered, not described.",
          body: "Arrange a private visit to Klavierhaus in New York.",
          link: { label: "Request a private consultation", key: "consultation" }
        }
      ]
    },
    our: {
      template: "editorial",
      seo: { title: "Our | Klavierhaus New York", description: "Meet Klavierhaus: our founder, history, mission, piano craft, and cultural vision in New York." },
      hero: { eyebrow: "Our", title: "A house built around the living voice of music.", lead: "Klavierhaus brings together piano craft, artists, culture, and personal musical encounters in New York.", image: shared.heroImage, imageAlt: "Klavierhaus grand piano in an elegant New York interior" },
      sections: [
        { id: "company", type: "statement", eyebrow: "Klavierhaus", title: "Who we are.", body: ["Klavierhaus is a New York piano house devoted to exceptional instruments, uncompromising technical craft, and a cultural life shaped around attentive listening."], image: shared.salonImage, imageAlt: "Klavierhaus salon prepared for an intimate musical encounter" },
        { id: "founder", type: "visual", eyebrow: "Founder", title: "A tradition carried by people.", body: ["Use this section to introduce the founder, the people behind Klavierhaus, and the experience that shaped the company."], image: shared.artistSalonImage, imageAlt: "Portrait and musical setting representing the people behind Klavierhaus" },
        { id: "history", type: "statement", eyebrow: "History", title: "A continuing New York story.", body: ["Use this section to describe when Klavierhaus began, how the company developed, and the milestones that define its work today."], image: shared.craftImage, imageAlt: "Piano craftsmanship representing the history of Klavierhaus" },
        { id: "mission", type: "visual", reverse: true, eyebrow: "Mission", title: "Craft exists in service of music.", body: ["Use this section to explain the Klavierhaus mission, its standards, and the role the company wants to play in the musical world."], image: shared.heroImage, imageAlt: "Grand piano representing the Klavierhaus musical mission", link: { label: "Our cultural mission", key: "mission" } },
        { id: "philosophy", type: "editorial", eyebrow: "Our philosophy", title: "The sound matters because the human experience matters.", body: ["Use this section for the Klavierhaus philosophy of sound, artistry, listening, and the relationship between instrument and musician."], image: shared.salonImage, imageAlt: "Piano and listener in a refined Klavierhaus musical environment" },
        { id: "consultation", type: "cta", eyebrow: "Visit Klavierhaus", title: "Meet the house in person.", body: "Arrange a private consultation in New York.", link: { label: "Private consultation", key: "consultation" } }
      ]
    },
    pianos: {
      template: "collection",
      seo: { title: "Exceptional Pianos | Klavierhaus New York", description: "Explore Klavierhaus pianos selected and prepared for exceptional tone, touch, character, and musical expression." },
      hero: { eyebrow: "Pianos", title: "Choose a voice, not merely an instrument.", lead: "Every piano begins a different conversation with the room, the player, and the music.", image: shared.heroImage, imageAlt: "Black concert grand piano in a private salon" },
      sections: [
        { id: "selection", type: "cards", eyebrow: "The collection", title: "Instruments considered individually.", intro: "Browse the currently published instruments and arrange a private listening appointment.", items: [
          { title: "Steinway", body: "New York and Hamburg instruments, including exceptional rebuilt and performance-quality pianos.", link: { label: "Explore Steinway", key: "steinway" } },
          { title: "Restored instruments", body: "Pianos rebuilt to recover tonal color, responsiveness, and a deeply personal musical identity.", link: { label: "The restoration atelier", key: "restoration" } },
          { title: "Private selection", body: "A personal process guided by the pianist, the room, and the character of sound being sought.", link: { label: "Arrange a consultation", key: "consultation" } }
        ] },
        { id: "inventory", type: "notice", eyebrow: "Current inventory", title: "Browse the published showroom.", body: "Verified instruments, specifications, imagery, and availability are shown in the live catalogue above." }
      ]
    },
    steinway: {
      template: "editorial",
      seo: { title: "Steinway Pianos | Klavierhaus", description: "Discover New York and Hamburg Steinway pianos selected, restored, voiced, and prepared by Klavierhaus." },
      hero: { eyebrow: "Steinway", title: "A celebrated name. An entirely individual voice.", lead: "Klavierhaus approaches every Steinway as a distinct musical instrument, shaped by age, origin, construction, and the needs of its player.", image: shared.craftImage, imageAlt: "The detailed action and keys of a grand piano" },
      sections: [
        { id: "approach", type: "statement", eyebrow: "New York & Hamburg", title: "Selection begins with listening.", body: ["A model designation can describe scale and design. It cannot describe the emotional response of a particular instrument.", "Our role is to help artists and owners recognize the piano whose tone, touch, projection, and color belong in their musical life."] },
        { id: "visit", type: "cta", eyebrow: "Private selection", title: "Meet the instrument before making a decision.", body: "Arrange a private appointment in New York.", link: { label: "Request a consultation", key: "consultation" } }
      ]
    },
    services: {
      template: "collection",
      seo: { title: "Piano Services | Klavierhaus New York", description: "Klavierhaus piano restoration, tuning, technical care, and concert piano services in New York." },
      hero: { eyebrow: "Services", title: "Everything begins in service of the sound.", lead: "Technical knowledge becomes meaningful when it gives an artist greater freedom and an instrument a fuller voice.", image: shared.craftImage, imageAlt: "Expert hands working on the action of a concert grand piano" },
      sections: [
        { id: "services", type: "cards", eyebrow: "The atelier", title: "Care at every scale.", intro: "From seasonal tuning to complete rebuilding and artist-led concert preparation.", items: [
          { title: "Rebuilding & restoration", body: "Interior and exterior work, soundboard and strings, action, voicing, regulation, and refinishing.", link: { label: "Explore restoration", key: "restoration" } },
          { title: "Tuning & technical care", body: "Sensitive maintenance for homes, studios, institutions, and instruments in active performance use.", link: { label: "Explore tuning", key: "tuning" } },
          { title: "Concert piano services", body: "Performance-quality instruments and concert technicians working in dialogue with artists and venues.", link: { label: "Explore concert services", key: "concert" } }
        ] }
      ]
    },
    restoration: {
      template: "editorial",
      seo: { title: "Piano Restoration | Klavierhaus New York", description: "Uncompromising piano rebuilding and restoration: soundboard, strings, action, voicing, regulation, casework, and refinishing." },
      hero: { eyebrow: "Rebuilding & restoration", title: "Recovering the voice thought to be lost.", lead: "The Klavierhaus atelier works on the complete instrument—inside and out—with decisions guided by musical result rather than convention alone.", image: shared.craftImage, imageAlt: "Craftsman restoring the mechanism of a grand piano" },
      sections: [
        { id: "scope", type: "cards", eyebrow: "Complete care", title: "The instrument as one system.", intro: "Every component changes how the piano speaks and responds.", items: [
          { title: "Soundboard & strings", body: "Structural and tonal work shaped around sustain, clarity, resonance, and stability." },
          { title: "Action & keyboard", body: "Regulation, rebuilding, and refinement of touch, repetition, control, and dynamic response." },
          { title: "Voicing & tone", body: "Balancing power, warmth, color, projection, and the lyrical quality of the instrument." },
          { title: "Case & refinishing", body: "Respectful restoration of veneers, finishes, hardware, pedals, and the architectural presence of the piano." }
        ] },
        { id: "request", type: "cta", eyebrow: "Begin with an assessment", title: "Every restoration deserves an individual conversation.", body: "Contact Klavierhaus to arrange a private assessment.", link: { label: "Contact the atelier", key: "contact" } }
      ]
    },
    tuning: {
      template: "editorial",
      seo: { title: "Piano Tuning & Technical Care | Klavierhaus", description: "Piano tuning, voicing, regulation, and seasonal technical care for homes, studios, and performance spaces in New York." },
      hero: { eyebrow: "Tuning & care", title: "Stability is only the beginning.", lead: "A fine tuning respects pitch, but it also listens for balance, color, response, and the musical life of the room.", image: shared.craftImage, imageAlt: "Close view of expert piano technical work" },
      sections: [
        { id: "care", type: "statement", eyebrow: "Responsive maintenance", title: "Care shaped around the instrument and its environment.", body: ["Season, humidity, use, acoustics, and mechanical condition all influence a piano's stability and expression.", "Klavierhaus technical care can include tuning, voicing, regulation, diagnosis, and a longer-term maintenance strategy."] },
        { id: "request", type: "cta", eyebrow: "Technical appointment", title: "Let the instrument tell us what it needs.", body: "Speak with Klavierhaus about tuning or ongoing care.", link: { label: "Request an appointment", key: "contact" } }
      ]
    },
    concert: {
      template: "editorial",
      seo: { title: "Concert Piano Services | Klavierhaus", description: "Performance-quality concert pianos and dedicated technical preparation for selected performances and recordings." },
      hero: { eyebrow: "Concert piano services", title: "An instrument prepared around the artist.", lead: "Performance-quality Hamburg Steinway and Fazioli concert pianos, supported by technicians who listen to the performer and the room.", image: shared.salonImage, imageAlt: "Concert grand piano during an intimate recital" },
      sections: [
        { id: "performance", type: "statement", eyebrow: "Artist-led preparation", title: "Power, control, sensitivity, projection, and color—in the right proportion for the performance.", body: ["Klavierhaus works with artists in the concert hall or at the atelier to prepare the instrument around repertoire, touch, acoustic conditions, and the musical intention of the performance."] },
        { id: "request", type: "cta", eyebrow: "Performance inquiry", title: "Begin the conversation before the first rehearsal.", body: "Discuss a performance, recording, or concert piano requirement with Klavierhaus.", link: { label: "Contact concert services", key: "contact" } }
      ]
    },
    artists: {
      template: "collection",
      seo: { title: "Artists | Klavierhaus", description: "Meet the artists, collaborators, and musical voices connected to the evolving Klavierhaus cultural programme." },
      hero: { eyebrow: "Artists", title: "The people who make an instrument speak.", lead: "Klavierhaus is shaped by musicians who listen deeply—to repertoire, to one another, and to the individual character of a piano.", image: shared.salonImage, imageAlt: "Anonymous pianist performing for an intimate audience" },
      sections: [
        { id: "artist-directory", type: "notice", eyebrow: "Artist profiles", title: "Meet the artists of the Klavierhaus programme.", body: "Published profiles bring together approved biographies, portraits, programmes, and related events." },
        { id: "invitation", type: "cta", eyebrow: "Artistic dialogue", title: "A house becomes cultural through the people it welcomes.", body: "For artistic and programme enquiries, contact Klavierhaus.", link: { label: "Start a conversation", key: "contact" } }
      ]
    },
    events: {
      template: "events",
      seo: { title: "Events | Klavierhaus New York", description: "Discover intimate Klavierhaus concerts, artist encounters, masterclasses, and cultural events in New York." },
      hero: { eyebrow: "Events", title: "Closer to the music. Closer to the artist.", lead: "Klavierhaus events are conceived for intimacy: carefully chosen programmes, exceptional instruments, and a room where every detail can be heard.", image: shared.salonImage, imageAlt: "An intimate salon concert at night" },
      sections: [
        { id: "programme", type: "event", status: "Klavierhaus cultural programme", title: "The Klavierhaus Salon", meta: "New York", body: "An evolving series of intimate performances and conversations shaped around artists, instruments, and the art of close listening.", image: shared.salonImage, imageAlt: "A pianist performing in a private salon", link: { label: "Discover the salon", key: "salon" } },
        { id: "future-events", type: "notice", eyebrow: "Upcoming programme", title: "Published event details are listed above.", body: "Dates, artists, capacity, pricing, and availability are maintained in the protected event administration workspace." }
      ]
    },
    salon: {
      template: "event-detail",
      seo: { title: "The Klavierhaus Salon | Events", description: "A preview of the evolving Klavierhaus Salon: intimate music, conversation, and exceptional instruments in New York." },
      hero: { eyebrow: "Programme series", title: "The Klavierhaus Salon", lead: "A private-scale cultural format bringing artist, instrument, and audience into one attentive room.", image: shared.salonImage, imageAlt: "A small audience listening to a salon piano recital" },
      sections: [
        { id: "status", type: "notice", eyebrow: "Published programme", title: "Event details are maintained in the published programme.", body: "Verified schedules, capacity, pricing, availability, artist information, and ticket access are displayed directly from the administration system." },
        { id: "principle", type: "statement", eyebrow: "The idea", title: "A performance that feels encountered, not consumed.", body: ["The salon format values proximity, attention, and a sense of shared discovery. It is deliberately different from a large auditorium experience."] }
      ]
    },
    mission: {
      template: "editorial",
      seo: { title: "Cultural Mission | Klavierhaus", description: "Klavierhaus preserves the emotional language of music through exceptional instruments, artists, and intimate cultural encounters." },
      hero: { eyebrow: "Cultural mission", title: "To return the emotional world of music to the room.", lead: "The Klavierhaus mission is to preserve not only instruments, but the quality of attention in which music becomes personally meaningful.", image: shared.salonImage, imageAlt: "Intimate audience listening to a pianist in a dark salon" },
      sections: [
        { id: "belief", type: "statement", eyebrow: "What we believe", title: "Culture is strongest when it is felt directly.", body: ["A rare piano can carry centuries of accumulated knowledge. An artist can turn that possibility into a living moment. A close audience can feel the smallest change of tone, breath, and intention.", "Klavierhaus exists to bring these elements together—and to protect a space for beauty, curiosity, and serious listening in contemporary New York."] },
        { id: "invitation", type: "cta", eyebrow: "Enter the conversation", title: "The future of a tradition depends on those who choose to hear it.", body: "Discover the evolving programme or arrange a private visit.", link: { label: "Explore events", key: "events" } }
      ]
    },
    contact: {
      template: "contact",
      seo: { title: "Contact Klavierhaus | New York", description: "Visit or contact Klavierhaus at 790 11th Avenue, New York, for pianos, restoration, concert services, events, and private consultation." },
      hero: { eyebrow: "Contact", title: "Begin with a conversation.", lead: "Whether you are seeking an instrument, planning a performance, restoring a piano, or exploring a private cultural collaboration, Klavierhaus welcomes a considered enquiry.", image: shared.heroImage, imageAlt: "Grand piano in a refined New York interior" },
      sections: [
        { id: "contact-details", type: "contact", eyebrow: "Klavierhaus New York", title: "Visit the house.", body: "Private consultations and specialist appointments should be arranged in advance.", details: [
          { label: "Address", value: "790 11th Avenue\nNew York, NY 10019" },
          { label: "Telephone", value: shared.phoneDisplay, href: shared.phoneHref },
          { label: "Email", value: shared.emailDisplay, href: shared.emailHref }
        ] },
        { id: "consultation", type: "cta", eyebrow: "Private appointment", title: "Give the conversation the time it deserves.", body: "Arrange an individual visit or consultation with Klavierhaus.", link: { label: "Private consultation", key: "consultation" } }
      ]
    },
    privacy: {
      template: "legal",
      seo: { title: "Adatkezelés és ÁSZF | Klavierhaus", description: "A Klavierhaus adatkezelési tájékoztatója, adatvédelmi információi és általános szerződési feltételei." },
      hero: { eyebrow: "Jogi információk", title: "Adatkezelés és ÁSZF", lead: "A Klavierhaus által közzétett hivatalos adatvédelmi, adatkezelési és szerződéses információk." },
      sections: [
        { id: "adatkezeles", type: "legal", title: "Adatkezelési és adatvédelmi nyilatkozat", content: "Ide másolható be a Klavierhaus aktuális adatkezelési és adatvédelmi nyilatkozata." },
        { id: "altalanos-szerzodesi-feltetelek", type: "legal", title: "Általános szerződési feltételek", content: "Ide másolható be a Klavierhaus aktuális általános szerződési feltételeinek teljes szövege." }
      ]
    }
  })
});

function normalizePathname(value) {
  const raw = String(value || "/").split("?")[0].split("#")[0] || "/";
  if (raw === "/") return "/";
  if (raw === "/hu" || raw === "/hu/") return "/hu/";
  return `/${raw.split("/").filter(Boolean).join("/")}`;
}

function findRoute(pathname) {
  const normalized = normalizePathname(pathname);
  for (const [key, routes] of Object.entries(routeDefinitions)) {
    if (routes.en === normalized) return { key, language: "en", canonicalPath: routes.en };
    if (routes.hu === normalized) return { key, language: "hu", canonicalPath: routes.hu };
  }
  return null;
}

function getRoute(key, language) {
  const routes = routeDefinitions[key];
  return routes ? routes[language === "hu" ? "hu" : "en"] : routeDefinitions.home[language === "hu" ? "hu" : "en"];
}

function getPage(key, language) {
  const resolvedLanguage = language === "hu" ? "hu" : "en";
  return pages[resolvedLanguage][key] || null;
}

function getGlobal(language) {
  return globalCopy[language === "hu" ? "hu" : "en"];
}

function getLanguageFromPath(pathname) {
  const normalized = normalizePathname(pathname);
  return normalized === "/hu/" || normalized.startsWith("/hu/") ? "hu" : "en";
}

function getAlternateLanguage(language) {
  return language === "hu" ? "en" : "hu";
}

module.exports = {
  VERSION,
  findRoute,
  getAlternateLanguage,
  getGlobal,
  getLanguageFromPath,
  getPage,
  getRoute,
  normalizePathname,
  routeDefinitions,
  shared,
  pages,
  globalCopy
};
