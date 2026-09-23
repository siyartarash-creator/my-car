// ============================================
// دیتابیس کامل خودروهای ایران
// ساختار: برند → مدل → تیپ → سال
// ============================================

export type CarBrandCategory =
  | "iranian"
  | "chinese"
  | "foreign"
  | "commercial"
  | "motorcycle";

export type CarTrim = {
  id: string;
  name: string;
  years: number[];
  cylinders?: number;
  power?: number;          // اسب بخار
  gearbox?: string;
  engineVolume?: number;   // cc
};

export type CarModel = {
  id: string;
  name: string;
  manufacturer?: string;   // سازنده
  trims: CarTrim[];
};

export type CarBrand = {
  id: string;
  name: string;
  category: CarBrandCategory;
  logo?: string;
  models: CarModel[];
};

export const carBrands: CarBrand[] = [
  // ============================================
  // ایران خودرو
  // ============================================
  {
    id: "peugeot",
    name: "پژو",
    category: "iranian",
    models: [
      {
        id: "peugeot-405",
        name: "پژو ۴۰۵",
        manufacturer: "ایران خودرو",
        trims: [
          { id: "405-glx", name: "GLX", years: [1372,1373,1374,1375,1376,1377,1378,1379,1380,1381,1382,1383,1384,1385,1386,1387,1388,1389,1390,1391,1392,1393,1394,1395,1396,1397,1398,1399,1400], cylinders: 4, power: 94, gearbox: "دستی ۵ دنده", engineVolume: 1761 },
          { id: "405-slx", name: "SLX", years: [1372,1373,1374,1375,1376,1377,1378,1379,1380,1381,1382,1383,1384,1385,1386,1387,1388,1389,1390], cylinders: 4, power: 94, gearbox: "دستی ۵ دنده", engineVolume: 1761 },
          { id: "405-glx-cng", name: "GLX دوگانه‌سوز", years: [1380,1381,1382,1383,1384,1385,1386,1387,1388,1389,1390,1391,1392,1393,1394,1395,1396,1397,1398,1399,1400], cylinders: 4, power: 94, gearbox: "دستی ۵ دنده", engineVolume: 1761 },
        ],
      },
      {
        id: "peugeot-pars",
        name: "پژو پارس (پرشیا)",
        manufacturer: "ایران خودرو",
        trims: [
          { id: "pars-lx", name: "LX", years: [1379,1380,1381,1382,1383,1384,1385,1386,1387,1388,1389,1390,1391,1392,1393,1394,1395,1396,1397,1398,1399,1400,1401,1402,1403], cylinders: 4, power: 94, gearbox: "دستی ۵ دنده", engineVolume: 1761 },
          { id: "pars-sadeh", name: "ساده", years: [1379,1380,1381,1382,1383,1384,1385,1386,1387,1388,1389,1390,1391,1392,1393,1394,1395,1396,1397,1398,1399,1400,1401,1402,1403], cylinders: 4, gearbox: "دستی ۵ دنده", engineVolume: 1761 },
          { id: "pars-lx-cng", name: "LX دوگانه‌سوز", years: [1385,1386,1387,1388,1389,1390,1391,1392,1393,1394,1395,1396,1397,1398,1399,1400,1401,1402,1403], cylinders: 4, power: 94, gearbox: "دستی ۵ دنده", engineVolume: 1761 },
          { id: "pars-elx-at", name: "ELX اتوماتیک", years: [1398,1399,1400,1401,1402,1403], cylinders: 4, gearbox: "اتومات CVT", engineVolume: 1700 },
        ],
      },
      {
        id: "peugeot-206",
        name: "پژو ۲۰۶ (هاچبک)",
        manufacturer: "ایران خودرو",
        trims: [
          { id: "206-type2", name: "تیپ ۲", years: [1380,1381,1382,1383,1384,1385,1386,1387,1388,1389,1390,1391,1392,1393,1394,1395,1396,1397,1398,1399,1400,1401,1402,1403], cylinders: 4, power: 90, gearbox: "دستی ۵ دنده", engineVolume: 1360 },
          { id: "206-type3", name: "تیپ ۳", years: [1380,1381,1382,1383,1384,1385,1386,1387,1388,1389,1390], cylinders: 4, power: 90, gearbox: "دستی ۵ دنده", engineVolume: 1360 },
          { id: "206-type5", name: "تیپ ۵ / ۶", years: [1380,1381,1382,1383,1384,1385,1386,1387,1388,1389,1390,1391,1392,1393,1394,1395,1396,1397,1398,1399,1400,1401,1402,1403], cylinders: 4, power: 90, gearbox: "دستی ۵ دنده", engineVolume: 1587 },
          { id: "206-type7", name: "تیپ ۷ (اتوماتیک)", years: [1390,1391,1392,1393,1394,1395,1396], cylinders: 4, gearbox: "اتومات", engineVolume: 1587 },
          { id: "206-type9", name: "تیپ ۹", years: [1392,1393,1394,1395,1396,1397,1398,1399,1400], cylinders: 4, gearbox: "دستی ۵ دنده", engineVolume: 1587 },
        ],
      },
      {
        id: "peugeot-206-sd",
        name: "پژو ۲۰۶ صندوق‌دار (SD)",
        manufacturer: "ایران خودرو",
        trims: [
          { id: "206-sd-v8", name: "V8 / V9", years: [1385,1386,1387,1388,1389,1390,1391,1392,1393,1394,1395,1396,1397,1398,1399,1400,1401,1402,1403], cylinders: 4, power: 98, gearbox: "دستی ۵ دنده", engineVolume: 1587 },
        ],
      },
      {
        id: "peugeot-207i",
        name: "پژو ۲۰۷i",
        manufacturer: "ایران خودرو",
        trims: [
          { id: "207i", name: "اتوماتیک / دستی", years: [1390,1391,1392,1393,1394,1395,1396,1397,1398], cylinders: 4, gearbox: "دستی / اتومات", engineVolume: 1587 },
        ],
      },
      {
        id: "peugeot-207-mc",
        name: "پژو ۲۰۷ صندوق‌دار (MC)",
        manufacturer: "ایران خودرو",
        trims: [
          { id: "207-mc", name: "استاندارد", years: [1394,1395,1396,1397,1398,1399,1400], cylinders: 4, gearbox: "دستی ۵ دنده", engineVolume: 1587 },
        ],
      },
      {
        id: "peugeot-roa",
        name: "پژو روآ (ROA)",
        manufacturer: "ایران خودرو",
        trims: [
          { id: "roa", name: "استاندارد", years: [1396,1397,1398,1399,1400], cylinders: 4, gearbox: "دستی" },
        ],
      },
      {
        id: "peugeot-2008",
        name: "پژو ۲۰۰۸",
        manufacturer: "ایران خودرو",
        trims: [
          { id: "2008-at", name: "اتوماتیک", years: [1400,1401,1402,1403], cylinders: 4, gearbox: "اتومات", engineVolume: 1600 },
        ],
      },
      {
        id: "peugeot-508",
        name: "پژو ۵۰۸ (وارداتی)",
        manufacturer: "ایران خودرو",
        trims: [
          { id: "508", name: "اتوماتیک", years: [1394,1395,1396,1397,1398], cylinders: 4, gearbox: "اتومات", engineVolume: 1600 },
        ],
      },
      {
        id: "peugeot-301",
        name: "پژو ۳۰۱ (وارداتی)",
        manufacturer: "ایران خودرو",
        trims: [
          { id: "301", name: "استاندارد", years: [1393,1394,1395,1396], cylinders: 4, gearbox: "دستی / اتومات", engineVolume: 1600 },
        ],
      },
    ],
  },
  {
    id: "peykan",
    name: "پیکان",
    category: "iranian",
    models: [
      {
        id: "peykan-base",
        name: "پیکان",
        manufacturer: "ایران خودرو",
        trims: [
          { id: "peykan-deluxe", name: "دلوکس / آردی", years: [1346,1347,1348,1349,1350,1351,1352,1353,1354,1355,1356,1357,1358,1359,1360,1361,1362,1363,1364,1365,1366,1367,1368,1369,1370,1371,1372,1373,1374,1375,1376,1377,1378,1379,1380,1381,1382,1383,1384], cylinders: 4, power: 65, gearbox: "دستی ۴ دنده", engineVolume: 1725 },
        ],
      },
    ],
  },
  {
    id: "samand",
    name: "سمند",
    category: "iranian",
    models: [
      {
        id: "samand-lx",
        name: "سمند LX",
        manufacturer: "ایران خودرو",
        trims: [
          { id: "samand-lx-xu7", name: "XU7", years: [1380,1381,1382,1383,1384,1385,1386,1387,1388,1389,1390], cylinders: 4, power: 94, gearbox: "دستی ۵ دنده", engineVolume: 1761 },
          { id: "samand-lx-ef7", name: "EF7", years: [1387,1388,1389,1390,1391,1392,1393,1394,1395,1396,1397,1398,1399,1400,1401,1402,1403], cylinders: 4, power: 109, gearbox: "دستی ۵ دنده", engineVolume: 1700 },
          { id: "samand-lx-cng", name: "LX دوگانه‌سوز", years: [1385,1386,1387,1388,1389,1390,1391,1392,1393,1394,1395,1396,1397,1398,1399,1400,1401,1402,1403], cylinders: 4, power: 109, gearbox: "دستی ۵ دنده", engineVolume: 1700 },
        ],
      },
      {
        id: "samand-soren",
        name: "سمند سورن",
        manufacturer: "ایران خودرو",
        trims: [
          { id: "soren-elx", name: "ELX", years: [1385,1386,1387,1388,1389,1390,1391,1392,1393,1394,1395,1396], cylinders: 4, power: 109, gearbox: "دستی ۵ دنده", engineVolume: 1700 },
        ],
      },
      {
        id: "samand-soren-plus",
        name: "سمند سورن پلاس",
        manufacturer: "ایران خودرو",
        trims: [
          { id: "soren-plus", name: "ELX", years: [1396,1397,1398,1399,1400,1401,1402,1403], cylinders: 4, power: 113, gearbox: "دستی ۵ دنده", engineVolume: 1700 },
        ],
      },
    ],
  },
  {
    id: "dena",
    name: "دنا",
    category: "iranian",
    models: [
      {
        id: "dena-base",
        name: "دنا",
        manufacturer: "ایران خودرو",
        trims: [
          { id: "dena-t1", name: "تیپ ۱", years: [1393,1394,1395,1396,1397,1398,1399,1400,1401,1402,1403], cylinders: 4, power: 113, gearbox: "دستی ۵ دنده", engineVolume: 1700 },
        ],
      },
      {
        id: "dena-plus",
        name: "دنا پلاس (غیر توربو)",
        manufacturer: "ایران خودرو",
        trims: [
          { id: "dena-plus-base", name: "ساده", years: [1396,1397,1398,1399,1400,1401], cylinders: 4, power: 113, gearbox: "دستی ۵ دنده", engineVolume: 1700 },
        ],
      },
      {
        id: "dena-plus-turbo",
        name: "دنا پلاس توربو",
        manufacturer: "ایران خودرو",
        trims: [
          { id: "dena-turbo-mt", name: "دستی", years: [1396,1397,1398,1399,1400,1401,1402,1403], cylinders: 4, power: 150, gearbox: "دستی ۶ دنده", engineVolume: 1500 },
          { id: "dena-turbo-at", name: "اتوماتیک", years: [1397,1398,1399,1400,1401,1402,1403], cylinders: 4, power: 150, gearbox: "اتومات ۶ سرعته", engineVolume: 1500 },
        ],
      },
    ],
  },
  {
    id: "rana",
    name: "رانا",
    category: "iranian",
    models: [
      {
        id: "rana-base",
        name: "رانا",
        manufacturer: "ایران خودرو",
        trims: [
          { id: "rana-lx", name: "LX", years: [1393,1394,1395,1396,1397,1398,1399,1400,1401,1402,1403], cylinders: 4, power: 98, gearbox: "دستی ۵ دنده", engineVolume: 1587 },
        ],
      },
      {
        id: "rana-plus",
        name: "رانا پلاس",
        manufacturer: "ایران خودرو",
        trims: [
          { id: "rana-plus-base", name: "استاندارد", years: [1399,1400,1401,1402,1403], cylinders: 4, gearbox: "دستی / اتومات", engineVolume: 1587 },
        ],
      },
    ],
  },
  {
    id: "tara",
    name: "تارا",
    category: "iranian",
    models: [
      {
        id: "tara-base",
        name: "تارا",
        manufacturer: "ایران خودرو",
        trims: [
          { id: "tara-mt", name: "دستی", years: [1399,1400,1401,1402,1403], cylinders: 4, power: 113, gearbox: "دستی ۶ دنده", engineVolume: 1700 },
          { id: "tara-at", name: "اتوماتیک", years: [1400,1401,1402,1403], cylinders: 4, power: 150, gearbox: "اتومات", engineVolume: 1500 },
        ],
      },
    ],
  },
  {
    id: "haima",
    name: "هایما",
    category: "iranian",
    models: [
      {
        id: "haima-s5",
        name: "هایما S5",
        manufacturer: "ایران خودرو",
        trims: [
          { id: "haima-s5-at", name: "اتوماتیک", years: [1396,1397,1398,1399,1400,1401,1402,1403], cylinders: 4, gearbox: "اتومات", engineVolume: 1800 },
        ],
      },
      {
        id: "haima-s7",
        name: "هایما S7",
        manufacturer: "ایران خودرو",
        trims: [
          { id: "haima-s7-at", name: "اتوماتیک", years: [1395,1396,1397,1398,1399,1400,1401,1402,1403], cylinders: 4, gearbox: "اتومات", engineVolume: 2000 },
          { id: "haima-s7-turbo", name: "S7 توربو پلاس", years: [1398,1399,1400,1401,1402,1403], cylinders: 4, gearbox: "اتومات", engineVolume: 2000 },
        ],
      },
      {
        id: "haima-x7",
        name: "هایما X7",
        manufacturer: "ایران خودرو",
        trims: [
          { id: "haima-x7-at", name: "اتوماتیک", years: [1400,1401,1402,1403], cylinders: 4, gearbox: "اتومات" },
        ],
      },
      {
        id: "haima-8s",
        name: "هایما ۸S",
        manufacturer: "ایران خودرو",
        trims: [
          { id: "haima-8s", name: "اتوماتیک", years: [1401,1402,1403], cylinders: 4, gearbox: "اتومات" },
        ],
      },
    ],
  },
  {
    id: "arisan",
    name: "وانت آریسان",
    category: "iranian",
    models: [
      {
        id: "arisan-base",
        name: "وانت آریسان",
        manufacturer: "ایران خودرو",
        trims: [
          { id: "arisan-cng", name: "دوگانه‌سوز", years: [1387,1388,1389,1390,1391,1392,1393,1394,1395,1396,1397,1398,1399,1400,1401], cylinders: 4, power: 86, gearbox: "دستی ۵ دنده", engineVolume: 1700 },
          { id: "arisan-2", name: "وانت آریسان ۲", years: [1401,1402,1403], cylinders: 4, gearbox: "دستی ۵ دنده", engineVolume: 1700 },
        ],
      },
    ],
  },
  {
    id: "suzuki",
    name: "سوزوکی",
    category: "foreign",
    models: [
      {
        id: "suzuki-vitara",
        name: "سوزوکی ویتارا (مونتاژ)",
        manufacturer: "ایران خودرو",
        trims: [
          { id: "vitara-ir", name: "اتوماتیک", years: [1394,1395,1396,1397,1398], cylinders: 4, gearbox: "اتومات", engineVolume: 1600 },
        ],
      },
    ],
  },

  // ============================================
  // سایپا
  // ============================================
  {
    id: "pride",
    name: "پراید",
    category: "iranian",
    models: [
      {
        id: "pride-saba",
        name: "پراید صبا",
        manufacturer: "سایپا",
        trims: [
          { id: "saba", name: "GTX / GTXi", years: [1370,1371,1372,1373,1374,1375,1376,1377,1378,1379,1380,1381,1382,1383,1384], cylinders: 4, gearbox: "دستی ۵ دنده", engineVolume: 1323 },
        ],
      },
      {
        id: "pride-nasim",
        name: "پراید نسیم",
        manufacturer: "سایپا",
        trims: [
          { id: "nasim", name: "GLX", years: [1378,1379,1380,1381,1382,1383,1384,1385,1386,1387,1388], cylinders: 4, power: 63, gearbox: "دستی ۵ دنده", engineVolume: 1323 },
        ],
      },
      {
        id: "pride-131",
        name: "پراید ۱۳۱",
        manufacturer: "سایپا",
        trims: [
          { id: "131-se", name: "SE / TL", years: [1384,1385,1386,1387,1388,1389,1390,1391,1392,1393,1394,1395,1396,1397,1398,1399,1400], cylinders: 4, power: 71, gearbox: "دستی ۵ دنده", engineVolume: 1323 },
        ],
      },
      {
        id: "pride-132",
        name: "پراید ۱۳۲",
        manufacturer: "سایپا",
        trims: [
          { id: "132-se", name: "SE", years: [1386,1387,1388,1389,1390,1391,1392,1393,1394,1395,1396,1397,1398], cylinders: 4, power: 71, gearbox: "دستی ۵ دنده", engineVolume: 1323 },
        ],
      },
      {
        id: "pride-111",
        name: "پراید ۱۱۱",
        manufacturer: "سایپا",
        trims: [
          { id: "111-se", name: "SE", years: [1388,1389,1390,1391,1392,1393,1394,1395,1396,1397,1398,1399], cylinders: 4, power: 71, gearbox: "دستی ۵ دنده", engineVolume: 1323 },
        ],
      },
      {
        id: "pride-141",
        name: "پراید ۱۴۱ (وانت)",
        manufacturer: "سایپا",
        trims: [
          { id: "141", name: "وانت", years: [1378,1379,1380,1381,1382,1383,1384,1385,1386,1387,1388,1389,1390,1391,1392,1393,1394,1395,1396,1397,1398,1399,1400], cylinders: 4, gearbox: "دستی ۵ دنده", engineVolume: 1323 },
        ],
      },
      {
        id: "pride-151",
        name: "پراید ۱۵۱ (وانت)",
        manufacturer: "سایپا",
        trims: [
          { id: "151", name: "وانت", years: [1393,1394,1395,1396,1397,1398,1399,1400], cylinders: 4, power: 82, gearbox: "دستی ۵ دنده", engineVolume: 1323 },
        ],
      },
      {
        id: "pride-gtxi",
        name: "پراید GTXi (انژکتوری)",
        manufacturer: "سایپا",
        trims: [
          { id: "gtxi", name: "GTXi", years: [1376,1377,1378,1379,1380,1381,1382,1383,1384], cylinders: 4, power: 63, gearbox: "دستی ۵ دنده", engineVolume: 1323 },
        ],
      },
    ],
  },
  {
    id: "tiba",
    name: "تیبا",
    category: "iranian",
    models: [
      {
        id: "tiba-1",
        name: "تیبا (تیبا ۱)",
        manufacturer: "سایپا",
        trims: [
          { id: "tiba1", name: "SX / EX", years: [1390,1391,1392,1393,1394,1395,1396], cylinders: 4, power: 93, gearbox: "دستی ۵ دنده", engineVolume: 1497 },
        ],
      },
      {
        id: "tiba-2",
        name: "تیبا ۲",
        manufacturer: "سایپا",
        trims: [
          { id: "tiba2", name: "SX / EX", years: [1392,1393,1394,1395,1396,1397,1398,1399,1400,1401], cylinders: 4, power: 93, gearbox: "دستی ۵ دنده", engineVolume: 1497 },
        ],
      },
      {
        id: "tiba-2-plus",
        name: "تیبا ۲ پلاس",
        manufacturer: "سایپا",
        trims: [
          { id: "tiba2plus", name: "EX", years: [1399,1400,1401], cylinders: 4, gearbox: "دستی ۵ دنده", engineVolume: 1497 },
        ],
      },
    ],
  },
  {
    id: "saina",
    name: "ساینا",
    category: "iranian",
    models: [
      {
        id: "saina-base",
        name: "ساینا",
        manufacturer: "سایپا",
        trims: [
          { id: "saina-mt", name: "S / EX", years: [1395,1396,1397,1398,1399,1400,1401,1402,1403], cylinders: 4, power: 93, gearbox: "دستی ۵ دنده", engineVolume: 1452 },
          { id: "saina-at", name: "اتوماتیک", years: [1399,1400,1401,1402,1403], cylinders: 4, gearbox: "اتومات CVT", engineVolume: 1452 },
        ],
      },
    ],
  },
  {
    id: "quick",
    name: "کوییک",
    category: "iranian",
    models: [
      {
        id: "quick-base",
        name: "کوییک",
        manufacturer: "سایپا",
        trims: [
          { id: "quick-s", name: "S", years: [1397,1398,1399,1400,1401,1402,1403], cylinders: 4, power: 93, gearbox: "دستی ۵ دنده", engineVolume: 1452 },
          { id: "quick-r", name: "R", years: [1398,1399,1400,1401,1402,1403], cylinders: 4, gearbox: "دستی ۵ دنده", engineVolume: 1452 },
          { id: "quick-at", name: "اتوماتیک", years: [1399,1400,1401,1402,1403], cylinders: 4, gearbox: "اتومات CVT", engineVolume: 1452 },
        ],
      },
    ],
  },
  {
    id: "shahin",
    name: "شاهین",
    category: "iranian",
    models: [
      {
        id: "shahin-base",
        name: "شاهین",
        manufacturer: "سایپا",
        trims: [
          { id: "shahin-g", name: "G", years: [1400,1401,1402,1403], cylinders: 4, power: 110, gearbox: "دستی / اتومات CVT", engineVolume: 1598 },
        ],
      },
    ],
  },
  {
    id: "atlas",
    name: "اطلس",
    category: "iranian",
    models: [
      {
        id: "atlas-base",
        name: "اطلس",
        manufacturer: "سایپا",
        trims: [
          { id: "atlas-ex", name: "EX", years: [1401,1402,1403], cylinders: 4, power: 96, gearbox: "دستی ۵ دنده", engineVolume: 1497 },
        ],
      },
    ],
  },
  {
    id: "ario",
    name: "آریو",
    category: "iranian",
    models: [
      {
        id: "ario-base",
        name: "آریو (لایسنس کیا سراتو)",
        manufacturer: "سایپا",
        trims: [
          { id: "ario-1600", name: "1600", years: [1395,1396,1397,1398,1399,1400], cylinders: 4, gearbox: "دستی / اتومات" },
          { id: "ario-2000", name: "2000", years: [1395,1396,1397,1398,1399,1400], cylinders: 4, gearbox: "دستی / اتومات" },
        ],
      },
    ],
  },
  {
    id: "saipa-aria",
    name: "سایپا آریا",
    category: "iranian",
    models: [
      {
        id: "saipa-aria-base",
        name: "سایپا آریا (کراس‌اوور)",
        manufacturer: "سایپا",
        trims: [
          { id: "saipa-aria-at", name: "اتوماتیک", years: [1401,1402,1403], cylinders: 4, gearbox: "اتومات (گیربکس DAE)", engineVolume: 2000 },
        ],
      },
    ],
  },
  {
    id: "kia-pride",
    name: "کیا پراید",
    category: "iranian",
    models: [
      {
        id: "kia-pride-base",
        name: "کیا پراید (لایسنس اولیه)",
        manufacturer: "سایپا",
        trims: [
          { id: "kia-pride", name: "استاندارد", years: [1370,1371,1372,1373,1374,1375,1376,1377,1378], cylinders: 4, gearbox: "دستی", engineVolume: 1323 },
        ],
      },
    ],
  },
  {
    id: "changan",
    name: "چانگان",
    category: "chinese",
    models: [
      {
        id: "changan-cs35",
        name: "چانگان CS35",
        manufacturer: "سایپا / کرمان موتور",
        trims: [
          { id: "cs35", name: "اتوماتیک", years: [1394,1395,1396,1397,1398,1399], cylinders: 4, gearbox: "اتومات", engineVolume: 1600 },
        ],
      },
      {
        id: "changan-eado",
        name: "چانگان ایدو (Eado)",
        manufacturer: "کرمان موتور",
        trims: [
          { id: "eado", name: "اتوماتیک", years: [1396,1397,1398,1399], cylinders: 4, gearbox: "اتومات", engineVolume: 1600 },
        ],
      },
    ],
  },
  {
    id: "citroen",
    name: "سیتروئن",
    category: "foreign",
    models: [
      {
        id: "citroen-c3",
        name: "سیتروئن C3 (مونتاژ)",
        manufacturer: "سایپا",
        trims: [
          { id: "c3", name: "اتوماتیک", years: [1395,1396,1397,1398], cylinders: 3, gearbox: "اتومات", engineVolume: 1200 },
        ],
      },
    ],
  },

  // ============================================
  // پارس خودرو
  // ============================================
  {
    id: "renault",
    name: "رنو",
    category: "foreign",
    models: [
      {
        id: "renault-l90",
        name: "رنو تندر ۹۰ (L90)",
        manufacturer: "پارس خودرو",
        trims: [
          { id: "l90-e0", name: "E0 / E1 / E2", years: [1386,1387,1388,1389,1390,1391,1392,1393,1394,1395,1396,1397,1398,1399,1400], cylinders: 4, power: 94, gearbox: "دستی ۵ دنده", engineVolume: 1598 },
        ],
      },
      {
        id: "renault-sandero",
        name: "رنو ساندرو",
        manufacturer: "پارس خودرو",
        trims: [
          { id: "sandero", name: "دستی / اتوماتیک", years: [1393,1394,1395,1396,1397,1398], cylinders: 4, gearbox: "دستی / اتومات", engineVolume: 1598 },
        ],
      },
      {
        id: "renault-sandero-stepway",
        name: "رنو ساندرو استپ‌وی",
        manufacturer: "پارس خودرو",
        trims: [
          { id: "sandero-stepway", name: "اتوماتیک", years: [1394,1395,1396,1397,1398], cylinders: 4, gearbox: "اتومات", engineVolume: 1598 },
        ],
      },
    ],
  },
  {
    id: "brilliance",
    name: "برلیانس",
    category: "chinese",
    models: [
      {
        id: "brilliance-h320",
        name: "برلیانس H320",
        manufacturer: "پارس خودرو",
        trims: [
          { id: "h320", name: "دستی / اتوماتیک", years: [1392,1393,1394,1395,1396,1397,1398], cylinders: 4, gearbox: "دستی / اتومات", engineVolume: 1500 },
        ],
      },
      {
        id: "brilliance-h330",
        name: "برلیانس H330",
        manufacturer: "پارس خودرو",
        trims: [
          { id: "h330", name: "دستی / اتوماتیک", years: [1393,1394,1395,1396,1397,1398], cylinders: 4, gearbox: "دستی / اتومات", engineVolume: 1500 },
        ],
      },
      {
        id: "brilliance-h220",
        name: "برلیانس H220",
        manufacturer: "پارس خودرو",
        trims: [
          { id: "h220", name: "دستی", years: [1390,1391,1392,1393,1394,1395,1396], cylinders: 4, gearbox: "دستی", engineVolume: 1300 },
        ],
      },
      {
        id: "brilliance-h230",
        name: "برلیانس H230",
        manufacturer: "پارس خودرو",
        trims: [
          { id: "h230", name: "دستی", years: [1391,1392,1393,1394,1395,1396,1397], cylinders: 4, gearbox: "دستی", engineVolume: 1500 },
        ],
      },
    ],
  },

  // ============================================
  // گروه بهمن
  // ============================================
  {
    id: "mazda",
    name: "مزدا",
    category: "foreign",
    models: [
      {
        id: "mazda-3",
        name: "مزدا ۳",
        manufacturer: "گروه بهمن",
        trims: [
          { id: "mazda3", name: "اتوماتیک", years: [1390,1391,1392,1393,1394,1395,1396,1397,1398,1399,1400], cylinders: 4, gearbox: "اتومات" },
        ],
      },
      {
        id: "mazda-2",
        name: "مزدا ۲",
        manufacturer: "گروه بهمن",
        trims: [
          { id: "mazda2", name: "اتوماتیک", years: [1392,1393,1394,1395,1396,1397,1398], cylinders: 4, gearbox: "اتومات", engineVolume: 1500 },
        ],
      },
      {
        id: "mazda-cx5",
        name: "مزدا CX-5",
        manufacturer: "گروه بهمن",
        trims: [
          { id: "cx5", name: "اتوماتیک", years: [1394,1395,1396,1397,1398], cylinders: 4, gearbox: "اتومات" },
        ],
      },
      {
        id: "mazda-kara",
        name: "مزدا کارا ۲۰۰۰ (وانت دوکابین)",
        manufacturer: "گروه بهمن",
        trims: [
          { id: "mazda-kara", name: "وانت دوکابین", years: [1385,1386,1387,1388,1389,1390,1391,1392,1393,1394,1395,1396,1397,1398,1399,1400,1401,1402,1403], cylinders: 4, gearbox: "دستی", engineVolume: 2000 },
        ],
      },
      {
        id: "mazda-van",
        name: "مزدا وانت",
        manufacturer: "گروه بهمن",
        trims: [
          { id: "mazda-b2200", name: "B2200 / B2600", years: [1370,1371,1372,1373,1374,1375,1376,1377,1378,1379,1380,1381,1382,1383,1384,1385,1386,1387,1388,1389,1390], cylinders: 4, gearbox: "دستی", engineVolume: 2200 },
        ],
      },
    ],
  },
  {
    id: "jac",
    name: "جک",
    category: "chinese",
    models: [
      {
        id: "jac-j5",
        name: "جک J5",
        manufacturer: "گروه بهمن",
        trims: [
          { id: "j5", name: "دستی / اتوماتیک", years: [1390,1391,1392,1393,1394,1395,1396,1397], cylinders: 4, gearbox: "دستی / اتومات", engineVolume: 1500 },
        ],
      },
      {
        id: "jac-s5",
        name: "جک S5",
        manufacturer: "گروه بهمن",
        trims: [
          { id: "s5-jac", name: "اتوماتیک", years: [1394,1395,1396,1397,1398,1399,1400], cylinders: 4, gearbox: "اتومات", engineVolume: 2000 },
        ],
      },
      {
        id: "jac-s3",
        name: "جک S3",
        manufacturer: "گروه بهمن",
        trims: [
          { id: "s3", name: "اتوماتیک", years: [1396,1397,1398,1399], cylinders: 4, gearbox: "اتومات", engineVolume: 1500 },
        ],
      },
      {
        id: "jac-j4",
        name: "جک J4 / JS4 / S4",
        manufacturer: "کرمان موتور",
        trims: [
          { id: "j4", name: "دستی / اتوماتیک", years: [1397,1398,1399,1400,1401], cylinders: 4, gearbox: "دستی / اتومات", engineVolume: 1600 },
        ],
      },
    ],
  },
  {
    id: "foton",
    name: "فوتون",
    category: "commercial",
    models: [
      {
        id: "foton-base",
        name: "فوتون (وانت/کامیونت)",
        manufacturer: "گروه بهمن",
        trims: [
          { id: "foton-truck", name: "وانت / کامیونت", years: [1385,1386,1387,1388,1389,1390,1391,1392,1393,1394,1395,1396,1397,1398,1399,1400,1401,1402,1403], cylinders: 4, gearbox: "دستی" },
        ],
      },
      {
        id: "foton-sauvana",
        name: "فوتون ساوانا (Sauvana)",
        manufacturer: "کرمان موتور",
        trims: [
          { id: "sauvana", name: "اتوماتیک", years: [1397,1398,1399,1400], cylinders: 4, gearbox: "اتومات", engineVolume: 2000 },
        ],
      },
    ],
  },
  {
    id: "dignity",
    name: "دیگنیتی",
    category: "chinese",
    models: [
      {
        id: "dignity-base",
        name: "دیگنیتی",
        manufacturer: "گروه بهمن",
        trims: [
          { id: "dignity", name: "اتوماتیک", years: [1400,1401,1402,1403], cylinders: 4, gearbox: "اتومات" },
        ],
      },
      {
        id: "dignity-prime",
        name: "دیگنیتی پرایم",
        manufacturer: "گروه بهمن",
        trims: [
          { id: "dignity-prime", name: "اتوماتیک", years: [1398,1399,1400,1401,1402,1403], cylinders: 4, gearbox: "اتومات" },
        ],
      },
    ],
  },
  {
    id: "fidelity",
    name: "فیدلیتی",
    category: "chinese",
    models: [
      {
        id: "fidelity-prime",
        name: "فیدلیتی پرایم",
        manufacturer: "گروه بهمن",
        trims: [
          { id: "fidelity-prime", name: "اتوماتیک", years: [1399,1400,1401,1402,1403], cylinders: 4, power: 156, gearbox: "اتومات دوکلاچه ۶ سرعته", engineVolume: 1500 },
        ],
      },
    ],
  },

  // ============================================
  // کرمان موتور
  // ============================================
  {
    id: "geely",
    name: "جیلی",
    category: "chinese",
    models: [
      {
        id: "geely-emgrand7",
        name: "جیلی امگرند ۷",
        manufacturer: "کرمان موتور",
        trims: [
          { id: "emgrand7", name: "اتوماتیک", years: [1391,1392,1393,1394,1395,1396,1397], cylinders: 4, gearbox: "اتومات", engineVolume: 1800 },
        ],
      },
      {
        id: "geely-emgrand-x7",
        name: "جیلی امگرند X7",
        manufacturer: "کرمان موتور",
        trims: [
          { id: "emgrand-x7", name: "اتوماتیک", years: [1393,1394,1395,1396,1397,1398], cylinders: 4, gearbox: "اتومات" },
        ],
      },
      {
        id: "geely-gc6",
        name: "جیلی GC6",
        manufacturer: "کرمان موتور",
        trims: [
          { id: "gc6", name: "دستی", years: [1391,1392,1393,1394,1395,1396], cylinders: 4, gearbox: "دستی", engineVolume: 1500 },
        ],
      },
    ],
  },
  {
    id: "lifan",
    name: "لیفان",
    category: "chinese",
    models: [
      {
        id: "lifan-x60",
        name: "لیفان X60",
        manufacturer: "کرمان موتور",
        trims: [
          { id: "x60", name: "دستی / اتوماتیک", years: [1391,1392,1393,1394,1395,1396,1397,1398], cylinders: 4, gearbox: "دستی / اتومات", engineVolume: 1800 },
        ],
      },
      {
        id: "lifan-620",
        name: "لیفان ۶۲۰",
        manufacturer: "کرمان موتور",
        trims: [
          { id: "620", name: "دستی / اتوماتیک", years: [1390,1391,1392,1393,1394,1395,1396,1397], cylinders: 4, gearbox: "دستی / اتومات", engineVolume: 1800 },
        ],
      },
    ],
  },
  {
    id: "great-wall",
    name: "گریت وال",
    category: "chinese",
    models: [
      {
        id: "gw-c30",
        name: "گریت وال وولکس C30",
        manufacturer: "کرمان موتور",
        trims: [
          { id: "c30", name: "دستی", years: [1390,1391,1392,1393,1394,1395,1396], cylinders: 4, gearbox: "دستی", engineVolume: 1500 },
        ],
      },
    ],
  },
  {
    id: "haval",
    name: "هاوال",
    category: "chinese",
    models: [
      {
        id: "haval-h6",
        name: "هاوال H6 (گریت وال)",
        manufacturer: "کرمان موتور",
        trims: [
          { id: "haval-h6", name: "اتوماتیک", years: [1395,1396,1397,1398,1399], cylinders: 4, gearbox: "اتومات", engineVolume: 2000 },
        ],
      },
    ],
  },
  {
    id: "byd",
    name: "بی‌وای‌دی",
    category: "chinese",
    models: [
      {
        id: "byd-f3",
        name: "بی‌وای‌دی F3",
        manufacturer: "کرمان موتور",
        trims: [
          { id: "byd-f3", name: "دستی", years: [1389,1390,1391,1392,1393,1394], cylinders: 4, gearbox: "دستی", engineVolume: 1500 },
        ],
      },
      {
        id: "byd-s7",
        name: "بی‌وای‌دی S7",
        manufacturer: "کرمان موتور",
        trims: [
          { id: "byd-s7", name: "اتوماتیک", years: [1394,1395,1396,1397], cylinders: 4, gearbox: "اتومات", engineVolume: 2000 },
        ],
      },
    ],
  },
  {
    id: "zotye",
    name: "زوتی",
    category: "chinese",
    models: [
      {
        id: "zotye-z300",
        name: "زوتی Z300",
        manufacturer: "کرمان موتور",
        trims: [
          { id: "z300", name: "دستی / اتوماتیک", years: [1390,1391,1392,1393,1394,1395,1396], cylinders: 4, gearbox: "دستی / اتومات", engineVolume: 1500 },
        ],
      },
      {
        id: "zotye-t600",
        name: "زوتی T600",
        manufacturer: "کرمان موتور",
        trims: [
          { id: "t600", name: "اتوماتیک", years: [1393,1394,1395,1396,1397,1398], cylinders: 4, gearbox: "اتومات", engineVolume: 2000 },
        ],
      },
    ],
  },
  {
    id: "dfsk",
    name: "DFSK",
    category: "chinese",
    models: [
      {
        id: "dfsk-glory-580",
        name: "DFSK Glory 580",
        manufacturer: "کرمان موتور",
        trims: [
          { id: "glory-580", name: "اتوماتیک", years: [1398,1399,1400,1401], cylinders: 4, gearbox: "اتومات", engineVolume: 1500 },
        ],
      },
    ],
  },
  {
    id: "dongfeng",
    name: "دانگ‌فنگ",
    category: "chinese",
    models: [
      {
        id: "dongfeng-h30",
        name: "دانگ‌فنگ H30 کراس / فنگون ۵۸۰",
        manufacturer: "کرمان موتور",
        trims: [
          { id: "h30-cross", name: "دستی / اتوماتیک", years: [1396,1397,1398,1399,1400], cylinders: 4, gearbox: "دستی / اتومات", engineVolume: 1500 },
        ],
      },
    ],
  },
  {
    id: "bestune",
    name: "بستون",
    category: "chinese",
    models: [
      {
        id: "bestune-t77",
        name: "بستون T77 (Bestune)",
        manufacturer: "کرمان موتور",
        trims: [
          { id: "t77", name: "اتوماتیک", years: [1399,1400,1401], cylinders: 4, gearbox: "اتومات", engineVolume: 1200 },
        ],
      },
    ],
  },
  {
    id: "exceed",
    name: "اکسید",
    category: "chinese",
    models: [
      {
        id: "exceed-base",
        name: "اکسید (Exceed)",
        manufacturer: "کرمان موتور",
        trims: [
          { id: "exceed", name: "اتوماتیک", years: [1400,1401,1402,1403], cylinders: 4, gearbox: "اتومات" },
        ],
      },
    ],
  },
  {
    id: "chery",
    name: "چری",
    category: "chinese",
    models: [
      {
        id: "chery-tiggo8-pro",
        name: "چری تیگو ۸ پرو / کاپرا",
        manufacturer: "کرمان موتور",
        trims: [
          { id: "tiggo8-pro", name: "اتوماتیک", years: [1401,1402,1403], cylinders: 4, gearbox: "اتومات", engineVolume: 1600 },
        ],
      },
    ],
  },
  {
    id: "jetta",
    name: "جتا",
    category: "chinese",
    models: [
      {
        id: "jetta-vs7",
        name: "جتا VS7 (فولکس‌واگن)",
        manufacturer: "کرمان موتور",
        trims: [
          { id: "vs7", name: "اتوماتیک", years: [1401,1402,1403], cylinders: 4, power: 150, gearbox: "اتومات ۶ سرعته", engineVolume: 1400 },
        ],
      },
    ],
  },
  {
    id: "rich",
    name: "ریچ",
    category: "chinese",
    models: [
      {
        id: "rich-rx8",
        name: "ریچ RX8 / فونیکس",
        manufacturer: "کرمان موتور",
        trims: [
          { id: "rx8", name: "اتوماتیک", years: [1401,1402,1403], cylinders: 4, gearbox: "اتومات" },
        ],
      },
    ],
  },

  // ============================================
  // مدیران خودرو
  // ============================================
  {
    id: "toyota",
    name: "تویوتا",
    category: "foreign",
    models: [
      {
        id: "toyota-camry",
        name: "تویوتا کمری",
        manufacturer: "مدیران خودرو",
        trims: [
          { id: "camry", name: "اتوماتیک", years: [1380,1381,1382,1383,1384,1385,1386,1387,1388,1389,1390,1391,1392,1393,1394,1395,1396,1397,1398,1399,1400], cylinders: 4, gearbox: "اتومات" },
        ],
      },
      {
        id: "toyota-corolla",
        name: "تویوتا کرولا",
        manufacturer: "مدیران خودرو",
        trims: [
          { id: "corolla", name: "اتوماتیک", years: [1380,1381,1382,1383,1384,1385,1386,1387,1388,1389,1390,1391,1392,1393,1394,1395,1396,1397,1398,1399,1400], cylinders: 4, gearbox: "اتومات" },
        ],
      },
      {
        id: "toyota-land-cruiser",
        name: "تویوتا لندکروزر",
        manufacturer: "مدیران خودرو",
        trims: [
          { id: "land-cruiser", name: "اتوماتیک", years: [1370,1371,1372,1373,1374,1375,1376,1377,1378,1379,1380,1381,1382,1383,1384,1385,1386,1387,1388,1389,1390,1391,1392,1393,1394,1395,1396,1397,1398,1399,1400,1401,1402,1403], cylinders: 6, gearbox: "اتومات" },
        ],
      },
      {
        id: "toyota-prado",
        name: "تویوتا پرادو",
        manufacturer: "مدیران خودرو",
        trims: [
          { id: "prado", name: "اتوماتیک", years: [1385,1386,1387,1388,1389,1390,1391,1392,1393,1394,1395,1396,1397,1398,1399,1400,1401,1402,1403], cylinders: 6, gearbox: "اتومات" },
        ],
      },
      {
        id: "toyota-yaris",
        name: "تویوتا یاریس",
        manufacturer: "واردات مستقل",
        trims: [
          { id: "yaris", name: "اتوماتیک", years: [1385,1386,1387,1388,1389,1390,1391,1392,1393,1394,1395,1396,1397], cylinders: 4, gearbox: "اتومات" },
        ],
      },
      {
        id: "toyota-rav4",
        name: "تویوتا راوفور (RAV4)",
        manufacturer: "واردات مستقل",
        trims: [
          { id: "rav4", name: "اتوماتیک", years: [1388,1389,1390,1391,1392,1393,1394,1395,1396,1397], cylinders: 4, gearbox: "اتومات" },
        ],
      },
    ],
  },
  {
    id: "mg",
    name: "ام‌جی",
    category: "chinese",
    models: [
      {
        id: "mg-6",
        name: "ام‌جی ۶",
        manufacturer: "مدیران خودرو",
        trims: [
          { id: "mg6", name: "اتوماتیک", years: [1393,1394,1395,1396,1397,1398], cylinders: 4, gearbox: "اتومات", engineVolume: 1800 },
        ],
      },
      {
        id: "mg-360",
        name: "ام‌جی ۳۶۰",
        manufacturer: "مدیران خودرو",
        trims: [
          { id: "mg360", name: "اتوماتیک", years: [1394,1395,1396,1397], cylinders: 4, gearbox: "اتومات", engineVolume: 1500 },
        ],
      },
      {
        id: "mg-rx5",
        name: "ام‌جی RX5",
        manufacturer: "مدیران خودرو",
        trims: [
          { id: "rx5", name: "اتوماتیک", years: [1396,1397,1398,1399], cylinders: 4, gearbox: "اتومات", engineVolume: 1500 },
        ],
      },
      {
        id: "mg-gt",
        name: "ام‌جی GT",
        manufacturer: "مدیران خودرو",
        trims: [
          { id: "mg-gt", name: "اتوماتیک", years: [1394,1395,1396,1397,1398], cylinders: 4, gearbox: "اتومات", engineVolume: 1500 },
        ],
      },
    ],
  },

  // ============================================
  // واردات مستقل
  // ============================================
  {
    id: "kia",
    name: "کیا",
    category: "foreign",
    models: [
      {
        id: "kia-cerato",
        name: "کیا سراتو",
        manufacturer: "واردات مستقل",
        trims: [
          { id: "cerato", name: "اتوماتیک", years: [1388,1389,1390,1391,1392,1393,1394,1395,1396,1397], cylinders: 4, gearbox: "اتومات" },
        ],
      },
      {
        id: "kia-sportage",
        name: "کیا اسپورتیج",
        manufacturer: "واردات مستقل",
        trims: [
          { id: "sportage", name: "اتوماتیک", years: [1385,1386,1387,1388,1389,1390,1391,1392,1393,1394,1395,1396,1397], cylinders: 4, gearbox: "اتومات" },
        ],
      },
      {
        id: "kia-optima",
        name: "کیا اپتیما",
        manufacturer: "واردات مستقل",
        trims: [
          { id: "optima", name: "اتوماتیک", years: [1390,1391,1392,1393,1394,1395,1396,1397], cylinders: 4, gearbox: "اتومات" },
        ],
      },
      {
        id: "kia-sorento",
        name: "کیا سورنتو",
        manufacturer: "واردات مستقل",
        trims: [
          { id: "sorento", name: "اتوماتیک", years: [1387,1388,1389,1390,1391,1392,1393,1394,1395,1396,1397], cylinders: 4, gearbox: "اتومات" },
        ],
      },
      {
        id: "kia-rio",
        name: "کیا ریو",
        manufacturer: "واردات مستقل",
        trims: [
          { id: "rio", name: "اتوماتیک", years: [1390,1391,1392,1393,1394,1395,1396,1397], cylinders: 4, gearbox: "اتومات" },
        ],
      },
      {
        id: "kia-picanto",
        name: "کیا پیکانتو",
        manufacturer: "واردات مستقل",
        trims: [
          { id: "picanto", name: "اتوماتیک", years: [1388,1389,1390,1391,1392,1393,1394,1395,1396,1397], cylinders: 4, gearbox: "اتومات" },
        ],
      },
      {
        id: "kia-soul",
        name: "کیا سول (Soul)",
        manufacturer: "واردات مستقل",
        trims: [
          { id: "soul", name: "اتوماتیک", years: [1390,1391,1392,1393,1394,1395,1396,1397], cylinders: 4, gearbox: "اتومات" },
        ],
      },
    ],
  },
  {
    id: "hyundai",
    name: "هیوندای",
    category: "foreign",
    models: [
      {
        id: "hyundai-elantra",
        name: "هیوندای النترا",
        manufacturer: "واردات مستقل",
        trims: [
          { id: "elantra", name: "اتوماتیک", years: [1385,1386,1387,1388,1389,1390,1391,1392,1393,1394,1395,1396,1397], cylinders: 4, gearbox: "اتومات" },
        ],
      },
      {
        id: "hyundai-sonata",
        name: "هیوندای سوناتا",
        manufacturer: "واردات مستقل",
        trims: [
          { id: "sonata", name: "اتوماتیک", years: [1385,1386,1387,1388,1389,1390,1391,1392,1393,1394,1395,1396,1397], cylinders: 4, gearbox: "اتومات" },
        ],
      },
      {
        id: "hyundai-tucson",
        name: "هیوندای توسان (IX35)",
        manufacturer: "واردات مستقل",
        trims: [
          { id: "tucson", name: "اتوماتیک", years: [1388,1389,1390,1391,1392,1393,1394,1395,1396,1397], cylinders: 4, gearbox: "اتومات" },
        ],
      },
      {
        id: "hyundai-santa-fe",
        name: "هیوندای سانتافه",
        manufacturer: "واردات مستقل",
        trims: [
          { id: "santa-fe", name: "اتوماتیک", years: [1385,1386,1387,1388,1389,1390,1391,1392,1393,1394,1395,1396,1397], cylinders: 4, gearbox: "اتومات" },
        ],
      },
      {
        id: "hyundai-accent",
        name: "هیوندای اکسنت",
        manufacturer: "واردات مستقل",
        trims: [
          { id: "accent", name: "اتوماتیک", years: [1388,1389,1390,1391,1392,1393,1394,1395,1396,1397], cylinders: 4, gearbox: "اتومات" },
        ],
      },
      {
        id: "hyundai-veracruz",
        name: "هیوندای وراکروز / توسان جدید",
        manufacturer: "واردات مستقل",
        trims: [
          { id: "veracruz", name: "اتوماتیک", years: [1390,1391,1392,1393,1394,1395,1396,1397], cylinders: 4, gearbox: "اتومات" },
        ],
      },
      {
        id: "hyundai-verna",
        name: "هیوندای ورنا (Verna)",
        manufacturer: "واردات مستقل",
        trims: [
          { id: "verna", name: "اتوماتیک", years: [1388,1389,1390,1391,1392,1393,1394,1395,1396,1397], cylinders: 4, gearbox: "اتومات" },
        ],
      },
    ],
  },
  {
    id: "nissan",
    name: "نیسان",
    category: "foreign",
    models: [
      {
        id: "nissan-teana",
        name: "نیسان تیانا / مکسیما",
        manufacturer: "واردات مستقل",
        trims: [
          { id: "teana", name: "اتوماتیک", years: [1385,1386,1387,1388,1389,1390,1391,1392,1393,1394], cylinders: 6, gearbox: "اتومات" },
        ],
      },
    ],
  },

  // ============================================
  // زامیاد
  // ============================================
  {
    id: "zamyad",
    name: "زامیاد",
    category: "commercial",
    models: [
      {
        id: "zamyad-nissan",
        name: "وانت نیسان (نیسان آبی / جونیور)",
        manufacturer: "زامیاد",
        trims: [
          { id: "nissan-140", name: "تیپ ۱۴۰", years: [1350,1351,1352,1353,1354,1355,1356,1357,1358,1359,1360,1361,1362,1363,1364,1365,1366,1367,1368,1369,1370,1371,1372,1373,1374,1375,1376,1377,1378,1379,1380,1381,1382,1383,1384,1385,1386,1387,1388,1389,1390,1391,1392,1393,1394,1395,1396,1397,1398,1399,1400,1401,1402], cylinders: 4, gearbox: "دستی" },
        ],
      },
      {
        id: "zamyad-padra",
        name: "پادرا",
        manufacturer: "زامیاد",
        trims: [
          { id: "padra", name: "دستی", years: [1390,1391,1392,1393,1394,1395,1396,1397,1398,1399,1400,1401,1402,1403], cylinders: 4, gearbox: "دستی", engineVolume: 2500 },
        ],
      },
      {
        id: "zamyad-padra-plus",
        name: "پادرا پلاس",
        manufacturer: "زامیاد",
        trims: [
          { id: "padra-plus", name: "دستی / اتوماتیک", years: [1397,1398,1399,1400,1401,1402,1403], cylinders: 4, gearbox: "دستی / اتومات", engineVolume: 2500 },
        ],
      },
      {
        id: "zamyad-karoon",
        name: "کارون (مونتاژ فودای لایون F16)",
        manufacturer: "زامیاد",
        trims: [
          { id: "karoon", name: "دستی / اتوماتیک", years: [1400,1401,1402,1403], cylinders: 4, power: 94, gearbox: "دستی / اتومات" },
        ],
      },
    ],
  },
];

