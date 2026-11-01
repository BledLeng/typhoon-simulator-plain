// Original simulator roster, NOT the WMO operational naming lists. Names use
// English or ASCII romanization. Neighbouring basins share cultural traditions.
import {isMediterranean, wrapLongitude} from './geography.js';
const families = {
  micronesia: 'Yap Kosrae Pohnlang Pingelap Kapingamarangi Oroluk Chuuk Weno Fefan Tol Dublon Satawan Puluwat Lamotrek Woleai Ulithi Fais Eauripik Ngulu Sonsorol Kayangel Angaur Koror Babeldaob Arno Aur Maloelap Wotje Jaluit Ailuk',
  mascarene: 'Agalega Belombre Cargados Fregate Silhouette Praslin Curieuse Desroches Alphonse Aride Assomption Aldabra Denis Coetivy Digue Farquhar Providence Cosmoledo Astove Cerf Moyenne Platte Maido Salazie Cilaos Mafate Tampon Savanne Chamarel Bambous',
  gulfGuinea: 'Abena Adjoa Akosua Ama Esi Akua Yaa Kofi Kwame Kojo Kwesi Kwaku Yaw Kwabena Kwadwo Abiola Ayo Ayodele Bisi Dami Dara Femi Funmi Kemi Kunle Sade Tayo Temi Tola Yemi',
  mexico: 'Amapola Axolotl Cacomixtle Cenzontle Chachalaca Chaya Chipilin Ciruela Dalia Guaje Guayacan Huizache Jicama Jilguero Jocote Maguey Mezquite Nopal Ocote Oyamel Pochote Quetzal Quintonil Tejocote Tepozan Tigrillo Tule Vainilla Xoconostle Zapote',
  chinese: 'Baihe Qingyun Haitang Songtao Zhulu Chenxi Jinzhu Lingfeng Feiyan Yuelan Xinghe Yunfan Haixing Liuyun Xiaolu Chunlei Qingzhu Bihai Jinfeng Yulan Baifan Mingyue Chixia Lanhua Qingsong Hehua Xiyu Qiuye Xuefeng Yuheng',
  japanese: 'Aoi Haru Kaede Nagi Tsubaki Akane Hikari Kiri Sora Yuki Mizuki Hotaru Sakura Shion Asahi Nagisa Hayate Natsume Tsubasa Koharu Hibari Fubuki Isana Minori Suzume Komugi Hinata Botan Sumire Suzuna',
  korean: 'Haneul Baram Nari Gureum Bada Garam Nuri Iseul Dalbit Byeol Yeoul Danbi Noeul Saebom Boram Areum Duru Solbit Yeseul Gaeul Saebyeok Mirinae Yeoreum Namu Dalrae Sarang Hanbyeol Seulgi Daon Goyo',
  southeast: 'Alon Bituin Habagat Amihan Tala Ulap Sampaguita Ilang Langit Kidlat Luntian Silangan Bulan Bunga Rimba Bayu Embun Ombak Melati Angin Fajar Hujan Laut Mentari Senja Ranting Teratai Pelangi Awan Pagi',
  india: 'Kiran Neeraj Megha Varsha Aruna Tara Kavya Asha Ravi Leela Nila Devika Vasant Diya Kamal Chandra Yamini Nalini Parijat Rohan Aakash Anila Jyoti Pavan Lata Amrita Ishaan Sharad Neelam Sarika',
  arabic: 'Rima Najma Samir Noor Amal Hala Farah Sahar Layla Rami Zaina Tariq Maha Yasmin Lina Salma Hadi Nadir Reem Ziya Marwa Bilal Jamal Nada Bashir Azhar Hiba Dalia Sami Ward',
  swahili: 'Kito Bahari Amani Zuri Jabali Mawimbi Upepo Angaza Mwezi Nyota Nuru Pwani Tumaini Zawadi Mawingu Mvua Jua Asubuhi Jioni Dhow Jahazi Pamba Simba Twiga Kijani Miale Theluji Lulu Kisiwa Mbali',
  malagasy: 'Aina Haja Soa Vola Fara Lala Hery Miora Feno Tahina Mamy Tiana Lovasoa Andry Kanto Nofy Havoana Ala Avana Ranomasina Rivotra Onja Orana Vato Harena Sariaka Faniry Tsiory Mirana Anja',
  french: 'Aline Benoit Celeste Delphine Etienne Fleur Gaelle Henri Ines Jules Laure Marcel Noemie Odile Pierre Remi Sabine Thierry Vivien Yvette Adele Blaise Coralie Lucile Maelle Oriane Pascal Sylvie Tristan Veronique',
  english: 'Avery Blake Clement Darcy Ellis Fern Gwen Heath Iris Jasper Kit Laurel Morgan Nell Orson Paige Quinn Rowan Sage Tessa Una Violet Wesley Yarrow Ada Briar Clover Drew Hollis Jude',
  spanish: 'Alba Belen Camilo Diego Elena Felipe Gala Hugo Inigo Jacinta Leon Marisol Nerea Oriel Pilar Ramiro Sole Tomas Vega Ximena Abril Blanca Ciro Dulce Eloy Flora Gonzalo Isela Luz Nuria',
  portuguese: 'Afonso Beatriz Caio Dulcina Enzo Fatima Gil Iara Joana Leandro Matilde Nuno Olinda Paulo Quirino Rosa Silvia Teodoro Valter Zelia Adelia Bento Celina Duarte Estela Floriano Graca Heitor Inacio Jandira',
  atlanticIsles: 'Skerry Kittiwake Tern Puffin Gannet Petrel Wren Shearwater Osprey Merlin Kestrel Gorse Bracken Heather Thistle Juniper Hazel Sorrel Sedge Aster Plover Sandpiper Curlew Dunlin Fulmar Linnet Siskin Turnstone Egret Avocet',
  caribbean: 'Ceiba Manatee Hummingbird Coqui Anole Tamarind Guava Papaya Soursop Sapodilla Pelican Frigatebird Grouper Angelfish Snapper Calabash Flamboyant Seagrape Cashew Cacao Ocelot Macaw Agouti Jacana Jacaranda Cassava Mango Iguana Conch Mangrove',
  brazil: 'Acai Arara Buriti Caju Canario Cedro Curio Dourado Embauba Ipe Jatoba Jenipapo Juriti Lirio Maracuja Murici Mutum Ombu Pacu Pitanga Sabia Seringa Tabebuia Tucano Uirapuru Urucum Vitoria Araucaria Bromelia Jabuti',
  andes: 'Alpaca Altiplano Arrayan Atacama Cantuta Canelo Chasqui Chinchilla Chirimoya Chonta Colibri Copihue Condor Guanaco Huemul Kantu Llama Lucuma Maca Molle Nandu Niebla Pacay Paramela Puma Queuna Quinoa Salar Vicuna Yareta',
  polynesia: 'Aroha Hina Kai Lani Moana Nalu Nui Poerava Rangi Tiare Vaiana Atea Fetu Hoku Keanu Koa Leilani Mahina Manawa Naia Pua Raukura Tane Vai Anuenue Hokulea Kapua Maile Pounamu Reka',
  hawaii: 'Akala Aolani Ehu Hau Haukea Ilima Iolani Kaiao Kailani Kaulike Keala Keola Kiele Kilohana Kohala Kukui Liko Lokelani Makani Malie Manoa Nanea Noelani Ola Olena Palila Pikake Pololu Ulu Wehi',
  pacific: 'Atoll Auklet Bonito Breaker Cowrie Darter Driftwood Eelgrass Flyingfish Glasswort Harrier Heron Kingfisher Lagoon Manta Noddy Pumice Reef Sandbar Seamount Shoal Skua Spinner Spray Swell Tang Trevally Tropicbird Wahoo Whitecap',
  australia: 'Acacia Banksia Brolga Coolabah Corella Currawong Dingo Emu Galah Grevillea Gumnut Jabiru Jarrah Kookaburra Lorikeet Mallee Marri Numbat Quokka Rosella Saltbush Sheoak Spinifex Waratah Wattle Wombat Woylie Wallaby Yabby Boobook',
  aegean: 'Ariadne Daphne Eleni Fotis Gaia Helios Ione Jason Kallisto Leto Melina Nereus Orfeas Petros Rhea Selene Thalia Xenia Zephyros Amara Clio Dimos Eos Galini Iason Kyma Myrto Nefeli Ourania Stavros',
  italian: 'Aldo Bianca Chiara Dario Emilia Fiore Giada Italo Livia Marco Nerina Ottavio Piero Raffaele Serena Tullio Viola Zeno Alessia Bruna Cesare Diletta Enrico Gino Lia Mirella Orfeo Renata Silvio Vito',
  levant: 'Adana Aleppo Atlas Azur Barada Carob Cedar Cilicia Cypress Damask Dune Galilee Jasmine Juniperus Levant Mallow Mariner Mistral Myrrh Olive Orontes Phoenicia Pistachio Saffron Sirocco Tamarisk Thyme Tyre Vesper Zefir',
  indianSea: 'Albatross Ambergris Banyan Barbet Bayleaf Cardamom Clove Cinnamon Coir Coriander Ibis Drongo Ebony Flameback Frangipani Gecko Hornbill Lapwing Lotus Monal Myna Nutmeg Pepper Raffia Roller Sandalwood Shama Starling Sunbird Teak',
  eastPac: 'Abalone Anchovy Booby Cormorant Dolphin Eider Garibaldi Grunion Halibut Jaeger Kelpfish Limpet Mackerel Marlin Murre Nautilus Orca Otter Porpoise Rockfish Sablefish Sardine Scallop Sculpin Seastar Sealion Silverside Tattler Urchin Wrasse',
  islands: 'Aldabra Anjouan Chagos Comoro Farallon Isabela Kanton Kiritimati Lifou Mahe Majuro Manihiki Mare Midway Minami Nauru Niue Palau Pemba Pohnpei Rapa Rarotonga Reunion Rodrigues Savai Tahaa Tokelau Tubuai Vava Viti',
  ocean: 'Aurora Beacon Breeze Cirrus Compass Coral Crest Current Dew Echo Eddy Gale Gleam Gust Halo Horizon Lantern Mist Nimbus Pearl Prism Ripple Sail Shimmer Sound Spindrift Tide Twilight Veil Zephyr',
  sahel: 'Aissatou Amadou Awa Bakary Binta Cheikh Demba Diarra Fatou Fode Ibrahima Issa Kadidia Kadiatou Khady Lamine Malick Mariama Moussa Nafi Oumar Penda Rokhaya Sadio Samba Seydou Sokhna Souleymane Yacine Amina',
};
const regions = {
  'northwest-pacific': 'chinese japanese korean southeast pacific micronesia',
  'central-pacific': 'hawaii polynesia pacific eastPac ocean islands',
  'northeast-pacific': 'spanish eastPac caribbean pacific english mexico',
  'north-atlantic': 'english french spanish caribbean sahel atlanticIsles',
  'south-atlantic': 'portuguese brazil sahel gulfGuinea atlanticIsles french',
  'north-indian': 'india arabic southeast indianSea swahili ocean',
  'southwest-indian': 'malagasy swahili french india indianSea mascarene',
  australian: 'australia southeast english islands pacific indianSea',
  'south-pacific': 'polynesia islands australia pacific french hawaii',
  'southeast-pacific': 'andes spanish eastPac polynesia pacific ocean',
  mediterranean: 'aegean italian arabic french levant spanish',
};
export const namePools = Object.freeze(Object.fromEntries(Object.entries(regions).map(([k, groups]) =>
  [k,Object.freeze(groups.split(' ').flatMap(g => families[g].split(' ')))])));

