#if DEBUG
import Foundation
import SippetCore

/// Launch argument `-SippetDemo`: a made-up library, no sign-in, no server, kept in demo-library.json.
/// Add `-SippetOffline` to show the offline state. Screenshots only.
enum DemoLibrary {
    static var isOn: Bool { ProcessInfo.processInfo.arguments.contains("-SippetDemo") }
    static var isOffline: Bool { ProcessInfo.processInfo.arguments.contains("-SippetOffline") }

    static var library: LibraryAtChange {
        let recipes = [decode(zupfkuchen), decode(spaghetti)] + simple
        return LibraryAtChange(seq: 1, recipes: recipes, organization: LibraryOrganization(
            tags: [
                TagView(name: "vegan", recipeIds: ["rcp_zupfkuchen", "rcp_dal", "rcp_curry", "rcp_ofengemuese"]),
                TagView(name: "süß", recipeIds: ["rcp_zupfkuchen", "rcp_bananenbrot", "rcp_zimtschnecken", "rcp_pfannkuchen"]),
                TagView(name: "Lieblingsessen der ganzen Familie", recipeIds: ["rcp_spaghetti", "rcp_pfannkuchen"]),
            ],
            collections: [
                CollectionView(name: "Kuchen & Gebäck", recipeIds: ["rcp_zupfkuchen", "rcp_bananenbrot", "rcp_zimtschnecken"]),
                CollectionView(name: "Schnell unter der Woche", recipeIds: ["rcp_spaghetti", "rcp_shakshuka", "rcp_dal", "rcp_pfannkuchen", "rcp_curry"]),
                CollectionView(name: "Sonntagsessen mit Freunden und Familie", recipeIds: ["rcp_kartoffelsuppe", "rcp_ofengemuese"]),
                CollectionView(name: "Weihnachten", recipeIds: []),
            ],
            smartCollections: [
                SmartCollectionView(name: "Unter 30 Minuten", filter: RecipeFilter(maxTotalMinutes: 30)),
            ]))
    }

    private static func decode(_ json: String) -> DeviceRecipe {
        try! SippetJSON.decoder().decode(DeviceRecipe.self, from: Data(json.utf8))
    }

    private static func recipe(
        _ id: String, _ title: String, minutes: Double?, serves: Double = 4, trashed: Bool = false,
        ingredients: [(String, Double?, UnitCode?)], steps: [String]
    ) -> DeviceRecipe {
        DeviceRecipe(
            id: id, revision: 1, title: title,
            yield: Yield(amount: Amount(value: serves, unit: .code(.serving))),
            trashedAt: trashed ? .now.addingTimeInterval(-86_400) : nil,
            purgeAt: trashed ? .now.addingTimeInterval(29 * 86_400) : nil,
            totalMinutes: minutes,
            ingredients: ingredients.enumerated().map { i, item in
                Ingredient(key: "i\(i)", item: item.0, amount: item.1.map { Amount(value: $0, unit: .code(item.2 ?? .piece)) })
            },
            steps: steps.enumerated().map { i, label in Step(key: "s\(i)", label: label) })
    }

