"use strict";
// Optional planning suggestions. Snapshot into tasks; never mutate existing work.
module.exports = {
  "INBOUND": [
    {
      "id": "INBOUND-1",
      "name_en": "Arrange intake",
      "name_hu": "\u00c1tv\u00e9tel egyeztet\u00e9se"
    },
    {
      "id": "INBOUND-2",
      "name_en": "Identify instrument",
      "name_hu": "Hangszerazonos\u00edt\u00e1s"
    },
    {
      "id": "INBOUND-3",
      "name_en": "Verify physical location",
      "name_hu": "Helysz\u00edn \u00e9s c\u00edm ellen\u0151rz\u00e9se"
    },
    {
      "id": "INBOUND-4",
      "name_en": "Record accessories",
      "name_hu": "Tartoz\u00e9kok \u00e1tv\u00e9tele"
    },
    {
      "id": "INBOUND-5",
      "name_en": "Record damage and photos",
      "name_hu": "S\u00e9r\u00fcl\u00e9sek \u00e9s fot\u00f3k r\u00f6gz\u00edt\u00e9se"
    },
    {
      "id": "INBOUND-6",
      "name_en": "Create intake condition report",
      "name_hu": "Indul\u00f3 \u00e1llapotlap elk\u00e9sz\u00edt\u00e9se"
    }
  ],
  "ASSESSMENT": [
    {
      "id": "ASSESSMENT-1",
      "name_en": "Inspect acoustic structure",
      "name_hu": "Akusztikus szerkezet vizsg\u00e1lata"
    },
    {
      "id": "ASSESSMENT-2",
      "name_en": "Inspect action and keyboard",
      "name_hu": "Mechanika \u00e9s billenty\u0171zet vizsg\u00e1lata"
    },
    {
      "id": "ASSESSMENT-3",
      "name_en": "Inspect pedals and dampers",
      "name_hu": "Ped\u00e1l- \u00e9s tomp\u00edt\u00f3rendszer vizsg\u00e1lata"
    },
    {
      "id": "ASSESSMENT-4",
      "name_en": "Define repairs and replacement parts",
      "name_hu": "Jav\u00edtand\u00f3 \u00e9s cser\u00e9lend\u0151 elemek meghat\u00e1roz\u00e1sa"
    },
    {
      "id": "ASSESSMENT-5",
      "name_en": "Prepare repair plan and parts list",
      "name_hu": "Jav\u00edt\u00e1si terv \u00e9s alkatr\u00e9szig\u00e9ny"
    }
  ],
  "ACOUSTICS": [
    {
      "id": "ACOUSTICS-1",
      "name_en": "Repair soundboard",
      "name_hu": "Rezon\u00e1nslap jav\u00edt\u00e1sa"
    },
    {
      "id": "ACOUSTICS-2",
      "name_en": "Replace soundboard",
      "name_hu": "Rezon\u00e1nslap cser\u00e9je"
    },
    {
      "id": "ACOUSTICS-3",
      "name_en": "Repair bridges",
      "name_hu": "Hidak jav\u00edt\u00e1sa"
    },
    {
      "id": "ACOUSTICS-4",
      "name_en": "Repair pinblock",
      "name_hu": "Hangol\u00f3t\u0151ke jav\u00edt\u00e1sa"
    },
    {
      "id": "ACOUSTICS-5",
      "name_en": "Replace pinblock",
      "name_hu": "Hangol\u00f3t\u0151ke cser\u00e9je"
    },
    {
      "id": "ACOUSTICS-6",
      "name_en": "Restore plate finish",
      "name_hu": "\u00d6nt\u00f6ttvas keret fel\u00fclet\u00e9nek helyre\u00e1ll\u00edt\u00e1sa"
    },
    {
      "id": "ACOUSTICS-7",
      "name_en": "Replace tuning pins and strings",
      "name_hu": "Hangol\u00f3sz\u00f6gek \u00e9s h\u00farok cser\u00e9je"
    }
  ],
  "MECHANICS": [
    {
      "id": "MECHANICS-1",
      "name_en": "Rebush keys and repair key coverings",
      "name_hu": "Billenty\u0171zet perselyez\u00e9se \u00e9s bor\u00edt\u00e1s jav\u00edt\u00e1sa"
    },
    {
      "id": "MECHANICS-2",
      "name_en": "Repair hammers and action parts",
      "name_hu": "Kalap\u00e1csfejek \u00e9s mechanikaalkatr\u00e9szek jav\u00edt\u00e1sa"
    },
    {
      "id": "MECHANICS-3",
      "name_en": "Replace hammers and action parts",
      "name_hu": "Kalap\u00e1csfejek \u00e9s mechanikaalkatr\u00e9szek cser\u00e9je"
    },
    {
      "id": "MECHANICS-4",
      "name_en": "Restore damper system",
      "name_hu": "Tomp\u00edt\u00f3rendszer fel\u00faj\u00edt\u00e1sa"
    },
    {
      "id": "MECHANICS-5",
      "name_en": "Repair pedal mechanism",
      "name_hu": "Ped\u00e1lmechanika jav\u00edt\u00e1sa"
    }
  ],
  "VOICING": [
    {
      "id": "VOICING-1",
      "name_en": "Regulate action",
      "name_hu": "Mechanika finomszab\u00e1lyoz\u00e1sa"
    },
    {
      "id": "VOICING-2",
      "name_en": "Adjust pedals and dampers",
      "name_hu": "Ped\u00e1l \u00e9s tomp\u00edt\u00e1s be\u00e1ll\u00edt\u00e1sa"
    },
    {
      "id": "VOICING-3",
      "name_en": "Tune piano",
      "name_hu": "Hangol\u00e1s"
    },
    {
      "id": "VOICING-4",
      "name_en": "Voice piano",
      "name_hu": "Inton\u00e1l\u00e1s"
    },
    {
      "id": "VOICING-5",
      "name_en": "Stabilization tuning after restringing",
      "name_hu": "Stabiliz\u00e1l\u00f3 hangol\u00e1s \u00faj h\u00faroz\u00e1s ut\u00e1n"
    }
  ],
  "FINISH": [
    {
      "id": "FINISH-1",
      "name_en": "Repair veneer",
      "name_hu": "Furn\u00e9rjav\u00edt\u00e1s"
    },
    {
      "id": "FINISH-2",
      "name_en": "Repair wooden case parts",
      "name_hu": "Faelemek jav\u00edt\u00e1sa"
    },
    {
      "id": "FINISH-3",
      "name_en": "Restore finish",
      "name_hu": "Fel\u00fclet helyre\u00e1ll\u00edt\u00e1sa"
    },
    {
      "id": "FINISH-4",
      "name_en": "Apply high-gloss finish",
      "name_hu": "F\u00e9nyes fel\u00fclet kialak\u00edt\u00e1sa"
    },
    {
      "id": "FINISH-5",
      "name_en": "Apply satin finish",
      "name_hu": "Selyemf\u00e9ny\u0171 fel\u00fclet kialak\u00edt\u00e1sa"
    }
  ],
  "FINAL_HANDOVER": [
    {
      "id": "FINAL_HANDOVER-1",
      "name_en": "Final functional test",
      "name_hu": "V\u00e9gs\u0151 m\u0171k\u00f6d\u00e9si pr\u00f3ba"
    },
    {
      "id": "FINAL_HANDOVER-2",
      "name_en": "Resolve outstanding defects",
      "name_hu": "Hibajegyz\u00e9k lez\u00e1r\u00e1sa"
    },
    {
      "id": "FINAL_HANDOVER-3",
      "name_en": "Document completed work",
      "name_hu": "Elk\u00e9sz\u00fclt munk\u00e1k dokument\u00e1l\u00e1sa"
    },
    {
      "id": "FINAL_HANDOVER-4",
      "name_en": "Arrange handover",
      "name_hu": "\u00c1tad\u00e1s egyeztet\u00e9se"
    },
    {
      "id": "FINAL_HANDOVER-5",
      "name_en": "Deliver piano",
      "name_hu": "Kisz\u00e1ll\u00edt\u00e1s"
    },
    {
      "id": "FINAL_HANDOVER-6",
      "name_en": "Confirm receipt",
      "name_hu": "\u00c1tv\u00e9tel visszaigazol\u00e1sa"
    }
  ]
};
