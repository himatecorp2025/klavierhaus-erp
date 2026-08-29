"use strict";

/*
 * Public content contract
 * -----------------------
 * Every visible string, navigation item, image slot and SEO field lives here
 * instead of being embedded in the HTML renderer. The future ERP publishing
 * module can persist this same shape and replace this bundled fallback without
 * redesigning the public website.
 */

const VERSION = "1.2.0";

const routeDefinitions = Object.freeze({
  home: { en: "/", hu: "/hu/" },
  story: { en: "/story", hu: "/hu/tortenetunk" },
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
  consultation: { en: "/private-consultation", hu: "/hu/privat-konzultacio" },
  privacy: { en: "/privacy", hu: "/hu/adatkezeles" },
  ticketTerms: { en: "/ticket-terms", hu: "/hu/jegyvasarlasi-feltetelek" }
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
      { key: "events", label: "Events" },
      { key: "artists", label: "Artists" },
      { key: "mission", label: "Culture" },
      { key: "pianos", label: "Pianos" },
      { key: "services", label: "Services" }
    ],
    consultationLabel: "Private consultation",
    footerStatement: "A private world of music, artistry, and uncompromising piano craft in New York.",
    footerExplore: "Explore",
    footerVisit: "Visit",
    footerLegal: "Legal",
    footerStory: "Our story",
    footerContact: "Contact",
    footerPrivacy: "Privacy",
    footerTerms: "Ticket & refund terms",
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
      brandInstrumentDetails: "Explore the instrument"
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
      testModeNote: "Stripe Sandbox checkout. No real charge will be made.",
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
      { key: "events", label: "Események" },
      { key: "artists", label: "Művészek" },
      { key: "mission", label: "Kultúra" },
      { key: "pianos", label: "Zongorák" },
      { key: "services", label: "Szolgáltatások" }
    ],
    consultationLabel: "Privát konzultáció",
    footerStatement: "A zene, a művészet és a kompromisszumok nélküli zongoraépítés különleges New York-i világa.",
    footerExplore: "Felfedezés",
    footerVisit: "Látogatás",
    footerLegal: "Jogi információk",
    footerStory: "Történetünk",
    footerContact: "Kapcsolat",
    footerPrivacy: "Adatkezelés",
    footerTerms: "Jegyvásárlási és visszatérítési feltételek",
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
      brandInstrumentDetails: "A hangszer részletei"
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
      testModeNote: "Stripe Sandbox fizetés. Valódi terhelés nem történik.",
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
          link: { label: "Discover our story", key: "story" }
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
    story: {
      template: "editorial",
      seo: { title: "Our Story | Klavierhaus New York", description: "Discover the Klavierhaus legacy of expressive piano craft, restoration, and cultural life in New York." },
      hero: { eyebrow: "Our story", title: "A quiet musical renaissance in New York.", lead: "For more than three decades, Klavierhaus has pursued a simple but demanding idea: a piano should carry color, poetry, and a human voice.", image: shared.heroImage, imageAlt: "A concert grand piano in a refined Klavierhaus-inspired interior" },
      sections: [
        { id: "legacy", type: "statement", eyebrow: "Legacy", title: "A living craft, carried forward.", body: ["At the heart of Klavierhaus is the knowledge of master craftsman Sujatri Reisinger, whose work draws on the expressive traditions of historic European and American instruments.", "The aim is not nostalgia. It is to preserve what is eternally valuable in a piano—lyricism, color, sensitivity, and the ability to answer the hands and imagination of the pianist."] },
        { id: "future", type: "visual", eyebrow: "The next movement", title: "Tradition becomes meaningful when it is shared.", body: ["Klavierhaus is preparing its legacy for a new generation of craftspeople, artists, collectors, and listeners."], image: shared.craftImage, imageAlt: "Piano craftsmanship in a dark, elegant atelier", link: { label: "Our cultural mission", key: "mission" } }
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
    consultation: {
      template: "contact",
      seo: { title: "Private Consultation | Klavierhaus", description: "Arrange a private Klavierhaus consultation for piano selection, restoration, concert services, or cultural collaboration in New York." },
      hero: { eyebrow: "Private consultation", title: "An individual encounter with sound, craft, and possibility.", lead: "The right instrument or collaboration is rarely found through specifications alone. A private consultation begins with listening—to you, to the room, and to the piano.", image: shared.heroImage, imageAlt: "Concert grand piano prepared for a private consultation" },
      sections: [
        { id: "what-to-expect", type: "cards", eyebrow: "A considered process", title: "Designed around the reason for your visit.", intro: "Consultations may concern piano selection, restoration, concert requirements, or a cultural collaboration.", items: [
          { title: "Piano selection", body: "Explore touch, tone, scale, room, repertoire, and the emotional character you are seeking." },
          { title: "Restoration", body: "Discuss the instrument's condition, history, musical potential, and an appropriate scope of work." },
          { title: "Concert & culture", body: "Consider artist needs, venue acoustics, programme intentions, and the form of the encounter." }
        ] },
        { id: "arrange", type: "contact", eyebrow: "Arrange your visit", title: "Klavierhaus New York", body: "Contact us directly to arrange a private consultation.", details: [
          { label: "Telephone", value: shared.phoneDisplay, href: shared.phoneHref },
          { label: "Email", value: shared.emailDisplay, href: shared.emailHref },
          { label: "Address", value: "790 11th Avenue\nNew York, NY 10019" }
        ] }
      ]
    },
    privacy: {
      template: "legal",
      seo: { title: "Privacy | Klavierhaus", description: "Development-stage privacy information for the new Klavierhaus public website." },
      hero: { eyebrow: "Legal", title: "Privacy information", lead: "Development-stage notice for the temporary Klavierhaus public website." },
      sections: [
        { id: "privacy-status", type: "legal", title: "Current development status", paragraphs: ["This temporary website provides Stripe Sandbox test checkout without live payment. Service enquiries and event-interest requests can be submitted through the active forms; the information entered is transmitted to the Klavierhaus administration system for follow-up.", "Optional analytics and marketing measurement remain disabled until the visitor gives the corresponding consent. Standard technical server logs may process information required to deliver and protect the website, such as request time, requested resource, browser information, and network address."], list: ["Essential storage supports the requested website functions. Analytics and marketing technologies are controlled separately in Tracking settings.", "The public website remains marked noindex during development.", "A complete, legally reviewed privacy notice must be published before the final klavierhaus.com launch and live payments.", "Questions may be sent to info@klavierhaus.com."], note: "This development notice describes the current test environment and must receive legal review before launch." }
      ]
    },
    ticketTerms: {
      template: "legal",
      seo: { title: "Ticket & Refund Terms | Klavierhaus", description: "Development draft of the Klavierhaus event ticket and refund rules." },
      hero: { eyebrow: "Legal", title: "Ticket and refund terms", lead: "Development draft reflecting the agreed event rules. Checkout is available only in Stripe Sandbox test mode." },
      sections: [
        { id: "terms-draft", type: "legal", title: "Agreed operating principles", paragraphs: ["Public paid tickets will become valid only after a successful Stripe payment. Cash and pay-at-the-door reservations are excluded.", "General admission capacity applies; there is no numbered seating plan."], list: ["If Klavierhaus cancels an event, the ticket price is refunded in full.", "If Klavierhaus reschedules an event, the ticket remains valid; a refund may be requested until more than 48 hours before the new start time.", "If the purchaser cancels more than 48 hours before the event, a refund is available.", "At exactly 48 hours or less before the event, purchaser cancellation and non-attendance are not refundable.", "Partial refunds are not offered.", "Admission is managed from the protected guest list."], note: "Stripe Sandbox transactions do not move real money. This draft must receive legal review before live ticket sales are enabled." }
      ]
    }
  }),
  hu: Object.freeze({
    home: {
      template: "home",
      seo: {
        title: "Klavierhaus | A zene különleges világa New Yorkban",
        description: "Fedezze fel a Klavierhaus világát: intim kulturális találkozások, kivételes művészek, különleges zongorák és kompromisszumok nélküli szakmai munka New Yorkban."
      },
      hero: {
        eyebrow: "New York · Zene · Művészet",
        title: "Ahol a zene különleges világgá válik.",
        lead: "Kivételes zongorák, művészek és bensőséges kulturális találkozások azok számára, akik szerint a valódi figyelem egy egész termet képes megváltoztatni.",
        image: shared.heroImage,
        imageAlt: "Koncertzongora egy bensőséges, sötét New York-i szalonban",
        primary: { label: "Belépés a Klavierhaus világába", key: "events" },
        secondary: { label: "Privát látogatás egyeztetése", key: "services" }
      },
      sections: [
        { id: "manifesto", type: "statement", eyebrow: "A ház", title: "Nem egyszerűen a zongorák helye. Annak a helye, amit a zene lehetővé tesz.", body: ["A Klavierhaus egyesíti a zongora kifejező lelkületét, az azt megszólaltató művészeket és a látványosság helyett valódi közelséget kereső közönséget.", "Itt a mesterség a kultúrát szolgálja. Minden hangszer, előadás és személyes találkozás alapja a figyelem: a hangszínre, az érintésre és a hang emberi élményére."], image: shared.salonImage, imageAlt: "Zongoraművész és közönsége egy meghitt Klavierhaus eseményen", link: { label: "Történetünk", key: "story" } },
        { id: "testimonial", type: "quote", quote: "Számomra a Klavierhaus igazi zenei kincs.", attribution: "Richard Goode" },
        { id: "culture", type: "visual", reverse: true, eyebrow: "Kulturális küldetés", title: "Megőrizni a zene érzelmi nyelvét.", body: ["Egy rohanó világban a Klavierhaus védi azokat a ritka feltételeket, amelyek között a szépség teljességében hallható: egy kivételes hangszer, egy érzékeny művész és egy közönség, amely elég közel van minden színváltozás érzékeléséhez."], image: shared.heroImage, imageAlt: "Elegáns privát térben megvilágított koncertzongora", link: { label: "Kulturális küldetésünk", key: "mission" } },
        { id: "artists", type: "editorial", eyebrow: "Művészek", title: "A hangszer akkor válik teljessé, amikor a művész lélegzetet ad neki.", body: ["Művészoldalainkon a Klavierhaus kulturális programjához kapcsolódó zenészeket, alkotótársakat és művészi hangokat mutatjuk be."], image: shared.artistSalonImage, imageAlt: "Zongoraművész bensőséges közönség előtt egy elegáns Klavierhaus szalonban", link: { label: "Művészeink", key: "artists" } },
        { id: "pianos", type: "cards", eyebrow: "Kivételes hangszerek", title: "Zongorák saját hanggal.", intro: "Fedezzen fel olyan hangszereket, amelyeket kifejező karakterük — és nem csupán nevük — alapján választottunk, építettünk újjá és készítettünk elő.", items: [
          { title: "Zongoragyűjtemény", body: "Gondosan válogatott hangszerek művészeknek, gyűjtőknek, otthonokba, stúdiókba és koncerttermekbe.", link: { label: "Zongorák felfedezése", key: "pianos" } },
          { title: "Steinway-zongorák", body: "New York-i és hamburgi Steinway hangszerek, a hangszín, az egyéniség és a kompromisszumok nélküli mesterség felől megközelítve.", link: { label: "Steinway-zongorák", key: "steinway" } }
        ] },
        { id: "craft", type: "visual", eyebrow: "A műhely", title: "Mesterség kompromisszumok nélkül.", body: ["A restaurálás, az intonálás, a szabályozás és a technikai előkészítés egyetlen célt szolgál: felszabadítani a hangszer teljes érzelmi tartományát."], image: shared.craftImage, imageAlt: "Szakértő kezek egy koncertzongora mechanikájának restaurálása közben", link: { label: "Szolgáltatásaink", key: "services" } },
        { id: "consultation", type: "cta", eyebrow: "Személyes meghívás", title: "Vannak hangszerek, amelyeket nem leírni, hanem megtapasztalni kell.", body: "Egyeztessen privát látogatást a New York-i Klavierhausba.", link: { label: "Privát konzultáció kérése", key: "consultation" } }
      ]
    },
    story: {
      template: "editorial",
      seo: { title: "Történetünk | Klavierhaus New York", description: "Ismerje meg a Klavierhaus örökségét: kifejező zongoraépítés, restaurálás és kulturális élet New Yorkban." },
      hero: { eyebrow: "Történetünk", title: "Csendes zenei reneszánsz New Yorkban.", lead: "A Klavierhaus több mint három évtizede követ egy egyszerű, mégis rendkívül igényes gondolatot: a zongorának színt, költészetet és emberi hangot kell hordoznia.", image: shared.heroImage, imageAlt: "Koncertzongora elegáns, Klavierhaus-hangulatú térben" },
      sections: [
        { id: "legacy", type: "statement", eyebrow: "Örökség", title: "Élő mesterség, amely tovább öröklődik.", body: ["A Klavierhaus középpontjában Sujatri Reisinger mester tudása áll, akinek munkája történelmi európai és amerikai hangszerek kifejező hagyományára épül.", "A cél nem a múlt utánzása. Az a feladat, hogy megőrizzük mindazt, ami örök értékű egy zongorában: a líraiságot, a színeket, az érzékenységet, valamint a képességet, hogy válaszoljon a zongorista kezére és képzeletére."] },
        { id: "future", type: "visual", eyebrow: "A következő tétel", title: "A hagyomány akkor válik jelentőssé, amikor megosztjuk.", body: ["A Klavierhaus örökségét a mesterek, művészek, gyűjtők és hallgatók következő nemzedéke számára készíti elő."], image: shared.craftImage, imageAlt: "Zongoraépítő mesterség egy sötét, elegáns műhelyben", link: { label: "Kulturális küldetésünk", key: "mission" } }
      ]
    },
    pianos: {
      template: "collection",
      seo: { title: "Kivételes zongorák | Klavierhaus New York", description: "Fedezze fel a Klavierhaus hangszereit, amelyeket kivételes hang, billentés, karakter és zenei kifejezés alapján választunk és készítünk elő." },
      hero: { eyebrow: "Zongorák", title: "Ne csupán hangszert, hanem hangot válasszon.", lead: "Minden zongora más beszélgetést kezd a térrel, a zongoristával és a zenével.", image: shared.heroImage, imageAlt: "Fekete koncertzongora egy privát szalonban" },
      sections: [
        { id: "selection", type: "cards", eyebrow: "A gyűjtemény", title: "Egyedileg megismert hangszerek.", intro: "Böngésszen a jelenleg publikált hangszerek között, és egyeztessen privát meghallgatást.", items: [
          { title: "Steinway", body: "New York-i és hamburgi hangszerek, köztük kivételesen újjáépített és koncertminőségű zongorák.", link: { label: "Steinway-zongorák", key: "steinway" } },
          { title: "Restaurált hangszerek", body: "A hangszín, az érzékenység és a személyes zenei karakter visszanyerésére újjáépített zongorák.", link: { label: "A restaurátorműhely", key: "restoration" } },
          { title: "Privát kiválasztás", body: "Személyes folyamat, amelyet a zongorista, a tér és a keresett hang karaktere vezet.", link: { label: "Konzultáció egyeztetése", key: "consultation" } }
        ] },
        { id: "inventory", type: "notice", eyebrow: "Aktuális készlet", title: "Böngésszen a publikált bemutatóteremben.", body: "A fenti katalógusban ellenőrzött hangszerek, műszaki adatok, képek és elérhetőség látható." }
      ]
    },
    steinway: {
      template: "editorial",
      seo: { title: "Steinway-zongorák | Klavierhaus", description: "New York-i és hamburgi Steinway-zongorák, amelyeket a Klavierhaus választ ki, restaurál, intonál és készít elő." },
      hero: { eyebrow: "Steinway", title: "Világhírű név. Teljesen egyéni hang.", lead: "A Klavierhaus minden Steinway-zongorát önálló hangszerként közelít meg, amelyet kora, eredete, konstrukciója és zongoristájának igényei formálnak.", image: shared.craftImage, imageAlt: "Egy koncertzongora mechanikájának és billentyűzetének részlete" },
      sections: [
        { id: "approach", type: "statement", eyebrow: "New York és Hamburg", title: "A kiválasztás a hallgatással kezdődik.", body: ["A modellszám leírhatja a hangszer méretét és konstrukcióját. Egy konkrét zongora érzelmi válaszát azonban nem.", "Feladatunk segíteni a művészt vagy tulajdonost annak a zongorának a felismerésében, amelynek hangja, billentése, ereje és színvilága helyet kap az életében."] },
        { id: "visit", type: "cta", eyebrow: "Személyes kiválasztás", title: "Találkozzon a hangszerrel, mielőtt döntést hoz.", body: "Egyeztessen privát időpontot New Yorkban.", link: { label: "Konzultáció kérése", key: "consultation" } }
      ]
    },
    services: {
      template: "collection",
      seo: { title: "Zongoraszolgáltatások | Klavierhaus New York", description: "Klavierhaus zongorarestaurálás, hangolás, technikai gondoskodás és koncertzongora-szolgáltatás New Yorkban." },
      hero: { eyebrow: "Szolgáltatások", title: "Minden a hang szolgálatában kezdődik.", lead: "A technikai tudás akkor válik jelentőssé, amikor nagyobb szabadságot ad a művésznek és teljesebb hangot a hangszernek.", image: shared.craftImage, imageAlt: "Szakértő kezek egy koncertzongora mechanikáján dolgoznak" },
      sections: [
        { id: "services", type: "cards", eyebrow: "A műhely", title: "Gondoskodás minden léptékben.", intro: "Az évszakos hangolástól a teljes újjáépítésen át a művésszel közösen végzett koncert-előkészítésig.", items: [
          { title: "Újjáépítés és restaurálás", body: "Külső és belső munkák, rezonánslap és húrok, mechanika, intonálás, szabályozás és felületkezelés.", link: { label: "Restaurálás", key: "restoration" } },
          { title: "Hangolás és technikai gondoskodás", body: "Érzékeny karbantartás otthonok, stúdiók, intézmények és aktívan használt koncertzongorák számára.", link: { label: "Hangolás", key: "tuning" } },
          { title: "Koncertzongora-szolgáltatás", body: "Koncertminőségű hangszerek és a művésszel, illetve a helyszínnel együtt dolgozó koncerttechnikusok.", link: { label: "Koncertszolgáltatások", key: "concert" } }
        ] }
      ]
    },
    restoration: {
      template: "editorial",
      seo: { title: "Zongorarestaurálás | Klavierhaus New York", description: "Kompromisszumok nélküli zongora-újjáépítés és restaurálás: rezonánslap, húrozat, mechanika, intonálás, szabályozás, szekrény és felületkezelés." },
      hero: { eyebrow: "Újjáépítés és restaurálás", title: "Visszahozni az elveszettnek hitt hangot.", lead: "A Klavierhaus műhelye a teljes hangszeren dolgozik — kívül és belül —, döntéseit pedig minden esetben a zenei eredmény vezeti.", image: shared.craftImage, imageAlt: "Mester egy koncertzongora mechanikájának restaurálása közben" },
      sections: [
        { id: "scope", type: "cards", eyebrow: "Teljes körű gondoskodás", title: "A hangszer egyetlen összefüggő rendszer.", intro: "Minden alkatrész hatással van arra, hogyan szólal meg és hogyan válaszol a zongora.", items: [
          { title: "Rezonáns és húrozat", body: "Szerkezeti és hangzásbeli munka a kitartás, a tisztaság, a rezonancia és a stabilitás érdekében." },
          { title: "Mechanika és billentyűzet", body: "A billentés, az ismétlés, az irányíthatóság és a dinamikai válasz szabályozása, újjáépítése és finomítása." },
          { title: "Intonálás és hang", body: "Az erő, a melegség, a színek, a kivetítés és a hangszer lírai minőségének kiegyensúlyozása." },
          { title: "Szekrény és felület", body: "A furnér, a felület, a szerelvények, a pedálok és a zongora térbeli jelenlétének tiszteletteljes helyreállítása." }
        ] },
        { id: "request", type: "cta", eyebrow: "Felméréssel kezdjük", title: "Minden restaurálás egyéni beszélgetést érdemel.", body: "Lépjen kapcsolatba a Klavierhausszal személyes állapotfelmérésért.", link: { label: "Kapcsolat a műhellyel", key: "contact" } }
      ]
    },
    tuning: {
      template: "editorial",
      seo: { title: "Zongorahangolás és technikai gondoskodás | Klavierhaus", description: "Zongorahangolás, intonálás, szabályozás és évszakos technikai gondoskodás New York-i otthonok, stúdiók és koncerthelyszínek számára." },
      hero: { eyebrow: "Hangolás és gondoskodás", title: "A stabilitás csupán a kezdet.", lead: "A kiváló hangolás tiszteletben tartja a hangmagasságot, de figyel az egyensúlyra, a színekre, a válaszkészségre és a tér zenei életére is.", image: shared.craftImage, imageAlt: "Szakértő zongoratechnikai munka közelről" },
      sections: [
        { id: "care", type: "statement", eyebrow: "Érzékeny karbantartás", title: "A hangszerhez és környezetéhez igazított gondoskodás.", body: ["Az évszak, a páratartalom, a használat, az akusztika és a mechanikai állapot egyaránt befolyásolja a zongora stabilitását és kifejezőerejét.", "A Klavierhaus technikai gondoskodása hangolást, intonálást, szabályozást, diagnosztikát és hosszabb távú karbantartási stratégiát is magában foglalhat."] },
        { id: "request", type: "cta", eyebrow: "Technikai időpont", title: "Hagyjuk, hogy a hangszer elmondja, mire van szüksége.", body: "Egyeztessen a Klavierhausszal hangolásról vagy folyamatos gondoskodásról.", link: { label: "Időpont kérése", key: "contact" } }
      ]
    },
    concert: {
      template: "editorial",
      seo: { title: "Koncertzongora-szolgáltatás | Klavierhaus", description: "Koncertminőségű hangszerek és személyre szabott technikai előkészítés válogatott előadásokhoz és felvételekhez." },
      hero: { eyebrow: "Koncertzongora-szolgáltatás", title: "A művész köré előkészített hangszer.", lead: "Koncertminőségű hamburgi Steinway és Fazioli zongorák, olyan technikusok támogatásával, akik a művészre és a térre is figyelnek.", image: shared.salonImage, imageAlt: "Koncertzongora egy bensőséges zongoraesten" },
      sections: [
        { id: "performance", type: "statement", eyebrow: "Művészvezérelt előkészítés", title: "Erő, kontroll, érzékenység, kivetítés és szín — az előadáshoz szükséges arányban.", body: ["A Klavierhaus a koncertteremben vagy a műhelyben dolgozik együtt a művésszel, hogy a hangszert a repertoárhoz, a billentéshez, az akusztikai feltételekhez és az előadás zenei szándékához igazítsa."] },
        { id: "request", type: "cta", eyebrow: "Koncertmegkeresés", title: "Kezdjük el a beszélgetést az első próba előtt.", body: "Egyeztessen előadásról, felvételről vagy koncertzongora-igényről a Klavierhausszal.", link: { label: "Kapcsolat a koncertszolgáltatással", key: "contact" } }
      ]
    },
    artists: {
      template: "collection",
      seo: { title: "Művészek | Klavierhaus", description: "Ismerje meg a Klavierhaus folyamatosan épülő kulturális programjához kapcsolódó művészeket, alkotótársakat és zenei hangokat." },
      hero: { eyebrow: "Művészek", title: "Az emberek, akik megszólaltatják a hangszert.", lead: "A Klavierhaust olyan zenészek formálják, akik mélyen figyelnek a repertoárra, egymásra és minden zongora egyedi karakterére.", image: shared.salonImage, imageAlt: "Névtelen zongorista bensőséges közönség előtt" },
      sections: [
        { id: "artist-directory", type: "notice", eyebrow: "Művészprofilok", title: "Ismerje meg a Klavierhaus programjának művészeit.", body: "A publikált profilokon jóváhagyott életrajzok, portrék, programok és kapcsolódó események jelennek meg." },
        { id: "invitation", type: "cta", eyebrow: "Művészeti párbeszéd", title: "Egy házat azok az emberek tesznek kulturálissá, akiket befogad.", body: "Művészeti és programmegkeresésekkel forduljon a Klavierhaushoz.", link: { label: "Beszélgetés indítása", key: "contact" } }
      ]
    },
    events: {
      template: "events",
      seo: { title: "Események | Klavierhaus New York", description: "Fedezze fel a Klavierhaus bensőséges koncertjeit, művészeti találkozásait, mesterkurzusait és kulturális eseményeit New Yorkban." },
      hero: { eyebrow: "Események", title: "Közelebb a zenéhez. Közelebb a művészhez.", lead: "A Klavierhaus eseményei a közelségre épülnek: gondosan választott programok, kivételes hangszerek és egy tér, ahol minden részlet hallható.", image: shared.salonImage, imageAlt: "Bensőséges esti szalonkoncert" },
      sections: [
        { id: "programme", type: "event", status: "Klavierhaus kulturális program", title: "A Klavierhaus Szalon", meta: "New York", body: "Bensőséges előadások és beszélgetések folyamatosan alakuló sorozata a művészek, a hangszerek és az elmélyült hallgatás művészete köré építve.", image: shared.salonImage, imageAlt: "Zongorista egy privát szalonban", link: { label: "A szalon felfedezése", key: "salon" } },
        { id: "future-events", type: "notice", eyebrow: "Közelgő program", title: "A publikált eseményadatok fent láthatók.", body: "A dátumokat, művészeket, férőhelyet, árat és elérhetőséget a védett eseménykezelő munkaterület tartja karban." }
      ]
    },
    salon: {
      template: "event-detail",
      seo: { title: "A Klavierhaus Szalon | Események", description: "A formálódó Klavierhaus Szalon előzetese: bensőséges zene, beszélgetés és kivételes hangszerek New Yorkban." },
      hero: { eyebrow: "Programsorozat", title: "A Klavierhaus Szalon", lead: "Privát léptékű kulturális forma, amely egyetlen figyelmes térben kapcsolja össze a művészt, a hangszert és a közönséget.", image: shared.salonImage, imageAlt: "Kis közönség egy szalonzongora-est előadásán" },
      sections: [
        { id: "status", type: "notice", eyebrow: "Publikált program", title: "Az esemény részletei a közzétett programban láthatók.", body: "Az ellenőrzött időpontok, férőhelyek, árak, elérhetőség, művészadatok és jegyvásárlás közvetlenül az adminrendszerből jelennek meg." },
        { id: "principle", type: "statement", eyebrow: "Az alapgondolat", title: "Egy előadás, amelyet nem elfogyasztunk, hanem megtapasztalunk.", body: ["A szalonforma a közelséget, a figyelmet és a közös felfedezés élményét helyezi előtérbe. Tudatosan különbözik a nagyszínházi élménytől."] }
      ]
    },
    mission: {
      template: "editorial",
      seo: { title: "Kulturális küldetés | Klavierhaus", description: "A Klavierhaus kivételes hangszereken, művészeken és bensőséges kulturális találkozásokon keresztül őrzi meg a zene érzelmi nyelvét." },
      hero: { eyebrow: "Kulturális küldetés", title: "Visszahozni a zene érzelmi világát a terembe.", lead: "A Klavierhaus küldetése nemcsak a hangszerek, hanem annak a figyelemnek a megőrzése is, amelyben a zene személyesen jelentőssé válik.", image: shared.salonImage, imageAlt: "Bensőséges közönség hallgat egy zongoristát egy sötét szalonban" },
      sections: [
        { id: "belief", type: "statement", eyebrow: "Amiben hiszünk", title: "A kultúra akkor a legerősebb, amikor közvetlenül érezhető.", body: ["Egy ritka zongora évszázadok felhalmozott tudását hordozhatja. Egy művész ezt a lehetőséget élő pillanattá formálhatja. A közeli közönség pedig megérezheti a hang, a lélegzet és a szándék legkisebb változását is.", "A Klavierhaus azért létezik, hogy ezeket az elemeket összekapcsolja, és helyet őrizzen a szépség, a kíváncsiság és az elmélyült hallgatás számára a kortárs New Yorkban."] },
        { id: "invitation", type: "cta", eyebrow: "Csatlakozás a párbeszédhez", title: "Egy hagyomány jövője azokon múlik, akik meghallják.", body: "Fedezze fel a formálódó programot, vagy egyeztessen privát látogatást.", link: { label: "Események felfedezése", key: "events" } }
      ]
    },
    contact: {
      template: "contact",
      seo: { title: "Kapcsolat | Klavierhaus New York", description: "Látogassa meg vagy keresse a Klavierhaust a New York-i 790 11th Avenue címen zongorák, restaurálás, koncertszolgáltatások, események és privát konzultáció ügyében." },
      hero: { eyebrow: "Kapcsolat", title: "Kezdjük egy beszélgetéssel.", lead: "Akár hangszert keres, előadást tervez, zongorát restauráltatna vagy privát kulturális együttműködésben gondolkodik, a Klavierhaus minden komoly megkeresést örömmel fogad.", image: shared.heroImage, imageAlt: "Koncertzongora elegáns New York-i enteriőrben" },
      sections: [
        { id: "contact-details", type: "contact", eyebrow: "Klavierhaus New York", title: "Látogassa meg a házat.", body: "Privát konzultációhoz és szakmai találkozóhoz előzetes időpont-egyeztetés szükséges.", details: [
          { label: "Cím", value: "790 11th Avenue\nNew York, NY 10019" },
          { label: "Telefon", value: shared.phoneDisplay, href: shared.phoneHref },
          { label: "E-mail", value: shared.emailDisplay, href: shared.emailHref }
        ] },
        { id: "consultation", type: "cta", eyebrow: "Privát időpont", title: "Adjuk meg a beszélgetésnek a szükséges időt.", body: "Egyeztessen egyéni látogatást vagy konzultációt a Klavierhausszal.", link: { label: "Privát konzultáció", key: "consultation" } }
      ]
    },
    consultation: {
      template: "contact",
      seo: { title: "Privát konzultáció | Klavierhaus", description: "Egyeztessen privát Klavierhaus-konzultációt zongoraválasztáshoz, restauráláshoz, koncertszolgáltatáshoz vagy kulturális együttműködéshez New Yorkban." },
      hero: { eyebrow: "Privát konzultáció", title: "Személyes találkozás a hanggal, a mesterséggel és a lehetőségekkel.", lead: "A megfelelő hangszer vagy együttműködés ritkán található meg pusztán műszaki adatokból. A privát konzultáció az Ön, a tér és a zongora meghallgatásával kezdődik.", image: shared.heroImage, imageAlt: "Privát konzultációra előkészített koncertzongora" },
      sections: [
        { id: "what-to-expect", type: "cards", eyebrow: "Átgondolt folyamat", title: "A látogatás céljához igazítva.", intro: "A konzultáció zongoraválasztásra, restaurálásra, koncertigényre vagy kulturális együttműködésre is irányulhat.", items: [
          { title: "Zongoraválasztás", body: "Billentés, hangszín, méret, tér, repertoár és a keresett érzelmi karakter közös felfedezése." },
          { title: "Restaurálás", body: "A hangszer állapotának, történetének, zenei lehetőségeinek és a megfelelő munkatartalomnak az átbeszélése." },
          { title: "Koncert és kultúra", body: "A művészi igények, a helyszín akusztikája, a program szándéka és a találkozás formájának megtervezése." }
        ] },
        { id: "arrange", type: "contact", eyebrow: "Időpont-egyeztetés", title: "Klavierhaus New York", body: "Keressen minket közvetlenül. Csapatunk személyesen egyezteti a konzultáció részleteit.", details: [
          { label: "Telefon", value: shared.phoneDisplay, href: shared.phoneHref },
          { label: "E-mail", value: shared.emailDisplay, href: shared.emailHref },
          { label: "Cím", value: "790 11th Avenue\nNew York, NY 10019" }
        ] }
      ]
    },
    privacy: {
      template: "legal",
      seo: { title: "Adatkezelés | Klavierhaus", description: "A Klavierhaus új nyilvános weboldalának fejlesztési adatkezelési tájékoztatója." },
      hero: { eyebrow: "Jogi információk", title: "Adatkezelési tájékoztató", lead: "Fejlesztési tájékoztató a Klavierhaus ideiglenes nyilvános weboldalához." },
      sections: [
        { id: "privacy-status", type: "legal", title: "Jelenlegi fejlesztési állapot", paragraphs: ["Az ideiglenes weboldal Stripe Sandbox tesztfizetést biztosít valódi pénzmozgás nélkül. A szolgáltatási érdeklődések és az események újraszervezésére vonatkozó kérések az aktív űrlapokon elküldhetők; a megadott adatok utánkövetés céljából a Klavierhaus adminisztrációs rendszerébe kerülnek.", "Az opcionális analitikai és marketingmérés mindaddig kikapcsolva marad, amíg a látogató az adott célhoz hozzá nem járul. A weboldal működéséhez és védelméhez szükséges szabványos technikai szervernaplók kezelhetnek olyan adatokat, mint a kérés időpontja, a kért erőforrás, a böngésző adatai és a hálózati cím."], list: ["A szükséges tárolás a kért weboldalfunkciókat biztosítja. Az analitikai és marketingtechnológiák külön vezérelhetők a Követési beállításokban.", "A nyilvános weboldal a fejlesztés alatt noindex állapotban marad.", "A végleges klavierhaus.com indulása és az éles fizetés előtt teljes, jogilag ellenőrzött adatkezelési tájékoztatót kell közzétenni.", "Kérdés esetén az info@klavierhaus.com cím használható."], note: "Ez a fejlesztési tájékoztató a jelenlegi tesztkörnyezetet írja le, és indulás előtt jogi ellenőrzést igényel." }
      ]
    },
    ticketTerms: {
      template: "legal",
      seo: { title: "Jegyvásárlási és visszatérítési feltételek | Klavierhaus", description: "A Klavierhaus eseményjegyekre és visszatérítésre vonatkozó fejlesztési szabálytervezete." },
      hero: { eyebrow: "Jogi információk", title: "Jegyvásárlási és visszatérítési feltételek", lead: "A megállapodott eseményszabályokat tükröző fejlesztési tervezet. A fizetési folyamat kizárólag Stripe Sandbox tesztüzemben érhető el." },
      sections: [
        { id: "terms-draft", type: "legal", title: "Elfogadott működési alapelvek", paragraphs: ["A nyilvános fizetős jegy kizárólag sikeres Stripe-fizetés után válik érvényessé. Készpénzes és helyszínen fizetendő foglalás nem lesz.", "Általános férőhelyes rendszer működik, számozott ülésrend nélkül."], list: ["Ha a Klavierhaus törli az eseményt, a teljes jegyár visszatérítésre kerül.", "Ha a Klavierhaus áthelyezi az eseményt, a jegy érvényes marad; visszatérítés az új kezdés előtt több mint 48 óráig kérhető.", "Ha a vásárló több mint 48 órával az esemény előtt mondja le, visszatérítés jár.", "Pontosan 48 órával vagy azon belül a vásárlói lemondás és a távolmaradás nem visszatéríthető.", "Részleges visszatérítés nincs.", "A beléptetés a védett vendéglista alapján történik."], note: "A Stripe Sandbox-tranzakciók nem mozgatnak valódi pénzt. Az éles jegyértékesítés előtt ez a tervezet jogi ellenőrzést igényel." }
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
