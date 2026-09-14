"use strict";

const MODEL_REFERENCE = Object.freeze({
  S: { model: "S", size_cm: "155", size_in: "5'1\"", size_display: "155 cm (5'1\")" },
  M: { model: "M", size_cm: "170", size_in: "5'7\"", size_display: "170 cm (5'7\")" },
  O: { model: "O", size_cm: "180", size_in: "5'10.5\"", size_display: "180 cm (5'10.5\")" },
  L: { model: "L", size_cm: "179", size_in: "5'10.5\"", size_display: "179 cm (5'10.5\")" },
  A: { model: "A", size_cm: "188–194", size_in: "6'2\" or 6'4\"", size_display: "188–194 cm (6'2\" or 6'4\")" },
  B: { model: "B", size_cm: "211", size_in: "6'10.5\"", size_display: "211 cm (6'10.5\")" },
  C: { model: "C", size_cm: "227", size_in: "7'5\"", size_display: "227 cm (7'5\")" },
  D: { model: "D", size_cm: "274", size_in: "8'11.75\"", size_display: "274 cm (8'11.75\")" }
});

// Steinway & Sons serial-number production thresholds. Each serial marks the
// approximate beginning of production for the associated year. Lookup uses a
// floor match, equivalent to XLOOKUP(...,-1) / MATCH(...,1) on sorted data.
const SERIAL_THRESHOLDS = Object.freeze([
  [483,1853],[1000,1856],[2000,1858],[3000,1860],[5000,1861],[7000,1863],[9000,1864],[11000,1865],[13000,1866],[15000,1867],
  [17000,1868],[19000,1869],[21000,1870],[23000,1871],[25000,1872],[27000,1873],[29000,1874],[31000,1875],[33000,1876],[35000,1877],
  [40000,1878],[45000,1881],[50000,1883],[55000,1886],[60000,1887],[65000,1889],[70000,1891],[75000,1893],[80000,1894],[85000,1896],
  [90000,1898],[95000,1900],[100000,1901],[105000,1902],[110000,1904],[115000,1905],[120000,1906],[125000,1907],[130000,1908],[135000,1909],
  [140000,1910],[150000,1911],[155000,1912],[160000,1913],[165000,1914],[170000,1915],[175000,1916],[185000,1917],[190000,1918],[195000,1919],
  [200000,1920],[205000,1921],[210000,1922],[220000,1923],[225000,1924],[235000,1925],[240000,1926],[255000,1927],[260000,1928],[265000,1929],
  [270000,1930],[271000,1931],[274000,1932],[276000,1933],[278000,1934],[279000,1935],[284000,1936],[289000,1937],[290000,1938],[294000,1939],
  [300000,1940],[305000,1941],[310000,1942],[314000,1943],[316000,1944],[317000,1945],[319000,1946],[322000,1947],[324000,1948],[328000,1949],
  [331000,1950],[334000,1951],[337000,1952],[340000,1953],[343000,1954],[346500,1955],[350000,1956],[355000,1957],[358000,1958],[362000,1959],
  [366000,1960],[370000,1961],[375000,1962],[380000,1963],[385000,1964],[390000,1965],[395000,1966],[400000,1967],[405000,1968],[412000,1969],
  [418000,1970],[423000,1971],[426000,1972],[431000,1973],[436000,1974],[439000,1975],[445000,1976],[450000,1977],[455300,1978],[463000,1979],
  [468500,1980],[473500,1981],[478500,1982],[483000,1983],[488000,1984],[493000,1985],[498000,1986],[503000,1987],[507700,1988],[512600,1989],
  [516700,1990],[521000,1991],[523500,1992],[527000,1993],[530000,1994],[533500,1995],[537200,1996],[540700,1997],[545600,1998],[549600,1999],
  [554000,2000],[558000,2001],[562500,2002],[567000,2003],[571000,2004],[574500,2005],[578500,2006],[582500,2007],[584600,2008],[587500,2009],[589500,2010]
]);