    private static let simple: [DeviceRecipe] = [
        recipe("rcp_shakshuka", "Shakshuka", minutes: 30, ingredients: [
            ("Eier", 6, .piece), ("gehackte Tomaten", 2, .can), ("Paprika", 2, .piece), ("Zwiebel", 1, .piece), ("Kreuzkümmel", 1, .tsp),
        ], steps: ["Zwiebel und Paprika in Olivenöl weich dünsten.", "Tomaten und Gewürze dazugeben und 10 Minuten köcheln.", "Mulden formen, Eier hineinschlagen und zugedeckt stocken lassen."]),
        recipe("rcp_dal", "Linsen-Dal mit Kokosmilch", minutes: 35, ingredients: [
            ("rote Linsen", 250, .g), ("Kokosmilch", 400, .ml), ("Ingwer", 20, .g), ("Currypulver", 2, .tsp),
        ], steps: ["Ingwer und Curry in Öl anrösten.", "Linsen, Kokosmilch und Wasser dazugeben und weich kochen."]),
        recipe("rcp_bananenbrot", "Bananenbrot", minutes: 70, serves: 1, ingredients: [
            ("reife Bananen", 3, .piece), ("Mehl", 250, .g), ("Zucker", 80, .g), ("Backpulver", 1, .packet),
        ], steps: ["Bananen zerdrücken.", "Alle Zutaten verrühren.", "Bei 180 °C 55 Minuten backen."]),
        recipe("rcp_ofengemuese", "Ofengemüse mit Feta", minutes: 45, ingredients: [
            ("Kartoffeln", 600, .g), ("Zucchini", 1, .piece), ("Feta", 200, .g),
        ], steps: ["Gemüse schneiden, mit Öl mischen.", "Bei 200 °C 30 Minuten rösten, Feta darüberbröseln."]),
        recipe("rcp_pfannkuchen", "Pfannkuchen", minutes: 20, ingredients: [
            ("Mehl", 200, .g), ("Milch", 400, .ml), ("Eier", 2, .piece),
        ], steps: ["Alles zu einem glatten Teig verrühren.", "In einer heißen Pfanne dünn ausbacken."]),
        recipe("rcp_kartoffelsuppe", "Kartoffelsuppe", minutes: 50, ingredients: [
            ("Kartoffeln", 1, .kg), ("Lauch", 1, .piece), ("Gemüsebrühe", 1, .l),
        ], steps: ["Gemüse würfeln und andünsten.", "Mit Brühe ablöschen und 25 Minuten kochen.", "Pürieren und abschmecken."]),
        recipe("rcp_zimtschnecken", "Zimtschnecken", minutes: 150, serves: 12, ingredients: [
            ("Mehl", 500, .g), ("Hefe", 1, .packet), ("Zimt", 2, .tbsp),
        ], steps: ["Hefeteig kneten und gehen lassen.", "Ausrollen, füllen, aufrollen und schneiden.", "Bei 180 °C 20 Minuten backen."]),
        recipe("rcp_curry", "Rotes Thai-Curry mit knusprigem Tofu, Gemüse aus dem Wok und Jasminreis", minutes: 40, ingredients: [
            ("Tofu", 400, .g), ("rote Currypaste", 2, .tbsp), ("Kokosmilch", 400, .ml), ("Jasminreis", 250, .g),
        ], steps: ["Tofu würfeln und knusprig braten.", "Currypaste anrösten, Kokosmilch und Gemüse dazugeben.", "Mit Reis servieren."]),
        recipe("rcp_hefezopf", "Alter Hefezopf", minutes: 120, serves: 1, trashed: true, ingredients: [("Mehl", 500, .g)], steps: ["Backen."]),
    ]

