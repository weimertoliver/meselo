// Mesélő · HuText egységtesztek: node tests/hutext.test.cjs
const H = require('../src/hutext.js');

const cases = [
  ['1848. március 15-én reggel', 'Ezernyolcszáznegyvennyolc március tizenötödikén reggel'],
  ['március 15.', 'Március tizenötödike.'],
  ['május 1-jén', 'Május elsején'],
  ['augusztus 20-án', 'Augusztus huszadikán'],
  ['október 23-a', 'Október huszonharmadika'],
  ['a március 15-i ünnepség', 'A március tizenötödikei ünnepség'],
  ['december 31-ig', 'December harmincegyedikéig'],
  ['január 2-től', 'Január másodikától'],
  ['március 15-ike', 'Március tizenötödike'],
  ['március 15. után', 'Március tizenötödike után'],
  ['március 15. napján', 'Március tizenötödik napján'],
  ['márc. 15-én', 'Március tizenötödikén'],
  ['2026. 10. 20.', 'Kétezer-huszonhat október huszadika.'],
  ['1848. III. 15-én', 'Ezernyolcszáznegyvennyolc március tizenötödikén'],
  ['3. fejezet', 'Harmadik fejezet'],
  ['a 20. század', 'A huszadik század'],
  ['XIV. Lajos', 'Tizennegyedik Lajos'],
  ['a II. világháború', 'A második világháború'],
  ['V. I. Lenin', 'V. I. Lenin'],
  ['XII.', 'Tizenkettedik.'],
  ['1.', 'Első.'],
  ['Láttam a XX. századot.', 'Láttam a huszadik századot.'],
  ['1848-ban', 'Ezernyolcszáznegyvennyolcban'],
  ['2000-ben', 'Kétezerben'],
  ['2026-ban', 'Kétezer-huszonhatban'],
  ['a 2000-es évek', 'A kétezres évek'],
  ['a 60-as évek', 'A hatvanas évek'],
  ['3-at', 'Hármat'],
  ['7-et', 'Hetet'],
  ['10-et', 'Tizet'],
  ['1000-et', 'Ezret'],
  ['2-t', 'Kettőt'],
  ['2-szer', 'Kétszer'],
  ['12-szer', 'Tizenkétszer'],
  ['2-en', 'Ketten'],
  ['5-en', 'Öten'],
  ['1-gyel', 'Eggyel'],
  ['4-gyel', 'Néggyel'],
  ['20-szal', 'Hússzal'],
  ['5-tel', 'Öttel'],
  ['5-vel', 'Öttel'],
  ['3-mal', 'Hárommal'],
  ['0-t', 'Nullát'],
  ['100-zal', 'Százzal'],
  ['6-tal', 'Hattal'],
  ['2-es', 'Kettes'],
  ['13-as', 'Tizenhármas'],
  ['1956-os', 'Ezerkilencszázötvenhatos'],
  ['2 ember', 'Két ember'],
  ['12 apostol', 'Tizenkét apostol'],
  ['Ennyi volt: 22.', 'Ennyi volt: huszonkettő.'],
  ['12 pontot', 'Tizenkét pontot'],
  ['kb. 3,5 km-re', 'Körülbelül három egész öt tized kilométerre'],
  ['0,25 liter', 'Nulla egész huszonöt század liter'],
  ['25%-kal olcsóbb', 'Huszonöt százalékkal olcsóbb'],
  ['50%', 'Ötven százalék'],
  ['2% volt', 'Két százalék volt'],
  ['4 990 Ft volt', 'Négyezer-kilencszázkilencven forint volt'],
  ['3 742 forintért', 'Háromezer-hétszáznegyvenkét forintért'],
  ['1 000 000 ember', 'Egymillió ember'],
  ['20 °C-on', 'Húsz Celsius-fokon'],
  ['5 kg-os', 'Öt kilogrammos'],
  ['8:30-kor', 'Nyolc óra harminc perckor'],
  ['8:00-kor', 'Nyolc órakor'],
  ['12:05-ig', 'Tizenkét óra öt percig'],
  ['dr. Kovács', 'Doktor Kovács'],
  ['Dr. Kovács Éva', 'Doktor Kovács Éva'],
  ['Mr. Darcy', 'Miszter Darcy'],
  ['alma, körte stb.', 'Alma, körte s a többi.'],
  ['alma stb. Aztán szilva.', 'Alma s a többi. Aztán szilva.'],
  ['pl. a busszal', 'Például a busszal'],
  ['az ún. tihanyi alapítólevél', 'Az úgynevezett tihanyi alapítólevél'],
  ['Kr. e. 44-ben', 'Krisztus előtt negyvennégyben'],
  ['Kr. u. 1055-ből', 'Krisztus után ezerötvenötből'],
  ['– Hová mész? – kérdezte.', 'Hová mész? kérdezte.'],
  ['– Nem tudom – felelte –, de majd meglátjuk.', 'Nem tudom, felelte, de majd meglátjuk.'],
  ['– Hallom – felelte a nagyapja. – Mintha valaki olvasna.', 'Hallom, felelte a nagyapja. Mintha valaki olvasna.'],
  ['augusztus 20-ától', 'Augusztus huszadikától'],
  ['május 1-jétől', 'Május elsejétől'],
  ['október 6-ára', 'Október hatodikára'],
  ['a 17–18. században', 'A tizenhetedik–tizennyolcadik században'],
  ['Ez történt 1990. Aztán', 'Ez történt ezerkilencszázkilencven. Aztán'],
  ['az 1. helyen', 'Az első helyen'],
  ['Ő lett az 1.', 'Ő lett az első.'],
  ['a 2. Magyar Hadsereg', 'A második Magyar Hadsereg'],
  ['1848–49-ben', 'Ezernyolcszáznegyvennyolc–negyvenkilencben'],
  ['2-3 ember', 'Két-három ember'],
  ['Petõfi Sándor', 'Petőfi Sándor'],
  ['fel­olvas', 'Felolvas'],
  ['½ kiló', 'Fél kiló'],
  ['1½ óra', 'Másfél óra'],
  ['2½ óra', 'Két és fél óra'],
  ['az M7-es úton', 'Az M hetes úton'],
  ['S még benne virít', 's még benne virít'],
  ['-5 fok', 'Mínusz öt fok'],
  ['3D film', 'Három D film'],
  ['007', 'Nulla nulla hét'],
  ['a 3., 4. és 5. fejezet', 'A harmadik, negyedik és ötödik fejezet'],
  ['Koltó, 1847. szeptember', 'Koltó, ezernyolcszáznegyvenhét szeptember'],
  ['a 3.-at', 'A harmadikat'],
  ['a 3-ik', 'A harmadik'],
  ['a 21-ik', 'A huszonegyedik'],
  ['a 8. kerületben', 'A nyolcadik kerületben'],
  ['ELSŐ FEJEZET', 'Első fejezet'],
  ['Az 1848. évi törvény', 'Az ezernyolcszáznegyvennyolcadik évi törvény'],
  ['a 2,5-szeresére', 'A két egész öt tizedszeresére'],
  ['A & B', 'A és B'],
];