// Central American isthmus divides Atlantic and Pacific waters; a simple
// longitude split alone mislabels the Gulf of Mexico and Pacific side of Mexico.
const divide = [[7,-77.5],[9,-80],[11,-85],[15,-88],[17,-94],[20,-99],[24,-104],[30,-108]];
export function namingBasin(longitude, lat) {
  const lon = wrapLongitude(longitude);
  if (isMediterranean(lon,lat)) return 'mediterranean';
  if (lat < 0) {
    if (lon >= 20 && lon < 90) return 'southwest-indian';
    if (lon >= 90 && lon < 160) return 'australian';
    if (lon >= 160 || lon < -120) return 'south-pacific';
    return lon < -70 ? 'southeast-pacific' : 'south-atlantic';
  }
  if (lon >= 40 && lon < 100) return 'north-indian';
  if (lon >= 100) return 'northwest-pacific';
  if (lon < -140) return 'central-pacific';
  let edge = divide[0][1];
  for (let i=1;i<divide.length;i++) {
    const [a,x] = divide[i-1], [b,y] = divide[i];
    edge = x + (y-x)*Math.max(0,Math.min(1,(lat-a)/(b-a)));
    if (lat<=b) break;
  }
  return lon < edge ? 'northeast-pacific' : 'north-atlantic';
}

export class StormNames {
  constructor(random) { this.random = random; this.decks = new Map(); }
  draw(basin, active) {
    let deck = this.decks.get(basin);
    const refill = () => {
      deck = [...namePools[basin]];
      for (let i=deck.length-1; i>0; i--) {
        const j = Math.floor(this.random()*(i+1));
        [deck[i],deck[j]] = [deck[j],deck[i]];
      }
      this.decks.set(basin,deck);
    };
    if (!deck?.length) refill();
    // Neighbouring regions share some names; avoid simultaneous duplicates even
    // if a named storm has since crossed into another basin.
    let i = deck.findLastIndex(name => !active.has(name));
    if (i < 0) { refill(); i = deck.findLastIndex(name => !active.has(name)); }
    return deck.splice(i,1)[0];
  }
}
