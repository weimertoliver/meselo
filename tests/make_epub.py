"""Tesztkönyvek a Mesélőhöz: EPUB3 (nav), EPUB2 (NCX, ISO-8859-2) és egy DRM-es minta."""
import os, struct, zlib, zipfile, sys

OUT = sys.argv[1] if len(sys.argv) > 1 else 'tests/out'
os.makedirs(OUT, exist_ok=True)


def png(w, h, rgb):
    raw = b''.join(b'\x00' + bytes(rgb) * w for _ in range(h))
    def chunk(t, d):
        return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b''))


CONTAINER = '''<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>'''


def xhtml(title, body, enc='UTF-8', extra_ns=True):
    ns = ' xmlns:epub="http://www.idpf.org/2007/ops"' if extra_ns else ''
    return (f'<?xml version="1.0" encoding="{enc}"?>\n<!DOCTYPE html>\n'
            f'<html xmlns="http://www.w3.org/1999/xhtml"{ns} lang="hu" xml:lang="hu">\n'
            f'<head><title>{title}</title></head>\n<body>\n{body}\n</body></html>')


CH1 = xhtml('Első fejezet', '''<section epub:type="chapter">
<h1>Első fejezet</h1>
<p>Kovács úr 1848. március 15-én kelt útra, és kb. 3 óra alatt ért be a városba.<a epub:type="noteref" href="notes.xhtml#n1"><sup>1</sup></a> A kocsis Petõfi verseit dúdolta.</p>
<p>– Hová megyünk? – kérdezte a fia.</p>
<p>– A XX. kerületbe – felelte. – Onnan már csak 2 km.</p>
<p>Lágy kötőjel próbája: fel­ol­vas­ni jó.</p>
</section>''')

CH2_LATIN2 = xhtml('Második', '''<h2>Második fejezet</h2>
<p>Ez a fejezet ISO-8859-2 kódolású. Árvíztűrő tükörfúrógép: őrült ŐŰ.&nbsp;Szép.</p>
<div><p id="kiteres">Egy kis kitérő: a 2000-es évek elején történt.</p><p>Második bekezdés a div-ben.</p></div>
<div>Laza szöveg div-ben <em>kiemeléssel</em>.<p>És egy p a div-ben.</p></div>''', enc='iso-8859-2', extra_ns=False)

CH3 = xhtml('Harmadik', '''<h2>Harmadik fejezet</h2>
<p class="verse">Még nyílnak a völgyben a kerti virágok,<br/>Még zöldel a nyárfa az ablak előtt,<br/>De látod amottan a téli világot?</p>
<hr/>
<p>* * *</p>
<p>Vége.</p>
<aside epub:type="footnote" id="fn9"><p>Ez egy lábjegyzet, nem szabad felolvasni.</p></aside>''')

NOTES = xhtml('Jegyzetek', '<p id="n1">1. Jegyzet a nem lineáris részben.</p>')
COVER = xhtml('Borító', '<div><img src="../images/cover.png" alt="Borító"/></div>')

NAV = xhtml('Tartalom', '''<nav epub:type="toc" id="toc"><h1>Tartalom</h1>
<ol>
  <li><a href="text/fejezet%201.xhtml">Első fejezet</a></li>
  <li><a href="text/ch2.xhtml">Második fejezet</a>
    <ol><li><a href="text/ch2.xhtml#kiteres">Egy kis kitérő</a></li></ol>
  </li>
  <li><a href="text/ch3.xhtml">Harmadik fejezet</a></li>
</ol></nav>''')

OPF3 = '''<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">urn:uuid:5b0c1b9e-6a8f-4a59-9a51-meselo-teszt3</dc:identifier>
    <dc:title>A próbakönyv</dc:title>
    <dc:creator>Teszt Elek</dc:creator>
    <dc:language>hu</dc:language>
    <meta property="dcterms:modified">2026-10-20T12:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="cover-img" href="images/cover.png" media-type="image/png" properties="cover-image"/>
    <item id="cover" href="text/cover.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch1" href="text/fejezet%201.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch2" href="text/ch2.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch3" href="text/ch3.xhtml" media-type="application/xhtml+xml"/>
    <item id="notes" href="text/notes.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="cover"/><itemref idref="ch1"/><itemref idref="ch2"/><itemref idref="ch3"/>
    <itemref idref="notes" linear="no"/>
  </spine>
</package>'''

