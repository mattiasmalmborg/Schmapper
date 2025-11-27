# Schmapper - Funktionsguide

Detta dokument beskriver hur Schmapper fungerar med fokus på transformeringar och villkorsfunktioner.

## Innehåll

1. [Översikt](#översikt)
2. [Transformeringsfunktioner](#transformeringsfunktioner)
3. [Villkorsfunktioner](#villkorsfunktioner)
4. [Upprepande Element](#upprepande-element)
5. [Rekursiva Element](#rekursiva-element)
6. [Praktiska Exempel](#praktiska-exempel)

---

## Översikt

Schmapper är en dataomvandlingsapplikation som transformerar data mellan CSV och XML-format. Applikationen består av:

- **Backend (FastAPI)**: Hanterar schema-parsning och dataomvandling
- **Frontend (React)**: Användargränssnitt för att konfigurera mappningar

### Grundläggande Arbetsflöde

1. **Ladda upp scheman**: CSV-schema (källdata) och XSD-schema (målformat)
2. **Konfigurera mappningar**: Koppla källfält till målfält
3. **Lägg till transformeringar**: Bearbeta data under omvandlingen
4. **Lägg till villkor**: Filtrera vilka element som ska mappas
5. **Batch-processning**: Omvandla flera filer samtidigt

---

## Transformeringsfunktioner

Transformeringsfunktioner bearbetar data under mappningen från källa till mål. Varje mappning kan ha en eller flera transformeringar som tillämpas i sekvens.

### Tillgängliga Transformeringar

#### 1. **uppercase** - Konvertera till versaler

**Beskrivning**: Konverterar all text till stora bokstäver.

**Input**: Sträng
**Output**: Sträng i versaler

**Exempel**:
```
Input:  "Anna Andersson"
Output: "ANNA ANDERSSON"
```

**Användning i UI**:
- Klicka på "Transformera" på en mappning
- Välj "uppercase"
- Ingen parameter krävs

---

#### 2. **lowercase** - Konvertera till gemener

**Beskrivning**: Konverterar all text till små bokstäver.

**Input**: Sträng
**Output**: Sträng i gemener

**Exempel**:
```
Input:  "Anna Andersson"
Output: "anna andersson"
```

---

#### 3. **trim** - Ta bort whitespace

**Beskrivning**: Tar bort mellanslag och whitespace från början och slutet av texten.

**Input**: Sträng med whitespace
**Output**: Trimmed sträng

**Exempel**:
```
Input:  "  Anna Andersson  "
Output: "Anna Andersson"
```

---

#### 4. **concat** - Sammanfoga strängar

**Beskrivning**: Sammanfogar flera värden med en separator.

**Input**: Flera värden
**Parameter**: Separator (t.ex. " ", "-", ", ")
**Output**: Sammanfogad sträng

**Exempel**:
```
Parameter: " "
Input:  ["Anna", "Maria", "Andersson"]
Output: "Anna Maria Andersson"

Parameter: "-"
Input:  ["2024", "01", "15"]
Output: "2024-01-15"
```

**Användning i UI**:
- Välj "concat"
- Ange separator i parameterfältet (t.ex. " " eller "-")

---

#### 5. **replace** - Ersätt text

**Beskrivning**: Ersätter alla förekomster av en text med en annan.

**Input**: Sträng
**Parameter**: Format `gammal_text|ny_text`
**Output**: Sträng med ersatt text

**Exempel**:
```
Parameter: "AB|Aktiebolag"
Input:  "Företag AB"
Output: "Företag Aktiebolag"

Parameter: "_| "
Input:  "Anna_Maria_Andersson"
Output: "Anna Maria Andersson"
```

**Användning i UI**:
- Välj "replace"
- Ange parametern: `sök_text|ersätt_med`
- Använd `|` som separator mellan sök och ersätt

---

#### 6. **regex** - Reguljärt uttryck

**Beskrivning**: Extraherar text baserat på ett regex-mönster.

**Input**: Sträng
**Parameter**: Regex-mönster (max 500 tecken)
**Output**: Matchande text

**Exempel**:
```
Parameter: "\\d{4}-\\d{2}-\\d{2}"
Input:  "Datum: 2024-01-15 kl 14:00"
Output: "2024-01-15"

Parameter: "[A-ZÅÄÖ][a-zåäö]+"
Input:  "anna andersson"
Output: "Anna" (första kapitaliserade ordet)
```

**Användning i UI**:
- Välj "regex"
- Ange regex-mönster i parameterfältet
- Notera: Backslash måste escapas (\\d för siffra)

---

#### 7. **format** - Formatera text

**Beskrivning**: Formaterar text enligt ett template med {0}, {1}, etc.

**Input**: En eller flera värden
**Parameter**: Template-sträng
**Output**: Formaterad sträng

**Exempel**:
```
Parameter: "{0} {1}"
Input:  ["Anna", "Andersson"]
Output: "Anna Andersson"

Parameter: "Tel: {0}, Fax: {1}"
Input:  ["08-123456", "08-123457"]
Output: "Tel: 08-123456, Fax: 08-123457"

Parameter: "{0} ({1})"
Input:  ["Stockholm", "Sverige"]
Output: "Stockholm (Sverige)"
```

**Användning i UI**:
- Välj "format"
- Ange template med {0}, {1}, {2}, etc.
- Placeholders ersätts med värden i ordning

---

#### 8. **default** - Standardvärde

**Beskrivning**: Använder ett standardvärde om input är tom eller saknas.

**Input**: Valfri sträng (kan vara tom)
**Parameter**: Standardvärde
**Output**: Input om den finns, annars standardvärde

**Exempel**:
```
Parameter: "Okänt"
Input:  ""
Output: "Okänt"

Parameter: "N/A"
Input:  null
Output: "N/A"

Parameter: "0"
Input:  "42"
Output: "42" (input finns, standardvärde används ej)
```

**Användning i UI**:
- Välj "default"
- Ange standardvärdet i parameterfältet

---

#### 9. **sanitize** - Sanera specialtecken

**Beskrivning**: Tar bort eller ersätter farliga specialtecken för XML/XPath-säkerhet.

**Input**: Sträng
**Output**: Sanerad sträng

**Tecken som tas bort**: `;`, `|`, `&`, `$`, `` ` ``

**Exempel**:
```
Input:  "Företag & Co; AB"
Output: "Företag  Co AB"

Input:  "Test | Data"
Output: "Test  Data"
```

---

### Kombinera Transformeringar

Transformeringar tillämpas i sekvens - output från en blir input till nästa.

**Exempel: Formatera och versaler**
```
1. trim:      "  anna andersson  " → "anna andersson"
2. uppercase: "anna andersson" → "ANNA ANDERSSON"
```

**Exempel: Replace och format**
```
Input: ["Anna_Andersson", "Developer"]
1. replace (parameter "_| "): "Anna_Andersson" → "Anna Andersson"
2. format (parameter "{0} ({1})"): "Anna Andersson (Developer)"
```

---

## Villkorsfunktioner

Villkorsfunktioner (Conditions) filtrerar vilka källelement som ska mappas till målet. Detta är särskilt användbart för:
- Upprepande element med olika betydelser
- Rekursiva strukturer (samma elementtyp på flera nivåer)
- Selektiv dataimport baserat på attribut eller värden

### Hur Villkor Fungerar

1. **Villkor läggs till på mappningar**: Varje mappning kan ha ett eller flera villkor
2. **AND-logik**: Alla villkor måste matcha för att mappningen ska tillämpas
3. **Element-kontext**: Villkor evalueras mot varje källelement individuellt
4. **Tillgänglig data**:
   - Elementattribut (t.ex. `@name`, `@id`, `@dataType`)
   - Elementvärden (t.ex. `value` från `<value>text</value>`)
   - Barnelement

### Villkorsoperatorer

#### 1. **equals** (=) - Exakt matchning

**Beskrivning**: Fältet måste vara exakt lika med angivet värde (case-sensitive).

**Användning**: När du vet exakt vilket värde som ska matchas.

**Exempel**:
```
Villkor: @name = "Author"
Matchar: <element name="Author">...</element>
Matchar EJ: <element name="author">...</element>
Matchar EJ: <element name="Author Name">...</element>
```

---

#### 2. **contains** - Innehåller

**Beskrivning**: Fältet måste innehålla angivet värde någonstans i texten.

**Användning**: Partiell matchning, sök efter delsträngar.

**Exempel**:
```
Villkor: @name contains "Author"
Matchar: <element name="Author">...</element>
Matchar: <element name="Book Author">...</element>
Matchar: <element name="AuthorName">...</element>
Matchar EJ: <element name="Writer">...</element>
```

---

#### 3. **startswith** - Börjar med

**Beskrivning**: Fältet måste börja med angivet värde.

**Användning**: Prefix-matchning, gruppera relaterade element.

**Exempel**:
```
Villkor: @dataType startswith "string"
Matchar: <element dataType="string">...</element>
Matchar: <element dataType="string-long">...</element>
Matchar EJ: <element dataType="integer">...</element>
```

---

#### 4. **regex** - Reguljärt uttryck

**Beskrivning**: Fältet måste matcha ett regex-mönster (max 500 tecken).

**Användning**: Komplex mönstermatchning.

**Exempel**:
```
Villkor: @name regex "Author[0-9]+"
Matchar: <element name="Author1">...</element>
Matchar: <element name="Author42">...</element>
Matchar EJ: <element name="Author">...</element>

Villkor: value regex "\\d{4}-\\d{2}-\\d{2}"
Matchar: <element><value>2024-01-15</value></element>
Matchar EJ: <element><value>2024/01/15</value></element>
```

---

#### 5. **exists** - Existerar

**Beskrivning**: Fältet måste finnas och innehålla ett icke-tomt värde.

**Användning**: Kontrollera att ett fält eller attribut existerar.

**Exempel**:
```
Villkor: @id exists
Matchar: <element id="123">...</element>
Matchar: <element id="abc">...</element>
Matchar EJ: <element>...</element>
Matchar EJ: <element id="">...</element>
```

---

### Tillgängliga Fält för Villkor

När du skapar villkor kan du kontrollera följande fält:

| Fält | Beskrivning | Exempel |
|------|-------------|---------|
| `@name` | Attributet "name" på elementet | `<element name="Author">` → "Author" |
| `@dataType` | Attributet "dataType" | `<element dataType="string">` → "string" |
| `@id` | Attributet "id" | `<element id="123">` → "123" |
| `@type` | Attributet "type" | `<element type="person">` → "person" |
| `value` | Textinnehåll i barnelement `<value>` | `<element><value>Anna</value></element>` → "Anna" |
| `property` | Egenskap från barnelement | `<element><property>...</property></element>` |

---

### Exempel på Villkorsanvändning

#### Exempel 1: Filtrera på attributnamn

**Scenario**: XML med upprepande `<element>` men olika användning baserat på `@name`.

**Källdata**:
```xml
<data>
  <element name="Author">Anna Andersson</element>
  <element name="Title">Bokens Titel</element>
  <element name="Publisher">Förlag AB</element>
</data>
```

**Mappningar med villkor**:

1. **Mappning 1**: `element` → `author`
   - Villkor: `@name = "Author"`
   - Resultat: Endast "Anna Andersson" mappas till `<author>`

2. **Mappning 2**: `element` → `title`
   - Villkor: `@name = "Title"`
   - Resultat: Endast "Bokens Titel" mappas till `<title>`

**Output**:
```xml
<book>
  <author>Anna Andersson</author>
  <title>Bokens Titel</title>
</book>
```

---

#### Exempel 2: Kombinera flera villkor (AND-logik)

**Scenario**: Mappa endast element som har både specifikt namn OCH datatyp.

**Källdata**:
```xml
<data>
  <field name="age" dataType="integer">42</field>
  <field name="age" dataType="string">forty-two</field>
  <field name="name" dataType="string">Anna</field>
</data>
```

**Mappning med två villkor**:
- Villkor 1: `@name = "age"`
- Villkor 2: `@dataType = "integer"`

**Resultat**: Endast `<field name="age" dataType="integer">42</field>` mappas.

---

#### Exempel 3: Filtrera rekursiva element

**Scenario**: ERMS-schema med rekursiva `ownElement` som används för olika syften.

**Källdata**:
```xml
<ownElement name="Document">
  <ownElement name="Metadata">
    <ownElement name="Author">Anna</ownElement>
    <ownElement name="Date">2024-01-15</ownElement>
  </ownElement>
</ownElement>
```

**Mappningar**:

1. **Mappning 1**: `ownElement` → `author`
   - Villkor: `@name = "Author"`

2. **Mappning 2**: `ownElement` → `date`
   - Villkor: `@name = "Date"`

Detta tillåter att mappa samma rekursiva element flera gånger med olika filter.

---

#### Exempel 4: Regex för mönstermatchning

**Scenario**: Mappa fält som följer ett namnmönster.

**Villkor**: `@name regex "field_[0-9]+"`

**Matchar**:
- `<element name="field_1">`
- `<element name="field_42">`
- `<element name="field_999">`

**Matchar EJ**:
- `<element name="field_a">`
- `<element name="fieldname">`
- `<element name="field">`

---

### Hur man använder Villkor i UI

1. **Öppna mappning**: Klicka på en befintlig mappning för att visa detaljer

2. **Klicka på "Villkor"**: Knappen finns bredvid "Transformera"
   - Amber/brun färg
   - Visar antal aktiva villkor som badge (t.ex. "3")

3. **Lägg till villkor**:
   - Välj **Fält** från dropdown (t.ex. `@name`)
   - Välj **Operator** (t.ex. `equals`)
   - Ange **Värde** (om operator kräver det)
   - Klicka "+ Lägg till villkor" för fler

4. **Preview**: Varje villkor visar en preview:
   ```
   @name = "Author"
   ```

5. **Ta bort villkor**: Klicka på papperskorgen vid varje villkor

6. **Spara**: Klicka "Spara villkor"
   - Ogiltiga villkor (tomma värden) tas bort automatiskt
   - Mappningskortet visar nu antal villkor som badge

---

## Upprepande Element

Schmapper hanterar upprepande element (repeating elements) genom **container mappings**. En container-mappning loopar över upprepande källelement och tillämpar barn-mappningar på varje instans.

### Container-struktur

En container-mappning har följande egenskaper:

- **loop_element_path**: Sökväg till upprepande källelement (t.ex. `SchoolHealthRecord/Notes/Note`)
- **target_wrapper_path**: Målsökväg för mappade data
- **child_mappings**: Array av barn-mappningar som processas för varje instans
- **aggregation**: Hur flera instanser hanteras (repeat, merge, first, last)
- **params.mergeSeparator**: Separator för merge-läge (standard: `", "`)

### Aggregeringslägen

#### 1. **repeat** - Upprepa (Standard)

**Beskrivning**: Skapar en målinstans per källinstans. Används när målet är upprepande (`maxOccurs="unbounded"`).

**Exempel - SchoolHealthRecord med upprepande Notes**:

**Källdata (XML)**:
```xml
<SchoolHealthRecord>
  <Notes>
    <Note>
      <Date>2023-09-15</Date>
      <Author>Karin Sköterska</Author>
      <Text>Elev mår bra</Text>
    </Note>
    <Note>
      <Date>2024-01-20</Date>
      <Author>Olle Kurator</Author>
      <Text>Uppföljning stress</Text>
    </Note>
  </Notes>
</SchoolHealthRecord>
```

**Container-mappning**:
- Loop: `SchoolHealthRecord/Notes/Note`
- Target: `Leveransobjekt/Dokument/NotesCollection/Note` (upprepande)
- Aggregation: `repeat`
- Barn-mappningar:
  - `Date` → `Datum`
  - `Author` → `Författare`
  - `Text` → `Innehåll`

**Output**:
```xml
<Leveransobjekt>
  <Dokument>
    <NotesCollection>
      <Note>
        <Datum>2023-09-15</Datum>
        <Författare>Karin Sköterska</Författare>
        <Innehåll>Elev mår bra</Innehåll>
      </Note>
      <Note>
        <Datum>2024-01-20</Datum>
        <Författare>Olle Kurator</Författare>
        <Innehåll>Uppföljning stress</Innehåll>
      </Note>
    </NotesCollection>
  </Dokument>
</Leveransobjekt>
```

---

#### 2. **merge** - Slå samman (Auto-aktiveras för icke-upprepande mål)

**Beskrivning**: Kombinerar alla instanser till ett enda målfält med en separator. Detta läge aktiveras **automatiskt** när målfältet har `maxOccurs="1"` (icke-upprepande).

**Auto-aggregering i UI**:
När du drar ett upprepande källelement till ett icke-upprepande målfält:
1. UI sätter automatiskt `aggregation: "merge"`
2. Ett meddelande visas: "Målfältet kan bara förekomma 1 gång - alla instanser kombineras"
3. Du kan ange separator (standard: `", "`)

**Exempel - Samma Notes men till icke-upprepande Kommentar**:

**Källdata**: Samma som ovan (2 Note-element)

**Container-mappning**:
- Loop: `SchoolHealthRecord/Notes/Note`
- Target: `Leveransobjekt/Dokument/Kommentar` (icke-upprepande, `maxOccurs="1"`)
- Aggregation: `merge` (auto-aktiverad!)
- Separator: `", "`
- Barn-mappning (concat):
  - Källor: `Date`, `Author`, `Text`
  - Transform: `concat` med separator `" "`

**Output**:
```xml
<Leveransobjekt>
  <Dokument>
    <Kommentar>2023-09-15 Karin Sköterska Elev mår bra, 2024-01-20 Olle Kurator Uppföljning stress</Kommentar>
  </Dokument>
</Leveransobjekt>
```

**Så fungerar det:**
1. Backend samlar alla värden från alla instanser för varje barn-mappning
2. Värdena kombineras med merge-separatorn (`, ` i detta fall)
3. Ett enda målelement skapas (ingen wrapper, ingen nästling)

---

#### 3. **first** - Första instansen

**Beskrivning**: Använder endast första förekomsten av upprepande element.

**Användning**: När du bara behöver den första posten (t.ex. primär kontakt).

---

#### 4. **last** - Sista instansen

**Beskrivning**: Använder endast sista förekomsten av upprepande element.

**Användning**: När du behöver senaste värdet (t.ex. senaste uppdateringen)

---

### Kombination: Upprepande + Villkor

Du kan kombinera upprepande element med villkor för att filtrera vilka instanser som ska mappas.

**Exempel**:
```xml
Källa:
<data>
  <person type="employee">Anna</person>
  <person type="employee">Björn</person>
  <person type="consultant">Charlie</person>
</data>

Mappning med villkor:
- person → employee
- Villkor: @type = "employee"

Output:
<company>
  <employee>Anna</employee>
  <employee>Björn</employee>
</company>
```

---

## Rekursiva Element

Rekursiva element är element som refererar till sin egen typ, vilket skapar en potentiellt oändlig struktur.

### Detektering av Rekursion

Schmapper detekterar **TRUE type recursion**:
- Spårar vilka typer som besökts i den aktuella sökvägen
- När samma typ dyker upp igen = rekursion detekterad
- Markeras med `isRecursive: true`
- Visas i UI med orange ↻-ikon och orange kantlinje

**Exempel på rekursiv typ**:
```xsd
<xs:element name="ownElement" type="ownElementType"/>
<xs:complexType name="ownElementType">
  <xs:sequence>
    <xs:element name="ownElement" type="ownElementType" minOccurs="0" maxOccurs="unbounded"/>
  </xs:sequence>
</xs:complexType>
```

Detta skapar strukturen: `ownElement/ownElement/ownElement/...`

### Hantera Rekursiva Element

1. **Visuell indikation**: Orange ↻-ikon i trädet
2. **Tooltip**: Visar vilken typ som är rekursiv
3. **Villkor**: Använd villkor för att mappa olika nivåer/användningar
4. **Säkerhetsmax**: Backend stoppar vid djup 15 för att undvika oändliga loopar

### Praktiskt Exempel: ERMS-schema

ERMS (E-ARK Records Management System) använder rekursiva `ownElement`:

```xml
<ownElement name="Archive">
  <ownElement name="Series">
    <ownElement name="File">
      <ownElement name="Document">
        ...
      </ownElement>
    </ownElement>
  </ownElement>
</ownElement>
```

**Mappning med villkor**:
- `ownElement` → `archive` (villkor: `@name = "Archive"`)
- `ownElement` → `series` (villkor: `@name = "Series"`)
- `ownElement` → `file` (villkor: `@name = "File"`)
- `ownElement` → `document` (villkor: `@name = "Document"`)

---

## Praktiska Exempel

### Exempel 1: Komplett Personer-mappning

**Scenario**: Transformera CSV med persondata till XML med fullständig formatering.

**Källdata (CSV)**:
```csv
FirstName,LastName,Email,Phone
anna,andersson,ANNA@EXAMPLE.COM,  08-123456
björn,BERG,bjorn@test.se,08-654321
```

**Mappningar**:

1. **FirstName → firstName**
   - Transform 1: `trim` (ta bort whitespace)
   - Transform 2: `lowercase` (gemener)
   - Input: "anna" → Output: "anna"

2. **LastName → lastName**
   - Transform 1: `trim`
   - Transform 2: `lowercase`
   - Input: "BERG" → Output: "berg"

3. **Email → email**
   - Transform 1: `trim`
   - Transform 2: `lowercase`
   - Input: "ANNA@EXAMPLE.COM" → Output: "anna@example.com"

4. **Phone → phone**
   - Transform: `trim`
   - Input: "  08-123456  " → Output: "08-123456"

5. **Kombinerad → fullName**
   - Källor: `FirstName`, `LastName`
   - Transform: `format` med parameter `{0} {1}`
   - Input: ["anna", "andersson"] → Output: "anna andersson"

**Output (XML)**:
```xml
<persons>
  <person>
    <firstName>anna</firstName>
    <lastName>andersson</lastName>
    <fullName>anna andersson</fullName>
    <email>anna@example.com</email>
    <phone>08-123456</phone>
  </person>
  <person>
    <firstName>björn</firstName>
    <lastName>berg</lastName>
    <fullName>björn berg</fullName>
    <email>bjorn@test.se</email>
    <phone>08-654321</phone>
  </person>
</persons>
```

---

### Exempel 2: Villkorsstyrd metadata-mappning

**Scenario**: Mappa metadata från XML-källa med olika elementtyper.

**Källdata (XML)**:
```xml
<metadata>
  <property name="author" type="string">Anna Andersson</property>
  <property name="created" type="date">2024-01-15</property>
  <property name="pages" type="integer">350</property>
  <property name="isbn" type="string">978-3-16-148410-0</property>
  <property name="description" type="text">En bok om XML-mappning</property>
</metadata>
```

**Mappningar med villkor**:

1. **property → author**
   - Villkor: `@name = "author"`
   - Transform: `trim`

2. **property → created**
   - Villkor: `@name = "created"`

3. **property → pages**
   - Villkor: `@name = "pages"`

4. **property → isbn**
   - Villkor: `@name = "isbn"`

5. **property → description**
   - Villkor: `@name = "description"`
   - Transform: `trim`

**Output (XML)**:
```xml
<book>
  <author>Anna Andersson</author>
  <created>2024-01-15</created>
  <pages>350</pages>
  <isbn>978-3-16-148410-0</isbn>
  <description>En bok om XML-mappning</description>
</book>
```

---

### Exempel 3: Komplex villkorslogik med upprepande element

**Scenario**: Filtrera och mappa kontaktuppgifter baserat på typ.

**Källdata (XML)**:
```xml
<contacts>
  <contact type="email" primary="true">anna@example.com</contact>
  <contact type="email" primary="false">anna.work@company.se</contact>
  <contact type="phone" primary="true">08-123456</contact>
  <contact type="phone" primary="false">070-9876543</contact>
  <contact type="fax" primary="true">08-123457</contact>
</contacts>
```

**Mappningar**:

1. **contact → primaryEmail**
   - Villkor 1: `@type = "email"`
   - Villkor 2: `@primary = "true"`
   - Resultat: "anna@example.com"

2. **contact → emails** (repeat-to-single)
   - Villkor: `@type = "email"`
   - Resultat: Alla email-kontakter

3. **contact → primaryPhone**
   - Villkor 1: `@type = "phone"`
   - Villkor 2: `@primary = "true"`
   - Resultat: "08-123456"

4. **contact → phones** (repeat-to-single)
   - Villkor: `@type = "phone"`
   - Resultat: Alla phone-kontakter

**Output (XML)**:
```xml
<person>
  <primaryEmail>anna@example.com</primaryEmail>
  <emails>
    <email>anna@example.com</email>
    <email>anna.work@company.se</email>
  </emails>
  <primaryPhone>08-123456</primaryPhone>
  <phones>
    <phone>08-123456</phone>
    <phone>070-9876543</phone>
  </phones>
</person>
```

---

### Exempel 4: Rekursiv dokumentstruktur med villkor

**Scenario**: ERMS-liknande hierarki där samma elementtyp används på flera nivåer.

**Källdata (XML)**:
```xml
<record>
  <ownElement name="Archive" id="A001">
    <ownElement name="Series" id="S001">
      <ownElement name="File" id="F001">
        <ownElement name="Document" id="D001">
          Innehåll
        </ownElement>
      </ownElement>
    </ownElement>
  </ownElement>
</record>
```

**Mappningar med villkor** (alla från samma `ownElement`):

1. **ownElement → archive**
   - Villkor: `@name = "Archive"`
   - Mappning av `@id` → `archiveId`

2. **ownElement → series**
   - Villkor: `@name = "Series"`
   - Mappning av `@id` → `seriesId`

3. **ownElement → file**
   - Villkor: `@name = "File"`
   - Mappning av `@id` → `fileId`

4. **ownElement → document**
   - Villkor: `@name = "Document"`
   - Mappning av `@id` → `documentId`

**Output (XML)**:
```xml
<recordInfo>
  <archive>
    <archiveId>A001</archiveId>
  </archive>
  <series>
    <seriesId>S001</seriesId>
  </series>
  <file>
    <fileId>F001</fileId>
  </file>
  <document>
    <documentId>D001</documentId>
  </document>
</recordInfo>
```

---

## Tips och Best Practices

### Transformeringar

1. **Ordning spelar roll**: Transformeringar tillämpas i sekvens
   - Exempel: `trim` → `lowercase` → `replace`

2. **Använd trim tidigt**: Ta bort whitespace innan andra transformeringar

3. **Testa regex**: Använd en regex-testare (regex101.com) innan du lägger in mönster

4. **Kombinera enkla transforms**: Hellre flera enkla än en komplex

5. **Default för säkerhet**: Använd `default`-transform för att undvika tomma fält

### Villkor

1. **Starta enkelt**: Använd `equals` och `contains` först, gå till `regex` vid behov

2. **Testa ett villkor i taget**: Lägg till villkor gradvis för att förstå beteendet

3. **AND-logik**: Kom ihåg att ALLA villkor måste matcha
   - För OR-logik: skapa flera separata mappningar

4. **Case-sensitive**: `equals`, `contains`, `startswith` skiljer på stora/små bokstäver
   - För case-insensitive: använd `regex` med `(?i)` flag

5. **Exists är snabbt**: Använd `exists` för att kontrollera att fält finns innan du kollar värde

### Prestanda

1. **Begränsa regex**: Max 500 tecken, undvik extremt komplexa mönster

2. **Filtrera tidigt**: Använd villkor för att reducera mängden data som processas

3. **Batch-storlek**: Processar flera filer parallellt, men var medveten om minnesanvändning

4. **Recursionsdjup**: Backend stoppar vid djup 15 för rekursiva element

---

## Felsökning

### Transformeringar fungerar inte

**Problem**: Transformering ger oväntat resultat

**Lösningar**:
1. Kontrollera parameterns format (t.ex. `|` i replace, `{0}` i format)
2. Verifiera ordningen på transformeringar
3. Använd browser console för att se loggmeddelanden
4. Testa med enkla data först

### Villkor matchar inte

**Problem**: Element mappas inte trots att villkor verkar korrekta

**Lösningar**:
1. Kontrollera case-sensitivity (stora/små bokstäver)
2. Verifiera att fältet existerar (använd browser inspector på källdata)
3. Testa med `exists`-operator först
4. Kontrollera att alla villkor i AND-kedjan matchar
5. Kolla backend-loggen för condition evaluation messages

### Rekursiva element

**Problem**: Rekursiva element visas inte eller mappas fel

**Lösningar**:
1. Kolla om orange ↻-ikon visas i UI
2. Använd villkor för att skilja på olika användningar av samma typ
3. Kontrollera att mappningen inte stoppar vid för lågt djup
4. Läs backend-loggen för "RECURSIVE TYPE detected" meddelanden

### Output saknar data

**Problem**: XML-output är ofullständig

**Lösningar**:
1. Kontrollera att källa och mål är korrekt mappade
2. Verifiera att villkor inte filtrerar bort för mycket
3. Kontrollera repeating element modes (wrapper vs. repeat-to-single)
4. Använd "Visa Logg" i UI för att se detaljerad processning

---

## API-referens (för utvecklare)

### Backend Endpoints

**POST /api/parse-csv-schema**
- Parsar CSV-schema från fil
- Returns: `Schema` objekt med fields array

**POST /api/parse-xsd-schema**
- Parsar XSD-schema med rekursionsdetektering
- Returns: `Schema` objekt med fields array, isRecursive flags

**POST /api/batch-process**
- Processar flera filer med mappningar, transforms, och conditions
- Body: Mappings, constants, source/target schemas
- Returns: Process logs och resultat

### Datamodeller

**MappingCondition**:
```json
{
  "field": "string (@name, @id, value, etc.)",
  "operator": "string (equals, contains, startswith, regex, exists)",
  "value": "string (optional, not needed for exists)"
}
```

**Mapping**:
```json
{
  "id": "string",
  "sourceField": "string",
  "targetField": "string",
  "transforms": ["array of transforms"],
  "conditions": ["array of MappingCondition"]
}
```

---

## Versionshistorik

### v1.3 (2025-11)
- ✅ Container mappings för upprepande element
- ✅ Auto-aggregering för icke-upprepande målfält
- ✅ Merge-läge med konfigurerbar separator
- ✅ 4 aggregeringslägen: repeat, merge, first, last
- ✅ Barn-mappningar kopplade till containers
- ✅ Förbättrad hantering av upprepande XML-element

### v1.2 (2025-11)
- ✅ Villkorsfunktioner (Conditions) implementerade
- ✅ TRUE type recursion detection
- ✅ Rekursiva element med visuell indikation (↻-ikon)
- ✅ 5 villkorsoperatorer: equals, contains, startswith, regex, exists
- ✅ AND-logik för flera villkor
- ✅ ConditionEditor modal i UI

### v1.1
- Transformeringsfunktioner: 9 olika transforms
- Batch-processning
- React frontend + FastAPI backend

### v1.0
- Grundläggande schema-parsning (CSV, XSD)
- Field mappings
- Grundläggande XML-transformering

---

## Support och Dokumentation

- **API Docs**: http://localhost:8000/docs (när backend körs)
- **Frontend**: http://localhost:3000
- **Kodstruktur**: Se CLAUDE.md för utvecklardokumentation
- **Källkod**: backend/main.py och frontend/src/App.js

---

*Dokumentet uppdaterat: 2025-11-28*