// ============================================
// توابع کمکی
// ============================================

export function getAllBrands(): CarBrand[] {
  return carBrands;
}

export function getBrandById(id: string): CarBrand | undefined {
  return carBrands.find((b) => b.id === id);
}

export function getBrandsByCategory(category: CarBrandCategory): CarBrand[] {
  return carBrands.filter((b) => b.category === category);
}

export function getBrandName(id: string): string {
  return getBrandById(id)?.name || "";
}

export function getModelsByBrand(brandId: string): CarModel[] {
  return getBrandById(brandId)?.models || [];
}

export function getTrimsByModel(brandId: string, modelId: string): CarTrim[] {
  const brand = getBrandById(brandId);
  const model = brand?.models.find((m) => m.id === modelId);
  return model?.trims || [];
}

export function getYearsByTrim(
  brandId: string,
  modelId: string,
  trimId: string
): number[] {
  const trims = getTrimsByModel(brandId, modelId);
  return trims.find((t) => t.id === trimId)?.years || [];
}

export function searchCars(query: string) {
  const q = query.trim();
  if (!q) return [];
  const results: {
    brand: CarBrand;
    model: CarModel;
    trim?: CarTrim;
  }[] = [];

  for (const brand of carBrands) {
    for (const model of brand.models) {
      if (model.name.includes(q) || brand.name.includes(q)) {
        results.push({ brand, model });
      } else {
        for (const trim of model.trims) {
          if (trim.name.includes(q)) {
            results.push({ brand, model, trim });
            break;
          }
        }
      }
    }
  }
  return results.slice(0, 20);
}