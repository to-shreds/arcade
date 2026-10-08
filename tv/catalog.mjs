// Arcade owns this preset catalog. New titles must have a verified IMDb identity and be released before the review cutoff.
export const CATALOG_SCOPE = Object.freeze({
  "checkedDate": "2026-10-08",
  "releaseCutoff": "2026-10-08",
  "description": "Preset family shows and movies, including the complete released Walt Disney Animation Studios and Pixar feature catalogs, Disney-branded animated theatrical, direct-to-video and television movies, original Jumanji, and Night at the Museum movies.",
  "excluded": [
    "Unreleased films",
    "Standalone short films",
    "Sing-along DVDs and episode collections",
    "Live-action remakes and predominantly live-action hybrids",
    "Licensed Studio Ghibli films",
    "Acquired Fox, Marvel and Lucasfilm back catalogs"
  ],
  "sources": [
    "https://www.disneyanimation.com/films/",
    "https://www.pixar.com/feature-films",
    "https://movies.disney.com/animation",
    "https://fairies.disney.com/movies",
    "https://d23.com/list-of-disney-films/",
    "https://d23.com/basically-everything-you-can-watch-on-disney-plus/"
  ],
  "metadataProvider": "IMDb title IDs, verified against Cinemeta. Official release names and years take precedence over provider aliases."
});

