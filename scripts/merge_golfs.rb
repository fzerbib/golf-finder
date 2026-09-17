#!/usr/bin/env ruby
# Merges the exhaustive OSM golf course list (data/osm_golfs.json) with the small,
# manually-researched dataset (data/curated_golfs.json: real green fees + slope).
# Output: data/golfs.js, the file the web app actually loads.
require "json"

def normalize(s)
  s.to_s
   .unicode_normalize(:nfd)
   .gsub(/[̀-ͯ]/, "")
   .downcase
   .gsub(/[^a-z0-9]+/, " ")
   .strip
end

# name -> [alias substrings used to find the matching OSM record(s)]
CURATED_ALIASES = {
  "Le Golf National" => ["golf national"],
  "Golf de Seignosse" => ["seignosse"],
  "Terre Blanche" => ["terre blanche"],
  "Omaha Beach" => ["omaha beach"],
  "Golf de Dinard" => ["dinard"],
  "PGA Catalunya" => ["pga catalunya", "camiral"],
  "Real Club Valderrama" => ["valderrama"],
  "Las Colinas" => ["las colinas"],
  "Club de Campo Villa de Madrid" => ["club de campo villa de madrid", "real club de campo"],
  "Real Golf de Pedreña" => ["pedrena"],
  "Los Naranjos Golf Club" => ["los naranjos"],
  "Club de Golf Aloha" => ["club de golf aloha", "aloha golf"],
  "Real Club de Golf Las Brisas" => ["las brisas"],
  "Campo de Golf Río Real" => ["rio real"],
  "Real Club de Golf Guadalmina" => ["guadalmina"],
  "El Paraíso Golf Club" => ["el paraiso golf club"],
  "Santa María Golf & Country Club" => ["santa maria golf"],
  "Santa Clara Golf Club Marbella" => ["santa clara golf"],
  "La Quinta Golf & Country Club" => ["la quinta golf"],
  "Atalaya Golf & Country Club" => ["atalaya golf"],
  "Marbella Club Golf Resort" => ["marbella club golf resort"],
  "La Resina Golf & Country Club" => ["la resina golf"],
  "Villa Padierna Alferini Golf" => ["alferini golf"],
  "Villa Padierna Flamingos Golf" => ["flamingos golf"]
}.freeze

osm = JSON.parse(File.read("data/osm_golfs.json"))
curated = JSON.parse(File.read("data/curated_golfs.json"))

osm.each { |o| o["_norm"] = normalize(o["name"]) }

matched_osm_ids = {}
records = []

curated.each do |c|
  aliases = CURATED_ALIASES[c["name"]] || [normalize(c["name"])]
  candidate = osm.find do |o|
    next false if o["country"] != c["country"]
    padded = " #{o["_norm"]} "
    aliases.any? { |a| padded.include?(" #{normalize(a)} ") }
  end

  if candidate
    matched_osm_ids[candidate.object_id] = true
    records << {
      "name" => candidate["name"],
      "country" => candidate["country"],
      "region" => candidate["region"],
      "city" => candidate["city"],
      "lat" => candidate["lat"],
      "lon" => candidate["lon"],
      "website" => candidate["website"],
      "holes" => c["holes"],
      "par" => c["par"],
      "slope" => c["slope"],
      "courseRating" => c["courseRating"],
      "greenFee" => c["greenFee"],
      "note" => c["note"],
      "verified" => true,
      "lastChecked" => c["lastChecked"]
    }
  else
    warn "! No OSM match found for curated entry: #{c["name"]} (#{c["country"]}) - kept standalone"
    records << {
      "name" => c["name"],
      "country" => c["country"],
      "region" => nil,
      "city" => nil,
      "lat" => nil,
      "lon" => nil,
      "website" => nil,
      "holes" => c["holes"],
      "par" => c["par"],
      "slope" => c["slope"],
      "courseRating" => c["courseRating"],
      "greenFee" => c["greenFee"],
      "note" => c["note"],
      "verified" => true,
      "lastChecked" => c["lastChecked"]
    }
  end
end

osm.each do |o|
  next if matched_osm_ids[o.object_id]
  records << {
    "name" => o["name"],
    "country" => o["country"],
    "region" => o["region"],
    "city" => o["city"],
    "lat" => o["lat"],
    "lon" => o["lon"],
    "website" => o["website"],
    "holes" => nil,
    "par" => nil,
    "slope" => nil,
    "courseRating" => nil,
    "greenFee" => { "low" => nil, "high" => nil, "currency" => "EUR" },
    "note" => nil,
    "verified" => false,
    "lastChecked" => nil
  }
end

records.sort_by! { |r| [r["country"].to_s, r["region"].to_s, r["name"].to_s] }

def js_string(v)
  v.nil? ? "null" : v.to_json
end

def js_number(v)
  v.nil? ? "null" : v.to_s
end

js_records = records.map do |r|
  fee = r["greenFee"] || { "low" => nil, "high" => nil, "currency" => "EUR" }
  <<~JS.strip
    {
        name: #{js_string(r["name"])},
        country: #{js_string(r["country"])},
        region: #{js_string(r["region"])},
        city: #{js_string(r["city"])},
        lat: #{js_number(r["lat"])},
        lon: #{js_number(r["lon"])},
        holes: #{js_number(r["holes"])},
        par: #{js_number(r["par"])},
        slope: #{js_number(r["slope"])},
        courseRating: #{js_number(r["courseRating"])},
        greenFee: { low: #{js_number(fee["low"])}, high: #{js_number(fee["high"])}, currency: #{js_string(fee["currency"])} },
        note: #{js_string(r["note"])},
        website: #{js_string(r["website"])},
        verified: #{r["verified"]},
        lastChecked: #{js_string(r["lastChecked"])}
      }
  JS
end

header = <<~JS
  // Base de données des golfs (France + Espagne).
  //
  // Origine des données :
  //  - Liste et localisation des golfs : © les contributeurs d'OpenStreetMap (licence ODbL),
  //    récupérée via l'API Overpass. Voir https://www.openstreetmap.org/copyright
  //  - Green fees / slope / notes : recherche manuelle ponctuelle golf par golf (champ
  //    "verified: true"). Les entrées "verified: false" n'ont pas encore été vérifiées :
  //    slope et green fee sont inconnus (affichés "non renseigné" dans l'app).
  //
  // Les prix de green fees évoluent souvent (saison, jour, promotions) : même pour les
  // entrées vérifiées, ils sont indicatifs et doivent être reconfirmés avant réservation.
  //
  // Pour enrichir une fiche : trouver l'entrée par son "name", et renseigner holes/par/
  // slope/courseRating/greenFee/note/lastChecked, puis passer verified à true.
  const GOLF_DATA = [
    #{js_records.join(",\n  ")}
  ];
JS

File.write("data/golfs.js", header)
verified_count = records.count { |r| r["verified"] }
puts "Total golfs: #{records.length} (#{verified_count} vérifiés avec green fee/slope, #{records.length - verified_count} listés via OpenStreetMap sans tarif)"
puts "Written to data/golfs.js"
