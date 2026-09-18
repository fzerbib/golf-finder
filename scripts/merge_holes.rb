#!/usr/bin/env ruby
# Matches OSM "golf=hole" ways (data/osm_holes.json) to golfs (data/golfs.json) by
# proximity, and produces the per-hole reference scorecard used to pre-fill new score
# cards (par/handicap). Coverage is inherently partial — only golfs with at least one
# matched, ref'd hole appear in the output; the app always lets the user fill in or
# correct par/handicap by hand regardless.
require "json"

MAX_DISTANCE_KM = 1.2

def haversine_km(lat1, lon1, lat2, lon2)
  r = 6371.0
  dlat = (lat2 - lat1) * Math::PI / 180
  dlon = (lon2 - lon1) * Math::PI / 180
  a = Math.sin(dlat / 2)**2 + Math.cos(lat1 * Math::PI / 180) * Math.cos(lat2 * Math::PI / 180) * Math.sin(dlon / 2)**2
  2 * r * Math.asin(Math.sqrt(a))
end

golfs = JSON.parse(File.read("data/golfs.json"))
holes = JSON.parse(File.read("data/osm_holes.json"))

result = {}

golfs.each do |golf|
  next if golf["lat"].nil? || golf["lon"].nil?

  nearby = holes.select do |h|
    next false if h["lat"].nil? || h["lon"].nil? || h["ref"].nil?
    haversine_km(golf["lat"], golf["lon"], h["lat"], h["lon"]) <= MAX_DISTANCE_KM
  end
  next if nearby.empty?

  by_ref = {}
  nearby.each do |h|
    ref = h["ref"].to_s.to_i
    next if ref <= 0
    existing = by_ref[ref]
    # Prefer the one with more data (par present) if two holes share a ref number
    # (can happen when a resort has more than one course nearby).
    if existing.nil? || (existing["par"].nil? && h["par"])
      by_ref[ref] = h
    end
  end
  next if by_ref.empty?

  result[golf["id"]] = by_ref.sort.map do |ref, h|
    {
      "number" => ref,
      "par" => h["par"],
      "handicap" => h["handicap"],
      "distances" => h["distances"]
    }
  end
end

def js_string(v)
  v.nil? ? "null" : v.to_json
end

def js_number(v)
  v.nil? ? "null" : v.to_s
end

entries = result.map do |golf_id, holes_arr|
  hole_js = holes_arr.map do |h|
    dist = (h["distances"] || {}).map { |k, v| "#{k.to_s.to_json}: #{v}" }.join(", ")
    "{ number: #{js_number(h["number"])}, par: #{js_number(h["par"])}, handicap: #{js_number(h["handicap"])}, distances: { #{dist} } }"
  end.join(",\n      ")
  "  #{golf_id.to_json}: [\n      #{hole_js}\n    ]"
end

header = <<~JS
  // Trous (par / index de handicap / distances par départ) issus d'OpenStreetMap
  // (tags golf=hole, par, handicap, dist:<couleur>), quand ils existent — © les
  // contributeurs d'OpenStreetMap, licence ODbL. Couverture très partielle : seuls les
  // golfs listés ici ont au moins un trou identifié ; l'appli permet toujours de saisir
  // ou corriger le par/handicap à la main pour tous les autres.
  const HOLES_DATA = {
  #{entries.join(",\n")}
  };
JS

File.write("data/holes.js", header)
puts "Golfs with at least one matched hole: #{result.length} / #{golfs.length}"
full_18_or_9 = result.count { |_, hs| hs.length >= 9 }
puts "Golfs with 9+ holes matched: #{full_18_or_9}"
puts "Written to data/holes.js"