const titles = [
  {
    "id": "tt26443597",
    "type": "movie",
    "name": "Zootopia 2",
    "year": 2025,
    "group": "Disney Animation"
  },
  {
    "id": "tt13622970",
    "type": "movie",
    "name": "Moana 2",
    "year": 2024,
    "group": "Disney Animation"
  },
  {
    "id": "tt11304740",
    "type": "movie",
    "name": "Wish",
    "year": 2023,
    "group": "Disney Animation"
  },
  {
    "id": "tt10298840",
    "type": "movie",
    "name": "Strange World",
    "year": 2022,
    "group": "Disney Animation"
  },
  {
    "id": "tt2953050",
    "type": "movie",
    "name": "Encanto",
    "year": 2021,
    "group": "Disney Animation"
  },
  {
    "id": "tt5109280",
    "type": "movie",
    "name": "Raya and the Last Dragon",
    "year": 2021,
    "group": "Disney Animation"
  },
  {
    "id": "tt4520988",
    "type": "movie",
    "name": "Frozen 2",
    "year": 2019,
    "group": "Disney Animation"
  },
  {
    "id": "tt5848272",
    "type": "movie",
    "name": "Ralph Breaks the Internet",
    "year": 2018,
    "group": "Disney Animation"
  },
  {
    "id": "tt3521164",
    "type": "movie",
    "name": "Moana",
    "year": 2016,
    "group": "Disney Animation"
  },
  {
    "id": "tt2948356",
    "type": "movie",
    "name": "Zootopia",
    "year": 2016,
    "group": "Disney Animation"
  },
  {
    "id": "tt2245084",
    "type": "movie",
    "name": "Big Hero 6",
    "year": 2014,
    "group": "Disney Animation"
  },
  {
    "id": "tt2294629",
    "type": "movie",
    "name": "Frozen",
    "year": 2013,
    "group": "Disney Animation"
  },
  {
    "id": "tt1772341",
    "type": "movie",
    "name": "Wreck-It Ralph",
    "year": 2012,
    "group": "Disney Animation"
  },
  {
    "id": "tt1449283",
    "type": "movie",
    "name": "Winnie the Pooh",
    "year": 2011,
    "group": "Disney Animation"
  },
  {
    "id": "tt0398286",
    "type": "movie",
    "name": "Tangled",
    "year": 2010,
    "group": "Disney Animation"
  },
  {
    "id": "tt0780521",
    "type": "movie",
    "name": "The Princess and the Frog",
    "year": 2009,
    "group": "Disney Animation"
  },
  {
    "id": "tt0397892",
    "type": "movie",
    "name": "Bolt",
    "year": 2008,
    "group": "Disney Animation"
  },
  {
    "id": "tt0396555",
    "type": "movie",
    "name": "Meet the Robinsons",
    "year": 2007,
    "group": "Disney Animation"
  },
  {
    "id": "tt0371606",
    "type": "movie",
    "name": "Chicken Little",
    "year": 2005,
    "group": "Disney Animation"
  },
  {
    "id": "tt0299172",
    "type": "movie",
    "name": "Home on the Range",
    "year": 2004,
    "group": "Disney Animation"
  },
  {
    "id": "tt0328880",
    "type": "movie",
    "name": "Brother Bear",
    "year": 2003,
    "group": "Disney Animation"
  },
  {
    "id": "tt0133240",
    "type": "movie",
    "name": "Treasure Planet",
    "year": 2002,
    "group": "Disney Animation"
  },
  {
    "id": "tt0275847",
    "type": "movie",
    "name": "Lilo & Stitch",
    "year": 2002,
    "group": "Disney Animation"
  },
  {
    "id": "tt0230011",
    "type": "movie",
    "name": "Atlantis: The Lost Empire",
    "year": 2001,
    "group": "Disney Animation"
  },
  {
    "id": "tt0120917",
    "type": "movie",
    "name": "The Emperor's New Groove",
    "year": 2000,
    "group": "Disney Animation"
  },
  {
    "id": "tt0130623",
    "type": "movie",
    "name": "Dinosaur",
    "year": 2000,
    "group": "Disney Animation"
  },
  {
    "id": "tt0120910",
    "type": "movie",
    "name": "Fantasia 2000",
    "year": 2000,
    "group": "Disney Animation"
  },
  {
    "id": "tt0120855",
    "type": "movie",
    "name": "Tarzan",
    "year": 1999,
    "group": "Disney Animation"
  },
  {
    "id": "tt0120762",
    "type": "movie",
    "name": "Mulan",
    "year": 1998,
    "group": "Disney Animation"
  },
  {
    "id": "tt0119282",
    "type": "movie",
    "name": "Hercules",
    "year": 1997,
    "group": "Disney Animation"
  },
  {
    "id": "tt0116583",
    "type": "movie",
    "name": "The Hunchback of Notre Dame",
    "year": 1996,
    "group": "Disney Animation"
  },
  {
    "id": "tt0114148",
    "type": "movie",
    "name": "Pocahontas",
    "year": 1995,
    "group": "Disney Animation"
  },
  {
    "id": "tt0110357",
    "type": "movie",
    "name": "The Lion King",
    "year": 1994,
    "group": "Disney Animation"
  },
  {
    "id": "tt0103639",
    "type": "movie",
    "name": "Aladdin",
    "year": 1992,
    "group": "Disney Animation"
  },
  {
    "id": "tt0101414",
    "type": "movie",
    "name": "Beauty and the Beast",
    "year": 1991,
    "group": "Disney Animation"
  },
  {
    "id": "tt0100477",
    "type": "movie",
    "name": "The Rescuers Down Under",
    "year": 1990,
    "group": "Disney Animation"
  },
  {
    "id": "tt0097757",
    "type": "movie",
    "name": "The Little Mermaid",
    "year": 1989,
    "group": "Disney Animation"
  },
  {
    "id": "tt0095776",
    "type": "movie",
    "name": "Oliver & Company",
    "year": 1988,
    "group": "Disney Animation"
  },
  {
    "id": "tt0091149",
    "type": "movie",
    "name": "The Great Mouse Detective",
    "year": 1986,
    "group": "Disney Animation"
  },
  {
    "id": "tt0088814",
    "type": "movie",
    "name": "The Black Cauldron",
    "year": 1985,
    "group": "Disney Animation"
  },
  {
    "id": "tt0082406",
    "type": "movie",
    "name": "The Fox and the Hound",
    "year": 1981,
    "group": "Disney Animation"
  },
  {
    "id": "tt0076618",
    "type": "movie",
    "name": "The Rescuers",
    "year": 1977,
    "group": "Disney Animation"
  },
  {
    "id": "tt0076363",
    "type": "movie",
    "name": "The Many Adventures of Winnie the Pooh",
    "year": 1977,
    "group": "Disney Animation"
  },
  {
    "id": "tt0070608",
    "type": "movie",
    "name": "Robin Hood",
    "year": 1973,
    "group": "Disney Animation"
  },
  {
    "id": "tt0065421",
    "type": "movie",
    "name": "The Aristocats",
    "year": 1970,
    "group": "Disney Animation"
  },
  {
    "id": "tt0061852",
    "type": "movie",
    "name": "The Jungle Book",
    "year": 1967,
    "group": "Disney Animation"
  },
  {
    "id": "tt0057546",
    "type": "movie",
    "name": "The Sword in the Stone",
    "year": 1963,
    "group": "Disney Animation"
  },
  {
    "id": "tt0055254",
    "type": "movie",
    "name": "101 Dalmatians",
    "year": 1961,
    "group": "Disney Animation"
  },
  {
    "id": "tt0053285",
    "type": "movie",
    "name": "Sleeping Beauty",
    "year": 1959,
    "group": "Disney Animation"
  },
  {
    "id": "tt0048280",
    "type": "movie",
    "name": "Lady and the Tramp",
    "year": 1955,
    "group": "Disney Animation"
  },
  {
    "id": "tt0046183",
    "type": "movie",
    "name": "Peter Pan",
    "year": 1953,
    "group": "Disney Animation"
  },
  {
    "id": "tt0043274",
    "type": "movie",
    "name": "Alice in Wonderland",
    "year": 1951,
    "group": "Disney Animation"
  },
  {
    "id": "tt0042332",
    "type": "movie",
    "name": "Cinderella",
    "year": 1950,
    "group": "Disney Animation"
  },
  {
    "id": "tt0041094",
    "type": "movie",
    "name": "The Adventures of Ichabod and Mr. Toad",
    "year": 1949,
    "group": "Disney Animation"
  },
  {
    "id": "tt0040580",
    "type": "movie",
    "name": "Melody Time",
    "year": 1948,
    "group": "Disney Animation"
  },
  {
    "id": "tt0039404",
    "type": "movie",
    "name": "Fun and Fancy Free",
    "year": 1947,
    "group": "Disney Animation"
  },
  {
    "id": "tt0038718",
    "type": "movie",
    "name": "Make Mine Music",
    "year": 1946,
    "group": "Disney Animation"
  },
  {
    "id": "tt0038166",
    "type": "movie",
    "name": "The Three Caballeros",
    "year": 1945,
    "group": "Disney Animation"
  },
  {
    "id": "tt0036326",
    "type": "movie",
    "name": "Saludos Amigos",
    "year": 1943,
    "group": "Disney Animation"
  },
  {
    "id": "tt0034492",
    "type": "movie",
    "name": "Bambi",
    "year": 1942,
    "group": "Disney Animation"
  },
  {
    "id": "tt0033563",
    "type": "movie",
    "name": "Dumbo",
    "year": 1941,
    "group": "Disney Animation"
  },
  {
    "id": "tt0032455",
    "type": "movie",
    "name": "Fantasia",
    "year": 1940,
    "group": "Disney Animation"
  },
  {
    "id": "tt0032910",
    "type": "movie",
    "name": "Pinocchio",
    "year": 1940,
    "group": "Disney Animation"
  },
  {
    "id": "tt0029583",
    "type": "movie",
    "name": "Snow White and the Seven Dwarfs",
    "year": 1937,
    "group": "Disney Animation"
  },
  {
    "id": "tt29355505",
    "type": "movie",
    "name": "Toy Story 5",
    "year": 2026,
    "group": "Pixar"
  },
  {
    "id": "tt26443616",
    "type": "movie",
    "name": "Hoppers",
    "year": 2026,
    "group": "Pixar"
  },
  {
    "id": "tt4900148",
    "type": "movie",
    "name": "Elio",
    "year": 2025,
    "group": "Pixar"
  },
  {
    "id": "tt22022452",
    "type": "movie",
    "name": "Inside Out 2",
    "year": 2024,
    "group": "Pixar"
  },
  {
    "id": "tt15789038",
    "type": "movie",
    "name": "Elemental",
    "year": 2023,
    "group": "Pixar"
  },
  {
    "id": "tt10298810",
    "type": "movie",
    "name": "Lightyear",
    "year": 2022,
    "group": "Pixar"
  },
  {
    "id": "tt8097030",
    "type": "movie",
    "name": "Turning Red",
    "year": 2022,
    "group": "Pixar"
  },
  {
    "id": "tt12801262",
    "type": "movie",
    "name": "Luca",
    "year": 2021,
    "group": "Pixar"
  },
  {
    "id": "tt2948372",
    "type": "movie",
    "name": "Soul",
    "year": 2020,
    "group": "Pixar"
  },
  {
    "id": "tt7146812",
    "type": "movie",
    "name": "Onward",
    "year": 2020,
    "group": "Pixar"
  },
  {
    "id": "tt1979376",
    "type": "movie",
    "name": "Toy Story 4",
    "year": 2019,
    "group": "Pixar"
  },
  {
    "id": "tt3606756",
    "type": "movie",
    "name": "Incredibles 2",
    "year": 2018,
    "group": "Pixar"
  },
  {
    "id": "tt2380307",
    "type": "movie",
    "name": "Coco",
    "year": 2017,
    "group": "Pixar"
  },
  {
    "id": "tt3606752",
    "type": "movie",
    "name": "Cars 3",
    "year": 2017,
    "group": "Pixar"
  },
  {
    "id": "tt2277860",
    "type": "movie",
    "name": "Finding Dory",
    "year": 2016,
    "group": "Pixar"
  },
  {
    "id": "tt1979388",
    "type": "movie",
    "name": "The Good Dinosaur",
    "year": 2015,
    "group": "Pixar"
  },
  {
    "id": "tt2096673",
    "type": "movie",
    "name": "Inside Out",
    "year": 2015,
    "group": "Pixar"
  },
  {
    "id": "tt1453405",
    "type": "movie",
    "name": "Monsters University",
    "year": 2013,
    "group": "Pixar"
  },
  {
    "id": "tt1217209",
    "type": "movie",
    "name": "Brave",
    "year": 2012,
    "group": "Pixar"
  },
  {
    "id": "tt1216475",
    "type": "movie",
    "name": "Cars 2",
    "year": 2011,
    "group": "Pixar"
  },
  {
    "id": "tt0435761",
    "type": "movie",
    "name": "Toy Story 3",
    "year": 2010,
    "group": "Pixar"
  },
  {
    "id": "tt1049413",
    "type": "movie",
    "name": "Up",
    "year": 2009,
    "group": "Pixar"
  },
  {
    "id": "tt0910970",
    "type": "movie",
    "name": "WALL-E",
    "year": 2008,
    "group": "Pixar"
  },
  {
    "id": "tt0382932",
    "type": "movie",
    "name": "Ratatouille",
    "year": 2007,
    "group": "Pixar"
  },
  {
    "id": "tt0317219",
    "type": "movie",
    "name": "Cars",
    "year": 2006,
    "group": "Pixar"
  },
  {
    "id": "tt0317705",
    "type": "movie",
    "name": "The Incredibles",
    "year": 2004,
    "group": "Pixar"
  },
  {
    "id": "tt0266543",
    "type": "movie",
    "name": "Finding Nemo",
    "year": 2003,
    "group": "Pixar"
  },
  {
    "id": "tt0198781",
    "type": "movie",
    "name": "Monsters, Inc.",
    "year": 2001,
    "group": "Pixar"
  },
  {
    "id": "tt0120363",
    "type": "movie",
    "name": "Toy Story 2",
    "year": 1999,
    "group": "Pixar"
  },
  {
    "id": "tt0120623",
    "type": "movie",
    "name": "A Bug's Life",
    "year": 1998,
    "group": "Pixar"
  },
  {
    "id": "tt0114709",
    "type": "movie",
    "name": "Toy Story",
    "year": 1995,
    "group": "Pixar"
  },
  {
    "id": "tt0324941",
    "type": "movie",
    "name": "101 Dalmatians II: Patch's London Adventure",
    "year": 2003,
    "group": "Disney Features"
  },
  {
    "id": "tt0113198",
    "type": "movie",
    "name": "A Goofy Movie",
    "year": 1995,
    "group": "Disney Features"
  },
  {
    "id": "tt0115491",
    "type": "movie",
    "name": "Aladdin and the King of Thieves",
    "year": 1996,
    "group": "Disney Features"
  },
  {
    "id": "tt0107952",
    "type": "movie",
    "name": "The Return of Jafar",
    "year": 1994,
    "group": "Disney Features"
  },
  {
    "id": "tt0208185",
    "type": "movie",
    "name": "An Extremely Goofy Movie",
    "year": 2000,
    "group": "Disney Features"
  },
  {
    "id": "tt0344864",
    "type": "movie",
    "name": "Atlantis: Milo's Return",
    "year": 2003,
    "group": "Disney Features"
  },
  {
    "id": "tt0447854",
    "type": "movie",
    "name": "Bambi II",
    "year": 2006,
    "group": "Disney Features"
  },
  {
    "id": "tt0167038",
    "type": "movie",
    "name": "Belle's Magical World",
    "year": 1998,
    "group": "Disney Features"
  },
  {
    "id": "tt0118692",
    "type": "movie",
    "name": "Beauty and the Beast: The Enchanted Christmas",
    "year": 1997,
    "group": "Disney Features"
  },
  {
    "id": "tt0465925",
    "type": "movie",
    "name": "Brother Bear 2",
    "year": 2006,
    "group": "Disney Features"
  },
  {
    "id": "tt0291082",
    "type": "movie",
    "name": "Cinderella II: Dreams Come True",
    "year": 2002,
    "group": "Disney Features"
  },
  {
    "id": "tt0465940",
    "type": "movie",
    "name": "Cinderella III: A Twist in Time",
    "year": 2007,
    "group": "Disney Features"
  },
  {
    "id": "tt1135924",
    "type": "movie",
    "name": "Disney Princess Enchanted Tales: Follow Your Dreams",
    "year": 2007,
    "group": "Disney Features"
  },
  {
    "id": "tt0187819",
    "type": "movie",
    "name": "Doug's 1st Movie",
    "year": 1999,
    "group": "Disney Features"
  },
  {
    "id": "tt0099472",
    "type": "movie",
    "name": "DuckTales the Movie: Treasure of the Lost Lamp",
    "year": 1990,
    "group": "Disney Features"
  },
  {
    "id": "tt0257778",
    "type": "movie",
    "name": "The Hunchback of Notre Dame II",
    "year": 2002,
    "group": "Disney Features"
  },
  {
    "id": "tt0283426",
    "type": "movie",
    "name": "The Jungle Book 2",
    "year": 2003,
    "group": "Disney Features"
  },
  {
    "id": "tt0401398",
    "type": "movie",
    "name": "Kronk's New Groove",
    "year": 2005,
    "group": "Disney Features"
  },
  {
    "id": "tt0249677",
    "type": "movie",
    "name": "Lady and the Tramp II: Scamp's Adventure",
    "year": 2001,
    "group": "Disney Features"
  },
  {
    "id": "tt0486761",
    "type": "movie",
    "name": "Leroy & Stitch",
    "year": 2006,
    "group": "Disney Features"
  },
  {
    "id": "tt0457993",
    "type": "movie",
    "name": "Lilo & Stitch 2: Stitch Has a Glitch",
    "year": 2005,
    "group": "Disney Features"
  },
  {
    "id": "tt0318403",
    "type": "movie",
    "name": "The Lion King 1½",
    "year": 2004,
    "group": "Disney Features"
  },
  {
    "id": "tt0120131",
    "type": "movie",
    "name": "The Lion King II: Simba's Pride",
    "year": 1998,
    "group": "Disney Features"
  },
  {
    "id": "tt0240684",
    "type": "movie",
    "name": "The Little Mermaid II: Return to the Sea",
    "year": 2000,
    "group": "Disney Features"
  },
  {
    "id": "tt0969647",
    "type": "movie",
    "name": "The Little Mermaid: Ariel's Beginning",
    "year": 2008,
    "group": "Disney Features"
  },
  {
    "id": "tt0300195",
    "type": "movie",
    "name": "Mickey's Magical Christmas: Snowed in at the House of Mouse",
    "year": 2001,
    "group": "Disney Features"
  },
  {
    "id": "tt0329374",
    "type": "movie",
    "name": "Mickey's House of Villains",
    "year": 2002,
    "group": "Disney Features"
  },
  {
    "id": "tt0238414",
    "type": "movie",
    "name": "Mickey's Once Upon a Christmas",
    "year": 1999,
    "group": "Disney Features"
  },
  {
    "id": "tt0424279",
    "type": "movie",
    "name": "Mickey's Twice Upon a Christmas",
    "year": 2004,
    "group": "Disney Features"
  },
  {
    "id": "tt0371823",
    "type": "movie",
    "name": "Mickey, Donald, Goofy: The Three Musketeers",
    "year": 2004,
    "group": "Disney Features"
  },
  {
    "id": "tt0279967",
    "type": "movie",
    "name": "Mulan II",
    "year": 2004,
    "group": "Disney Features"
  },
  {
    "id": "tt0323642",
    "type": "movie",
    "name": "Piglet's Big Movie",
    "year": 2003,
    "group": "Disney Features"
  },
  {
    "id": "tt1691917",
    "type": "movie",
    "name": "Planes",
    "year": 2013,
    "group": "Disney Features"
  },
  {
    "id": "tt2980706",
    "type": "movie",
    "name": "Planes: Fire & Rescue",
    "year": 2014,
    "group": "Disney Features"
  },
  {
    "id": "tt0143808",
    "type": "movie",
    "name": "Pocahontas II: Journey to a New World",
    "year": 1998,
    "group": "Disney Features"
  },
  {
    "id": "tt0119918",
    "type": "movie",
    "name": "Pooh's Grand Adventure: The Search for Christopher Robin",
    "year": 1997,
    "group": "Disney Features"
  },
  {
    "id": "tt0407121",
    "type": "movie",
    "name": "Pooh's Heffalump Movie",
    "year": 2005,
    "group": "Disney Features"
  },
  {
    "id": "tt0457437",
    "type": "movie",
    "name": "Pooh's Heffalump Halloween Movie",
    "year": 2005,
    "group": "Disney Features"
  },
  {
    "id": "tt0280030",
    "type": "movie",
    "name": "Return to Never Land",
    "year": 2002,
    "group": "Disney Features"
  },
  {
    "id": "tt1217213",
    "type": "movie",
    "name": "Secret of the Wings",
    "year": 2012,
    "group": "Disney Features"
  },
  {
    "id": "tt0348124",
    "type": "movie",
    "name": "Stitch! The Movie",
    "year": 2003,
    "group": "Disney Features"
  },
  {
    "id": "tt0313680",
    "type": "movie",
    "name": "Tarzan & Jane",
    "year": 2002,
    "group": "Disney Features"
  },
  {
    "id": "tt0437503",
    "type": "movie",
    "name": "Tarzan II",
    "year": 2005,
    "group": "Disney Features"
  },
  {
    "id": "tt0220099",
    "type": "movie",
    "name": "The Tigger Movie",
    "year": 2000,
    "group": "Disney Features"
  },
  {
    "id": "tt0823671",
    "type": "movie",
    "name": "Tinker Bell",
    "year": 2008,
    "group": "Disney Features"
  },
  {
    "id": "tt1216516",
    "type": "movie",
    "name": "Tinker Bell and the Lost Treasure",
    "year": 2009,
    "group": "Disney Features"
  },
  {
    "id": "tt1216515",
    "type": "movie",
    "name": "Tinker Bell and the Great Fairy Rescue",
    "year": 2010,
    "group": "Disney Features"
  },
  {
    "id": "tt2483260",
    "type": "movie",
    "name": "The Pirate Fairy",
    "year": 2014,
    "group": "Disney Features"
  },
  {
    "id": "tt3120408",
    "type": "movie",
    "name": "Tinker Bell and the Legend of the NeverBeast",
    "year": 2014,
    "group": "Disney Features"
  },
  {
    "id": "tt0465997",
    "type": "movie",
    "name": "The Fox and the Hound 2",
    "year": 2006,
    "group": "Disney Features"
  },
  {
    "id": "tt0324572",
    "type": "movie",
    "name": "Winnie the Pooh: A Very Merry Pooh Year",
    "year": 2002,
    "group": "Disney Features"
  },
  {
    "id": "tt0240219",
    "type": "movie",
    "name": "Winnie the Pooh: Seasons of Giving",
    "year": 1999,
    "group": "Disney Features"
  },
  {
    "id": "tt0384696",
    "type": "movie",
    "name": "Winnie the Pooh: Springtime with Roo",
    "year": 2004,
    "group": "Disney Features"
  },
  {
    "id": "tt0107688",
    "type": "movie",
    "name": "The Nightmare Before Christmas",
    "year": 1993,
    "group": "Disney Features"
  },
  {
    "id": "tt0116683",
    "type": "movie",
    "name": "James and the Giant Peach",
    "year": 1996,
    "group": "Disney Features"
  },
  {
    "id": "tt1067106",
    "type": "movie",
    "name": "A Christmas Carol",
    "year": 2009,
    "group": "Disney Features"
  },
  {
    "id": "tt1305591",
    "type": "movie",
    "name": "Mars Needs Moms",
    "year": 2011,
    "group": "Disney Features"
  },
  {
    "id": "tt1142977",
    "type": "movie",
    "name": "Frankenweenie",
    "year": 2012,
    "group": "Disney Features"
  },
  {
    "id": "tt0361089",
    "type": "movie",
    "name": "Valiant",
    "year": 2005,
    "group": "Disney Features"
  },
  {
    "id": "tt0405469",
    "type": "movie",
    "name": "The Wild",
    "year": 2006,
    "group": "Disney Features"
  },
  {
    "id": "tt0092695",
    "type": "movie",
    "name": "The Brave Little Toaster",
    "year": 1987,
    "group": "Disney Features"
  },
  {
    "id": "tt0147926",
    "type": "movie",
    "name": "The Brave Little Toaster Goes to Mars",
    "year": 1998,
    "group": "Disney Features"
  },
  {
    "id": "tt0163986",
    "type": "movie",
    "name": "The Brave Little Toaster to the Rescue",
    "year": 1997,
    "group": "Disney Features"
  },
  {
    "id": "tt0265632",
    "type": "movie",
    "name": "Recess: School's Out",
    "year": 2001,
    "group": "Disney Features"
  },
  {
    "id": "tt0350194",
    "type": "movie",
    "name": "Teacher's Pet",
    "year": 2004,
    "group": "Disney Features"
  },
  {
    "id": "tt0448090",
    "type": "movie",
    "name": "The Proud Family Movie",
    "year": 2005,
    "group": "Disney Features"
  },
  {
    "id": "tt0389074",
    "type": "movie",
    "name": "Kim Possible: A Sitch in Time",
    "year": 2003,
    "group": "Disney Features"
  },
  {
    "id": "tt0446724",
    "type": "movie",
    "name": "Kim Possible: So the Drama",
    "year": 2005,
    "group": "Disney Features"
  },
  {
    "id": "tt1825918",
    "type": "movie",
    "name": "Phineas and Ferb the Movie: Across the 2nd Dimension",
    "year": 2011,
    "group": "Disney Features"
  },
  {
    "id": "tt1817232",
    "type": "movie",
    "name": "Phineas and Ferb the Movie: Candace Against the Universe",
    "year": 2020,
    "group": "Disney Features"
  },
  {
    "id": "tt13834480",
    "type": "movie",
    "name": "Diary of a Wimpy Kid",
    "year": 2021,
    "group": "Disney Features"
  },
  {
    "id": "tt15847828",
    "type": "movie",
    "name": "Diary of a Wimpy Kid: Rodrick Rules",
    "year": 2022,
    "group": "Disney Features"
  },
  {
    "id": "tt29033964",
    "type": "movie",
    "name": "Diary of a Wimpy Kid Christmas: Cabin Fever",
    "year": 2023,
    "group": "Disney Features"
  },
  {
    "id": "tt37751253",
    "type": "movie",
    "name": "Diary of a Wimpy Kid: The Last Straw",
    "year": 2025,
    "group": "Disney Features"
  },
  {
    "id": "tt4549142",
    "type": "series",
    "name": "Elena of Avalor",
    "year": 2016,
    "group": "Shows"
  },
  {
    "id": "tt0235918",
    "type": "series",
    "name": "The Fairly OddParents",
    "year": 2001,
    "group": "Shows"
  },
  {
    "id": "tt0131613",
    "type": "series",
    "name": "Teenage Mutant Ninja Turtles",
    "year": 1987,
    "group": "Shows"
  },
  {
    "id": "tt0081933",
    "type": "series",
    "name": "The Smurfs",
    "year": 1981,
    "group": "Shows"
  },
  {
    "id": "tt0113497",
    "type": "movie",
    "name": "Jumanji",
    "year": 1995,
    "group": "Family Movies"
  },
  {
    "id": "tt0477347",
    "type": "movie",
    "name": "Night at the Museum",
    "year": 2006,
    "group": "Family Movies"
  },
  {
    "id": "tt1078912",
    "type": "movie",
    "name": "Night at the Museum: Battle of the Smithsonian",
    "year": 2009,
    "group": "Family Movies"
  },
  {
    "id": "tt2692250",
    "type": "movie",
    "name": "Night at the Museum: Secret of the Tomb",
    "year": 2014,
    "group": "Family Movies"
  },
  {
    "id": "tt13623880",
    "type": "movie",
    "name": "Night at the Museum: Kahmunrah Rises Again",
    "year": 2022,
    "group": "Family Movies"
  },
  {
    "id": "tt2404027",
    "type": "movie",
    "name": "Arjun: The Warrior Prince",
    "year": 2012,
    "group": "Disney Features"
  },
  {
    "id": "tt1050739",
    "type": "movie",
    "name": "Roadside Romeo",
    "year": 2008,
    "group": "Disney Features"
  },
  {
    "id": "tt0382937",
    "type": "movie",
    "name": "Recess: Taking the Fifth Grade",
    "year": 2003,
    "group": "Disney Features"
  },
  {
    "id": "tt15470224",
    "type": "movie",
    "name": "Mickey's Tale of Two Witches",
    "year": 2021,
    "group": "Disney Features"
  },
  {
    "id": "tt15708426",
    "type": "movie",
    "name": "Mickey and Minnie Wish Upon a Christmas",
    "year": 2021,
    "group": "Disney Features"
  }
];

export const PRESET_TITLES = Object.freeze(titles.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base', numeric: true }) || a.year - b.year).map(title => Object.freeze(title)));