    private static let zupfkuchen = #"""
{
 "revision": 2,
 "totalMinutes": 65,
 "equipment": [
  {
   "name": "Springform 26 cm",
   "key": "springform"
  },
  {
   "key": "ofen",
   "name": "Ofen"
  }
 ],
 "steps": [
  {
   "equipment": [
    "springform"
   ],
   "flow": {
    "waitsFor": [],
    "makes": false,
    "takes": []
   },
   "label": "Springform einfetten",
   "key": "einfetten",
   "sentence": "Springform einfetten, optional mit Backpapier auslegen."
  },
  {
   "section": "teig",
   "flow": {
    "waitsFor": [],
    "takes": [],
    "makes": true
   },
   "label": "mischen",
   "uses": [
    "mehl",
    "zucker-teig",
    "vanillezucker",
    "backpulver",
    "kakao",
    "salz"
   ],
   "key": "mischen",
   "sentence": "Mehl, Zucker, Vanillezucker, Backpulver, Kakao und Salz in einer Schüssel mischen."
  },
  {
   "flow": {
    "waitsFor": [],
    "makes": true,
    "takes": [
     "mischen"
    ]
   },
   "section": "teig",
   "key": "verkneten",
   "result": {
    "amount": {
     "unit": "g",
     "value": 750
    },
    "split": [
     {
      "name": "Boden",
      "key": "boden-teig",
      "amount": {
       "unit": "g",
       "value": 500
      }
     },
     {
      "name": "Zupfteig",
      "key": "zupfteig",
      "amount": {
       "value": 250,
       "unit": "g"
      }
     }
    ],
    "name": "Teig"
   },
   "uses": [
    "butter-teig"
   ],
   "label": "verkneten",
   "sentence": "Die vegane Butter dazugeben und alles zu einem glatten Teig verkneten."
  },
  {
   "takes": [
    "boden-teig"
   ],
   "section": "teig",
   "equipment": [
    "springform"
   ],
   "flow": {
    "waitsFor": [
     "einfetten"
    ],
    "makes": true,
    "takes": [
     "boden-teig"
    ]
   },
   "key": "boden",
   "label": "als Boden in die Form drücken, Rand ca. 2,5 cm",
   "sentence": "500 g Teig als Boden in die Springform drücken und dabei einen Rand von etwa 2,5 cm hochziehen. Den restlichen Teig für die Zupfen beiseitestellen."
  },
  {
   "sentence": "Den Ofen auf 170 °C Ober-/Unterhitze vorheizen.",
   "temperature": {
    "mode": "top_bottom",
    "celsius": 170
   },
   "equipment": [
    "ofen"
   ],
   "flow": {
    "waitsFor": [],
    "makes": false,
    "takes": []
   },
   "section": "fuellung",
   "key": "vorheizen",
   "label": "Ofen vorheizen"
  },
  {
   "uses": [
    "skyr",
    "zucker-fuellung",
    "zitronensaft",
    "zitronenaroma",
    "zitronenschale",
    "butter-fuellung"
   ],
   "sentence": "Skyr, Zucker, Zitronensaft, Zitronenaroma, Zitronenschale und die geschmolzene Butter mit dem Mixer gut verrühren.",
   "flow": {
    "waitsFor": [],
    "makes": true,
    "takes": []
   },
   "section": "fuellung",
   "key": "verruehren",
   "result": {
    "name": "Masse"
   },
   "label": "mit dem Mixer gut verrühren"
  },
  {
   "uses": [
    "puddingpulver"
   ],
   "sentence": "Das Puddingpulver untermixen, bis die Masse glatt ist.",
   "flow": {
    "waitsFor": [],
    "makes": true,
    "takes": [
     "verruehren"
    ]
   },
   "section": "fuellung",
   "key": "untermixen",
   "result": {
    "name": "Füllung"
   },
   "label": "Puddingpulver untermixen, bis die Masse glatt ist"
  },
  {
   "flow": {
    "waitsFor": [],
    "makes": true,
    "takes": [
     "boden",
     "untermixen",
     "zupfteig"
    ]
   },
   "label": "Füllung auf den Boden gießen, restlichen Teig als Zupfen darauf verteilen",
   "key": "giessen",
   "sentence": "Die Füllung auf den Boden gießen und den restlichen Teig als Zupfen darauf verteilen."
  },
  {
   "duration": {
    "minutes": 60,
    "maxMinutes": 65,
    "kind": "passive"
   },
   "sentence": "Im vorgeheizten Ofen 60–65 Minuten backen.",
   "temperature": {
    "celsius": 170,
    "mode": "top_bottom"
   },
   "equipment": [
    "ofen"
   ],
   "flow": {
    "takes": [
     "giessen"
    ],
    "makes": true,
    "waitsFor": [
     "vorheizen"
    ]
   },
   "key": "backen",
   "label": "backen"
  },
  {
   "equipment": [
    "ofen"
   ],
   "result": {
    "name": "Zupfkuchen"
   },
   "flow": {
    "takes": [
     "backen"
    ],
    "makes": true,
    "waitsFor": []
   },
   "label": "im geöffneten Ofen vollständig auskühlen",
   "key": "auskuehlen",
   "sentence": "Den Kuchen im geöffneten Ofen vollständig auskühlen lassen."
  }
 ],
 "hasFlow": true,
 "makes": [
  "auskuehlen"
 ],
 "sections": [
  {
   "name": "Teig",
   "key": "teig"
  },
  {
   "name": "Füllung",
   "key": "fuellung"
  }
 ],
 "ingredients": [
  {
   "key": "mehl",
   "item": "Mehl",
   "amount": {
    "unit": "g",
    "value": 300
   },
   "section": "teig"
  },
  {
   "section": "teig",
   "amount": {
    "value": 180,
    "unit": "g"
   },
   "key": "zucker-teig",
   "item": "Zucker"
  },
  {
   "section": "teig",
   "amount": {
    "unit": "packet",
    "value": 1
   },
   "key": "vanillezucker",
   "item": "Vanillezucker"
  },
  {
   "section": "teig",
   "amount": {
    "value": 1,
    "unit": "packet"
   },
   "key": "backpulver",
   "item": "Backpulver"
  },
  {
   "section": "teig",
   "amount": {
    "value": 50,
    "unit": "g"
   },
   "key": "kakao",
   "item": "Kakao"
  },
  {
   "section": "teig",
   "amount": {
    "unit": "tsp",
    "second": {
     "value": 2,
     "unit": "g"
    },
    "value": 0.25
   },
   "key": "salz",
   "item": "Salz"
  },
  {
   "section": "teig",
   "amount": {
    "unit": "g",
    "value": 200
   },
   "key": "butter-teig",
   "item": "vegane Butter"
  },
  {
   "section": "fuellung",
   "amount": {
    "second": {
     "value": 2,
     "unit": "tub"
    },
    "unit": "g",
    "value": 800
   },
   "key": "skyr",
   "item": "Vanille-Skyr"
  },
  {
   "section": "fuellung",
   "amount": {
    "unit": "g",
    "value": 200
   },
   "key": "zucker-fuellung",
   "item": "Zucker"
  },
  {
   "item": "Zitronensaft",
   "amount": {
    "value": 30,
    "unit": "g"
   },
   "section": "fuellung",
   "prep": "auspressen",
   "key": "zitronensaft"
  },
  {
   "item": "Zitronenaroma",
   "optional": true,
   "amount": {
    "unit": "bottle",
    "value": 0.5
   },
   "section": "fuellung",
   "key": "zitronenaroma"
  },
  {
   "item": "Zitronenschale",
   "optional": true,
   "amount": {
    "unit": "packet",
    "value": 1
   },
   "section": "fuellung",
   "key": "zitronenschale"
  },
  {
   "item": "vegane Butter",
   "amount": {
    "unit": "g",
    "value": 100
   },
   "section": "fuellung",
   "prep": "schmelzen",
   "key": "butter-fuellung"
  },
  {
   "item": "Puddingpulver",
   "amount": {
    "second": {
     "unit": "g",
     "value": 74
    },
    "unit": "packet",
    "value": 2
   },
   "section": "fuellung",
   "key": "puddingpulver"
  }
 ],
 "yield": {
  "amount": {
   "value": 12,
   "unit": "piece"
  },
  "vessel": "springform"
 },
 "id": "rcp_zupfkuchen",
 "title": "Veganer Russischer Zupfkuchen",
 "source": "https://veggie-einhorn.de/veganer-russischer-zupfkuchen/"
}
"""#

    private static let spaghetti = #"""
{
 "title": "Spaghetti al pomodoro",
 "hasFlow": true,
 "makes": [
  "servieren"
 ],
 "revision": 2,
 "steps": [
  {
   "key": "aufkochen",
   "label": "Wasser aufkochen und salzen",
   "uses": [
    "wasser",
    "salz"
   ],
   "flow": {
    "waitsFor": [],
    "takes": [],
    "makes": true
   }
  },
  {
   "key": "kochen",
   "label": "Spaghetti al dente kochen",
   "uses": [
    "spaghetti"
   ],
   "flow": {
    "takes": [
     "aufkochen"
    ],
    "waitsFor": [],
    "makes": true
   }
  },
  {
   "key": "sosse",
   "label": "Inzwischen Knoblauch in Öl anschwitzen, Tomaten dazugeben",
   "uses": [
    "olivenoel",
    "knoblauch",
    "tomaten"
   ],
   "flow": {
    "makes": true,
    "takes": [
     "kochen"
    ],
    "waitsFor": []
   }
  },
  {
   "key": "abgiessen",
   "label": "Spaghetti abgießen",
   "flow": {
    "takes": [
     "sosse"
    ],
    "waitsFor": [],
    "makes": true
   }
  },
  {
   "key": "vermengen",
   "label": "Spaghetti mit der Soße vermengen",
   "flow": {
    "takes": [
     "abgiessen"
    ],
    "makes": true,
    "waitsFor": []
   }
  },
  {
   "key": "servieren",
   "label": "mit Parmesan servieren",
   "uses": [
    "parmesan"
   ],
   "flow": {
    "takes": [
     "vermengen"
    ],
    "makes": true,
    "waitsFor": []
   }
  }
 ],
 "yield": {
  "amount": {
   "unit": "serving",
   "value": 4
  }
 },
 "id": "rcp_spaghetti",
 "sections": [],
 "ingredients": [
  {
   "amount": {
    "value": 4,
    "unit": "l"
   },
   "item": "Wasser",
   "key": "wasser"
  },
  {
   "amount": {
    "unit": "tbsp",
    "value": 1
   },
   "item": "Salz",
   "key": "salz"
  },
  {
   "amount": {
    "unit": "g",
    "value": 500
   },
   "item": "Spaghetti",
   "key": "spaghetti"
  },
  {
   "key": "olivenoel",
   "item": "Olivenöl",
   "amount": {
    "value": 3,
    "unit": "tbsp"
   }
  },
  {
   "key": "knoblauch",
   "item": "Knoblauch",
   "amount": {
    "value": 2,
    "unit": "clove"
   }
  },
  {
   "key": "tomaten",
   "item": "gehackte Tomaten",
   "amount": {
    "unit": "can",
    "value": 1
   }
  },
  {
   "key": "parmesan",
   "item": "Parmesan",
   "note": "nach Geschmack"
  }
 ],
 "equipment": [],
 "totalMinutes": 25
}
"""#
}
#endif