OPF2 = '''<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="BookId">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:title>Régi kódolású könyv</dc:title>
    <dc:creator opf:role="aut">Próba Béla</dc:creator>
    <dc:language>hu</dc:language>
    <dc:identifier id="BookId">meselo-teszt-epub2</dc:identifier>
    <meta name="cover" content="cover-img"/>
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="cover-img" href="Images/cover.png" media-type="image/png"/>
    <item id="c2" href="Text/ch2.xhtml" media-type="application/xhtml+xml"/>
    <item id="c3" href="Text/ch3.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine toc="ncx"><itemref idref="c2"/><itemref idref="c3"/></spine>
</package>'''

NCX = '''<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head><meta name="dtb:uid" content="meselo-teszt-epub2"/></head>
  <docTitle><text>Régi kódolású könyv</text></docTitle>
  <navMap>
    <navPoint id="p1" playOrder="1"><navLabel><text>Latin-2 fejezet</text></navLabel><content src="Text/ch2.xhtml"/>
      <navPoint id="p1a" playOrder="2"><navLabel><text>Kitérő</text></navLabel><content src="Text/ch2.xhtml#kiteres"/></navPoint>
    </navPoint>
    <navPoint id="p2" playOrder="3"><navLabel><text>Vers</text></navLabel><content src="Text/ch3.xhtml"/></navPoint>
  </navMap>
</ncx>'''

ENCRYPTION = '''<?xml version="1.0" encoding="UTF-8"?>
<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:enc="http://www.w3.org/2001/04/xmlenc#">
  <enc:EncryptedData>
    <enc:EncryptionMethod Algorithm="http://www.w3.org/2001/04/xmlenc#aes128-cbc"/>
    <enc:CipherData><enc:CipherReference URI="OEBPS/text/fejezet%201.xhtml"/></enc:CipherData>
  </enc:EncryptedData>
</encryption>'''


def write(path, files):
    with zipfile.ZipFile(path, 'w') as z:
        z.writestr(zipfile.ZipInfo('mimetype'), 'application/epub+zip', compress_type=zipfile.ZIP_STORED)
        for name, data in files:
            z.writestr(name, data, compress_type=zipfile.ZIP_DEFLATED)


cover = png(60, 90, (34, 66, 180))
write(os.path.join(OUT, 'probakonyv-epub3.epub'), [
    ('META-INF/container.xml', CONTAINER),
    ('OEBPS/content.opf', OPF3),
    ('OEBPS/nav.xhtml', NAV),
    ('OEBPS/images/cover.png', cover),
    ('OEBPS/text/cover.xhtml', COVER),
    ('OEBPS/text/fejezet 1.xhtml', CH1),
    ('OEBPS/text/ch2.xhtml', CH2_LATIN2.encode('iso-8859-2')),
    ('OEBPS/text/ch3.xhtml', CH3),
    ('OEBPS/text/notes.xhtml', NOTES),
])
write(os.path.join(OUT, 'regi-epub2.epub'), [
    ('META-INF/container.xml', CONTAINER),
    ('OEBPS/content.opf', OPF2),
    ('OEBPS/toc.ncx', NCX),
    ('OEBPS/Images/cover.png', png(60, 90, (180, 120, 30))),
    ('OEBPS/Text/ch2.xhtml', CH2_LATIN2.encode('iso-8859-2')),
    ('OEBPS/Text/ch3.xhtml', CH3),
])
write(os.path.join(OUT, 'drm-vedett.epub'), [
    ('META-INF/container.xml', CONTAINER),
    ('META-INF/encryption.xml', ENCRYPTION),
    ('OEBPS/content.opf', OPF3),
    ('OEBPS/nav.xhtml', NAV),
    ('OEBPS/text/fejezet 1.xhtml', os.urandom(3000)),
    ('OEBPS/text/ch2.xhtml', CH2_LATIN2.encode('iso-8859-2')),
    ('OEBPS/text/ch3.xhtml', CH3),
])
with open(os.path.join(OUT, 'nem-epub.epub'), 'wb') as f:
    f.write(b'Ez nem zip, csak szoveg.' * 10)
print('kész:', sorted(os.listdir(OUT)))