let fail = 0;
for (const [input, want] of cases) {
  const got = H.normalizeForSpeech(input);
  if (got !== want) {
    fail++;
    console.log(`✗ ${JSON.stringify(input)}\n    várt:  ${want}\n    kapott: ${got}`);
  }
}

const dict = H.compileDict('Hermion = Hermájon\nChicago = Sikágó');
const d1 = H.normalizeForSpeech('Hermionét Chicagóban látta.', { dict });
if (d1 !== 'Hermájonét Sikágóban látta.') { fail++; console.log('✗ szótár:', d1); }

const splitCases = [
  ['– Hová mész? – kérdezte az anyja. – Haza – felelte Péter.',
    ['– Hová mész? – kérdezte az anyja.', '– Haza – felelte Péter.']],
  ['1848. március 15-én kitört a forradalom. A pesti ifjak gyülekeztek.',
    ['1848. március 15-én kitört a forradalom.', 'A pesti ifjak gyülekeztek.']],
  ['Ezt dr. Kovács mondta. Pl. az alma.', ['Ezt dr. Kovács mondta.', 'Pl. az alma.']],
  ['XIV. Lajos uralkodott. Utána XV. Lajos jött.', ['XIV. Lajos uralkodott.', 'Utána XV. Lajos jött.']],
  ['J. R. R. Tolkien írta. Ez igaz.', ['J. R. R. Tolkien írta.', 'Ez igaz.']],
  ['Alma, körte stb. Aztán szilva.', ['Alma, körte stb.', 'Aztán szilva.']],
  ['Várt... aztán elindult.', ['Várt... aztán elindult.']],
  ['Várt... Aztán elindult.', ['Várt...', 'Aztán elindult.']],
  ['Az 1. fejezet. A 2. Magyar Hadsereg.', ['Az 1. fejezet.', 'A 2. Magyar Hadsereg.']],
  ['Ez 1990. Akkor jött.', ['Ez 1990.', 'Akkor jött.']],
  ['Kr. e. 44-ben halt meg. Utána jött más.', ['Kr. e. 44-ben halt meg.', 'Utána jött más.']],
  ['„Gyere ide!” Aztán elment.', ['„Gyere ide!”', 'Aztán elment.']],
  ['Mit mondtál?! Nem hallom!', ['Mit mondtál?!', 'Nem hallom!']],
];
for (const [input, want] of splitCases) {
  const got = H.splitSentences(input).map((r) => input.slice(r.s, r.e));
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    fail++;
    console.log(`✗ bontás ${JSON.stringify(input)}\n    várt:  ${JSON.stringify(want)}\n    kapott: ${JSON.stringify(got)}`);
  }
}

const long = 'A régi ház, amelyet még a nagyapja épített a falu szélén, ' +
  'ahol a dűlőút a nyárfás felé kanyarodik, és ahol nyaranként a gyerekek egész nap a patakban fürödtek, ' +
  'most üresen állt; az ablakait bedeszkázták, a kertet felverte a gaz, ' +
  'és csak a kút fölé hajló öreg diófa emlékeztetett arra, hogy valaha mennyi élet volt itt, ' +
  'mennyi nevetés és mennyi vasárnapi ebéd a lugas alatt, amikor az egész család összegyűlt.';
const parts = H.splitSentences(long).map((r) => long.slice(r.s, r.e));
if (parts.length < 2 || parts.some((p) => p.length > 240) || parts.join(' ').replace(/\s+/g, ' ') !== long) {
  fail++; console.log('✗ hosszú mondat bontása:', parts.map((p) => p.length));
}

const verse = H.segmentBlock('Még nyílnak a völgyben a kerti virágok,\nMég zöldel a nyárfa az ablak előtt,\nDe látod amottan a téli világot?');
if (verse.length !== 3 || !verse[0].lineEnd || !verse[1].lineEnd || verse[2].lineEnd) { fail++; console.log('✗ versbontás', verse); }

const total = cases.length + splitCases.length + 3;
console.log(fail ? `\n${fail} hiba / ${total} teszt` : `Mind a ${total} teszt rendben.`);
process.exit(fail ? 1 : 0);