function normalizeSteinwayBrand(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function isSteinwayBrand(value) {
  const brand = normalizeSteinwayBrand(value).replace(/&/g, "and");
  return brand === "steinway" || brand === "steinway and sons" || brand === "steinway & sons".replace(/&/g, "and");
}

function normalizeModel(value) {
  const raw = String(value || "").trim().toUpperCase();
  const match = raw.match(/(?:MODEL\s*)?([SMOLABCD])(?:\b|$)/);
  return match ? match[1] : "";
}

function lookupSteinwayModel(value) {
  const key = normalizeModel(value);
  return key && MODEL_REFERENCE[key] ? { ...MODEL_REFERENCE[key] } : null;
}

function parseSerialNumber(value) {
  const digits = String(value ?? "").replace(/[^0-9]/g, "");
  if (!digits) return null;
  const serial = Number.parseInt(digits, 10);
  return Number.isSafeInteger(serial) && serial > 0 ? serial : null;
}

function lookupSteinwayYear(serialNumber, registry = SERIAL_THRESHOLDS) {
  const serial = parseSerialNumber(serialNumber);
  if (!serial || serial < registry[0][0]) return null;
  let lo = 0;
  let hi = registry.length - 1;
  let matched = null;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (registry[mid][0] <= serial) {
      matched = registry[mid];
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return matched ? matched[1] : null;
}

function pianoAge(buildYear, currentYear = new Date().getFullYear()) {
  const year = Number(buildYear);
  const now = Number(currentYear);
  if (!Number.isInteger(year) || !Number.isInteger(now) || year < 1700 || year > now) return null;
  return now - year;
}

function formatAge(buildYear, language = "en", currentYear = new Date().getFullYear()) {
  const age = pianoAge(buildYear, currentYear);
  if (age === null) return "";
  if (language === "hu") return `${buildYear} (${age} éves)`;
  return `${buildYear} (${age} ${age === 1 ? "year old" : "years old"})`;
}

function ensureSteinwayReferenceTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS steinway_serial_registry (
      start_serial INTEGER PRIMARY KEY,
      build_year INTEGER NOT NULL CHECK(build_year BETWEEN 1853 AND 2100)
    );
    CREATE TABLE IF NOT EXISTS steinway_model_reference (
      model_key TEXT PRIMARY KEY,
      size_cm TEXT NOT NULL,
      size_in TEXT NOT NULL,
      size_display TEXT NOT NULL
    );
  `);
  const serialInsert = db.prepare("INSERT INTO steinway_serial_registry(start_serial,build_year) VALUES(?,?) ON CONFLICT(start_serial) DO UPDATE SET build_year=excluded.build_year");
  const modelInsert = db.prepare("INSERT INTO steinway_model_reference(model_key,size_cm,size_in,size_display) VALUES(?,?,?,?) ON CONFLICT(model_key) DO UPDATE SET size_cm=excluded.size_cm,size_in=excluded.size_in,size_display=excluded.size_display");
  db.transaction(() => {
    SERIAL_THRESHOLDS.forEach(([serial, year]) => serialInsert.run(serial, year));
    Object.values(MODEL_REFERENCE).forEach((row) => modelInsert.run(row.model, row.size_cm, row.size_in, row.size_display));
  })();
}

function lookupSteinwayYearFromDb(db, serialNumber) {
  const serial = parseSerialNumber(serialNumber);
  if (!serial || serial < 483) return null;
  const row = db.prepare("SELECT build_year FROM steinway_serial_registry WHERE start_serial<=? ORDER BY start_serial DESC LIMIT 1").get(serial);
  return row ? Number(row.build_year) : null;
}

function lookupSteinwayModelFromDb(db, model) {
  const key = normalizeModel(model);
  if (!key) return null;
  const row = db.prepare("SELECT model_key,size_cm,size_in,size_display FROM steinway_model_reference WHERE model_key=?").get(key);
  return row ? { model: row.model_key, size_cm: row.size_cm, size_in: row.size_in, size_display: row.size_display } : null;
}

function lookupSteinwayReference({ db = null, brand, model, serial_no, serialNumber, currentYear = new Date().getFullYear() } = {}) {
  const active = isSteinwayBrand(brand);
  if (!active) return { is_steinway: false, build_year: null, age: null, model_reference: null };
  const year = db ? lookupSteinwayYearFromDb(db, serial_no ?? serialNumber) : lookupSteinwayYear(serial_no ?? serialNumber);
  const modelReference = db ? lookupSteinwayModelFromDb(db, model) : lookupSteinwayModel(model);
  return {
    is_steinway: true,
    build_year: year,
    age: year ? pianoAge(year, currentYear) : null,
    model_reference: modelReference,
    size_cm: modelReference?.size_cm || null,
    size_in: modelReference?.size_in || null,
    size_display: modelReference?.size_display || null
  };
}

module.exports = {
  MODEL_REFERENCE,
  SERIAL_THRESHOLDS,
  isSteinwayBrand,
  normalizeModel,
  parseSerialNumber,
  lookupSteinwayYear,
  lookupSteinwayModel,
  pianoAge,
  formatAge,
  ensureSteinwayReferenceTables,
  lookupSteinwayYearFromDb,
  lookupSteinwayModelFromDb,
  lookupSteinwayReference
};
